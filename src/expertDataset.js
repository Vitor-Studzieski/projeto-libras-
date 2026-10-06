export const VLIBRASIL_DATASET_URL = 'https://huggingface.co/datasets/ibmectech/v-librasil-raw'
const VLIBRASIL_ANNOTATIONS_URL = `${VLIBRASIL_DATASET_URL}/resolve/main/annotations.csv?download=true`
const LOCAL_ANNOTATIONS_URL = '/api/expert-dataset/annotations'
const VLIBRASIL_VIDEO_URL = `${VLIBRASIL_DATASET_URL}/resolve/main/videos`

let annotationsPromise

function normalize(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"' && quoted) {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell)
  return cells
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return headers.reduce((row, header, index) => ({ ...row, [header]: values[index] || '' }), {})
  })
}

export function loadVibrasilAnnotations() {
  if (!annotationsPromise) {
    annotationsPromise = fetch(LOCAL_ANNOTATIONS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Servidor local indisponível (${response.status}).`)
        return response.text()
      })
      .catch(() => fetch(VLIBRASIL_ANNOTATIONS_URL).then((response) => {
        if (!response.ok) throw new Error(`Base de especialistas indisponível (${response.status}).`)
        return response.text()
      }))
      .then(parseCsv)
      .catch((error) => {
        annotationsPromise = undefined
        throw error
      })
  }
  return annotationsPromise
}

export function getExpertVideoSource(video) {
  const remoteUrl = getExpertVideoRemoteUrl(video)
  if (!remoteUrl) return ''
  return `/api/expert-dataset/video?url=${encodeURIComponent(remoteUrl)}`
}

export function getExpertVideoRemoteUrl(video) {
  const fileName = video?.video_name || (video?.class && video?.user_id ? `${video.class}_${video.user_id}.mp4` : '')
  if (!fileName) return ''
  return `${VLIBRASIL_VIDEO_URL}/${encodeURIComponent(fileName)}`
}

export function findExpertVideos(annotations, intent) {
  if (!intent) return []
  const phrases = [...(intent.expertClasses || []), intent.label, intent.title, ...(intent.examples || [])]
    .map(normalize)
    .filter((phrase) => phrase.length >= 2)

  return annotations
    .map((row) => {
      const className = normalize(row.class)
      const aliasScore = (intent.expertClasses || []).reduce((score, alias) => score + (className === normalize(alias) ? 100 : 0), 0)
      const phraseScore = phrases.reduce((score, phrase) => score + (className === phrase ? 10 : 0), 0)
      return { ...row, matchScore: aliasScore + phraseScore }
    })
    .filter((row) => row.matchScore > 0 && row.url_download)
    .sort((first, second) => second.matchScore - first.matchScore || String(first.user_id).localeCompare(String(second.user_id)))
}
