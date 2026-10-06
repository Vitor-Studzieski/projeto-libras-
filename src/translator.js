import { classifySequence } from './localRecognizer.js'
import { BUTCHER_INTENTS } from './butcherVocabulary.js'

export const intentCatalog = BUTCHER_INTENTS

export function translateSequence(sequence) {
  const calibratedResult = classifySequence(sequence, intentCatalog)
  if (calibratedResult.status !== 'model-unavailable') return calibratedResult

  return {
    status: 'model-unavailable',
    mode: 'libras-model-unavailable',
    source: 'landmarks da câmera',
    modelVersion: 'nenhum-modelo-configurado',
    confidence: null,
    isRealRecognition: false,
    isPrototype: true,
    title: 'Modelo de Libras não conectado',
    text: 'Ainda não posso traduzir este sinal com segurança. Conecte um modelo treinado com vídeos rotulados de Libras.',
    sector: 'Atendimento',
    requiresRetry: true,
    recognitionHint: 'O detector de mãos está ativo, mas ele não traduz Libras sozinho.',
  }
}
