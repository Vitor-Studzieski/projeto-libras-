import { FEATURE_VERSION, sequenceDistance } from './signFeatures.js'

const STORAGE_KEY = 'libras-development-dataset-v1'

function readSamples() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

function writeSamples(samples) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
}

export function getTrainingSamples() {
  return readSamples()
}

export function getTrainingCounts() {
  return readSamples().reduce((counts, sample) => ({
    ...counts,
    [sample.label]: (counts[sample.label] || 0) + 1,
  }), {})
}

export function exportTrainingDataset() {
  return JSON.stringify(readSamples(), null, 2)
}

export function saveTrainingSample(label, sequence, metadata = {}) {
  if (!label || !sequence?.length) throw new Error('Não há sequência suficiente para salvar.')

  const samples = readSamples()
  const sample = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    featureVersion: FEATURE_VERSION,
    sequence,
    createdAt: new Date().toISOString(),
    ...metadata,
  }

  try {
    writeSamples([...samples, sample])
  } catch (error) {
    // Image snapshots are useful for auditing, but landmarks are the part
    // required by the local classifier. If browser storage is full, preserve
    // the training example without the optional image payload.
    if (!metadata.frameSnapshots?.length) throw error
    const { frameSnapshots, ...sampleWithoutImages } = sample
    writeSamples([...samples, sampleWithoutImages])
    return { count: samples.length + 1, imagesStored: false }
  }

  return { count: samples.length + 1, imagesStored: Boolean(metadata.frameSnapshots?.length) }
}

export function classifySequence(sequence, intentCatalog) {
  const samples = readSamples().filter((sample) => sample.featureVersion === FEATURE_VERSION)
  if (!samples.length) {
    return {
      status: 'model-unavailable',
      mode: 'libras-local-calibration',
      source: 'câmera',
      modelVersion: 'calibracao-local-v0',
      confidence: null,
      isRealRecognition: false,
      isPrototype: true,
      title: 'Modelo ainda não calibrado',
      text: 'Carregue exemplos rotulados de articuladores no construtor de dataset para iniciar o reconhecimento local.',
      sector: 'Atendimento',
      requiresRetry: true,
    }
  }

  const ranked = samples
    .map((sample) => ({ ...sample, distance: sequenceDistance(sequence, sample.sequence) }))
    .sort((first, second) => first.distance - second.distance)
  const best = ranked[0]
  const second = ranked.find((sample) => sample.label !== best.label)
  const similarity = Math.max(0, Math.min(1, 1 - best.distance))
  const margin = second ? Math.max(0, second.distance - best.distance) : 1
  const labelCounts = samples.reduce((counts, sample) => ({
    ...counts,
    [sample.label]: (counts[sample.label] || 0) + 1,
  }), {})
  const labelsAvailable = Object.keys(labelCounts).length
  const accepted = labelsAvailable >= 2
    && labelCounts[best.label] >= 2
    && similarity >= 0.65
    && margin >= 0.06
  const intent = intentCatalog.find((item) => item.label === best.label)

  return {
    status: accepted ? 'recognized' : 'low-confidence',
    mode: 'libras-local-calibration',
    source: 'landmarks da câmera',
    modelVersion: 'calibracao-local-v1',
    confidence: similarity,
    similarity,
    isRealRecognition: accepted,
    isPrototype: true,
    title: accepted ? (intent?.title || best.label) : 'Sinal não reconhecido com segurança',
    text: accepted
      ? (intent?.text || best.label)
      : 'Não foi possível identificar o pedido com segurança. Faça o sinal novamente.',
    sector: accepted ? (intent?.sector || 'Atendimento') : 'Atendimento',
    requiresRetry: !accepted,
    matchedLabel: best.label,
    samplesAvailable: samples.length,
    labelsAvailable,
    samplesForMatchedLabel: labelCounts[best.label] || 0,
  }
}
