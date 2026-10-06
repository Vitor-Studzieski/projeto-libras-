export class VlibrasTranslationError extends Error {
  constructor(message, code = 'VLIBRAS_ERROR') {
    super(message)
    this.name = 'VlibrasTranslationError'
    this.code = code
  }
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new VlibrasTranslationError(payload.message || 'O VLibras não respondeu corretamente.', payload.code)
  }
  return payload
}

export async function getVlibrasStatus() {
  const response = await fetch('/api/vlibras/health')
  return readResponse(response)
}

export async function translatePortugueseToGloss(text) {
  const response = await fetch('/api/vlibras/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return readResponse(response)
}

export async function generateVlibrasVideo(gloss) {
  const response = await fetch('/api/vlibras/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gloss }),
  })
  return readResponse(response)
}
