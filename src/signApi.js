const TRANSLATION_ENDPOINT = '/api/translate-sign'
const LANDMARK_ENDPOINT = '/api/recognize-landmarks'

export class SignTranslationError extends Error {
  constructor(message, code = 'SIGN_TRANSLATION_ERROR', status = 0) {
    super(message)
    this.name = 'SignTranslationError'
    this.code = code
    this.status = status
  }
}

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return globalThis.btoa(binary)
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export async function translateSignVideo(videoBlob, { signal } = {}) {
  if (!videoBlob?.size) {
    throw new SignTranslationError('Nenhum vídeo foi capturado.', 'VIDEO_EMPTY')
  }

  const response = await fetch(TRANSLATION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoBase64: toBase64(await videoBlob.arrayBuffer()),
      mimeType: videoBlob.type || 'video/webm',
    }),
    signal,
  }).catch((error) => {
    if (error.name === 'AbortError') throw error
    throw new SignTranslationError('Não foi possível conectar ao serviço de tradução.', 'SERVICE_UNAVAILABLE')
  })

  const payload = await readJson(response)
  if (!response.ok) {
    throw new SignTranslationError(
      payload.message || 'O serviço de tradução não conseguiu interpretar o vídeo.',
      payload.code || 'PROVIDER_ERROR',
      response.status,
    )
  }

  if (!payload.text) {
    throw new SignTranslationError('O serviço respondeu sem uma tradução em português.', 'EMPTY_TRANSLATION', response.status)
  }

  return payload
}

export async function translateLandmarkSequence(sequence, { signal } = {}) {
  if (!Array.isArray(sequence) || sequence.length < 8) {
    throw new SignTranslationError('A captura ainda não contém landmarks suficientes.', 'SEQUENCE_EMPTY')
  }

  const response = await fetch(LANDMARK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sequence }),
    signal,
  }).catch((error) => {
    if (error.name === 'AbortError') throw error
    throw new SignTranslationError('Não foi possível conectar ao modelo Python local.', 'PYTHON_SERVICE_UNAVAILABLE')
  })

  const payload = await readJson(response)
  if (!response.ok) {
    throw new SignTranslationError(
      payload.message || 'O modelo Python não conseguiu interpretar a sequência.',
      payload.code || 'PYTHON_MODEL_ERROR',
      response.status,
    )
  }
  return payload
}

export async function getSignServiceStatus() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } })
    const payload = await readJson(response)
    if (!response.ok) throw new Error(payload.message || 'Serviço indisponível')
    return payload
  } catch (error) {
    return {
      state: 'unavailable',
      configured: false,
      provider: 'none',
      message: error.message || 'Não foi possível consultar o serviço de tradução.',
    }
  }
}
