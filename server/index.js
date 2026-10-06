import http from 'node:http'
import { Readable } from 'node:stream'

const port = Number(process.env.LIBRAS_API_PORT || 8787)
const providerUrl = process.env.LIBRAS_API_URL?.trim() || ''
const providerKey = process.env.LIBRAS_API_KEY?.trim() || ''
const providerStyle = process.env.LIBRAS_API_STYLE || 'base64-json'
const videoField = process.env.LIBRAS_API_VIDEO_FIELD || 'video'
const keyHeader = process.env.LIBRAS_API_KEY_HEADER || 'Authorization'
const keyPrefix = process.env.LIBRAS_API_KEY_PREFIX ?? 'Bearer '
const maxBodyBytes = Number(process.env.LIBRAS_MAX_BODY_BYTES || 24 * 1024 * 1024)
const timeoutMs = Number(process.env.LIBRAS_API_TIMEOUT_MS || 30_000)
const vlibrasBaseUrl = process.env.VLIBRAS_API_BASE_URL?.trim().replace(/\/$/, '') || ''
const vlibrasTranslatePath = process.env.VLIBRAS_API_TRANSLATE_PATH?.trim() || '/translate'
const vlibrasTranslateMethod = (process.env.VLIBRAS_API_TRANSLATE_METHOD || 'POST').toUpperCase()
const vlibrasVideoPath = process.env.VLIBRAS_API_VIDEO_PATH?.trim() || '/video'
const vlibrasVideoEnabled = /^(1|true|yes)$/i.test(process.env.VLIBRAS_API_VIDEO_ENABLED || '')
const vlibrasApiKey = process.env.VLIBRAS_API_KEY?.trim() || ''
const vlibrasApiKeyHeader = process.env.VLIBRAS_API_KEY_HEADER || 'x-api-key'
const vlibrasApiKeyPrefix = process.env.VLIBRAS_API_KEY_PREFIX ?? ''
const expertAnnotationsUrl = 'https://huggingface.co/datasets/ibmectech/v-librasil-raw/resolve/main/annotations.csv?download=true'
const expertAllowedHosts = new Set(['huggingface.co', 'us.aws.cdn.hf.co', 'libras.cin.ufpe.br', 'www.libras.cin.ufpe.br'])

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  response.end(body)
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  const text = String(body)
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  })
  response.end(text)
}

function isAllowedExpertUrl(value) {
  try {
    const parsed = new URL(value)
    const secureSource = parsed.protocol === 'https:'
    const publicUfpeSource = parsed.protocol === 'http:' && parsed.hostname.endsWith('libras.cin.ufpe.br')
    return (secureSource || publicUfpeSource) && expertAllowedHosts.has(parsed.hostname)
  } catch {
    return false
  }
}

async function fetchExpertSource(sourceUrl, options = {}) {
  let currentUrl = sourceUrl
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const upstream = await fetch(currentUrl, { ...options, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(upstream.status)) return upstream
    const location = upstream.headers.get('location')
    if (!location) return upstream
    currentUrl = new URL(location, currentUrl).toString()
    if (!isAllowedExpertUrl(currentUrl)) throw new Error('A fonte do vídeo redirecionou para um domínio não autorizado.')
  }
  throw new Error('A fonte do vídeo excedeu o limite de redirecionamentos.')
}

async function handleExpertAnnotations(response) {
  try {
    const upstream = await fetch(expertAnnotationsUrl, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await upstream.text()
    sendText(response, upstream.ok ? 200 : 502, body, 'text/csv; charset=utf-8')
  } catch (error) {
    sendJson(response, 502, { code: 'EXPERT_DATASET_UNAVAILABLE', message: error.message || 'Não foi possível carregar a base pública de especialistas.' })
  }
}

async function handleExpertVideo(request, response, url) {
  const sourceUrl = url.searchParams.get('url') || ''
  if (!isAllowedExpertUrl(sourceUrl)) {
    sendJson(response, 400, { code: 'EXPERT_VIDEO_URL_NOT_ALLOWED', message: 'A URL do vídeo não pertence a uma fonte pública autorizada.' })
    return
  }

  try {
    const headers = {}
    if (request.headers.range) headers.Range = request.headers.range
    const upstream = await fetchExpertSource(sourceUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!upstream.ok && upstream.status !== 206) {
      sendJson(response, 502, { code: 'EXPERT_VIDEO_UNAVAILABLE', message: `A fonte do vídeo respondeu com status ${upstream.status}.` })
      return
    }

    const responseHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    }
    const contentLength = upstream.headers.get('content-length')
    const contentRange = upstream.headers.get('content-range')
    if (contentLength) responseHeaders['Content-Length'] = contentLength
    if (contentRange) responseHeaders['Content-Range'] = contentRange
    response.writeHead(upstream.status, responseHeaders)
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response)
    else response.end()
  } catch (error) {
    sendJson(response, 502, { code: 'EXPERT_VIDEO_UNAVAILABLE', message: error.message || 'Não foi possível carregar o vídeo do especialista.' })
  }
}

async function readBody(request) {
  const chunks = []
  let total = 0

  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBodyBytes) {
      const error = new Error('A requisição excede o tamanho máximo permitido.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function providerHeaders() {
  const headers = { Accept: 'application/json' }
  if (providerKey) headers[keyHeader] = `${keyPrefix}${providerKey}`
  return headers
}

function providerRequestBody(input) {
  const base = {
    [videoField]: input.videoBase64,
    mimeType: input.mimeType || 'video/webm',
    language: 'pt-BR',
    source: 'libras-camera',
  }
  return JSON.stringify(base)
}

async function requestProvider(input) {
  const headers = providerHeaders()
  let body

  if (providerStyle === 'multipart') {
    const form = new FormData()
    const bytes = Buffer.from(input.videoBase64, 'base64')
    form.append(videoField, new Blob([bytes], { type: input.mimeType || 'video/webm' }), 'sinal.webm')
    form.append('language', 'pt-BR')
    form.append('source', 'libras-camera')
    body = form
  } else {
    headers['Content-Type'] = 'application/json'
    body = providerRequestBody(input)
  }

  const response = await fetch(providerUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { text: text.trim() }
  }

  if (!response.ok) {
    const error = new Error(providerErrorMessage(payload, response.status))
    error.statusCode = response.status >= 500 ? 502 : 400
    throw error
  }

  return payload
}

function providerErrorMessage(payload, status) {
  return firstText(payload, ['message', 'error', 'detail']) || `O serviço externo respondeu com status ${status}.`
}

function firstText(payload, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], payload)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseUpstreamPayload(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { text: text.trim() }
  }
}

function vlibrasHeaders(contentType = false) {
  const headers = { Accept: 'application/json' }
  if (contentType) headers['Content-Type'] = 'application/json'
  if (vlibrasApiKey) headers[vlibrasApiKeyHeader] = `${vlibrasApiKeyPrefix}${vlibrasApiKey}`
  return headers
}

function vlibrasUrl(path) {
  if (!vlibrasBaseUrl) return null
  return new URL(path, `${vlibrasBaseUrl}/`)
}

function normalizeVlibrasGloss(payload) {
  return firstText(payload, [
    'gloss',
    'glosa',
    'translation',
    'text',
    'result.gloss',
    'result.glosa',
    'result.translation',
    'result.text',
    'data.gloss',
    'data.glosa',
    'data.translation',
    'data.text',
  ])
}

function normalizeVlibrasVideo(payload) {
  return {
    videoId: firstText(payload, ['id', 'videoId', 'video_id', 'result.id', 'result.videoId', 'data.id']),
    videoUrl: firstText(payload, ['url', 'videoUrl', 'video_url', 'video', 'result.url', 'result.videoUrl', 'data.url']),
  }
}

async function handleVlibrasTranslate(request, response) {
  if (!vlibrasBaseUrl) {
    sendJson(response, 503, {
      code: 'VLIBRAS_API_NOT_CONFIGURED',
      message: 'Configure VLIBRAS_API_BASE_URL no servidor para traduzir português para Libras.',
    })
    return
  }

  let input
  try {
    input = JSON.parse(await readBody(request))
  } catch (error) {
    sendJson(response, error.statusCode || 400, { code: 'INVALID_REQUEST', message: error.message || 'Requisição inválida.' })
    return
  }

  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text) {
    sendJson(response, 400, { code: 'TEXT_REQUIRED', message: 'Digite a resposta em português.' })
    return
  }

  try {
    const upstreamUrl = vlibrasUrl(vlibrasTranslatePath)
    const upstreamOptions = {
      method: vlibrasTranslateMethod === 'GET' ? 'GET' : 'POST',
      headers: vlibrasHeaders(vlibrasTranslateMethod !== 'GET'),
      signal: AbortSignal.timeout(timeoutMs),
    }
    if (upstreamOptions.method === 'GET') upstreamUrl.searchParams.set('text', text)
    else upstreamOptions.body = JSON.stringify({ text })
    const upstream = await fetch(upstreamUrl, upstreamOptions)
    const payload = parseUpstreamPayload(await upstream.text())
    if (!upstream.ok) {
      sendJson(response, 502, { code: 'VLIBRAS_TRANSLATE_FAILED', message: providerErrorMessage(payload, upstream.status) })
      return
    }

    const gloss = normalizeVlibrasGloss(payload)
    if (!gloss) {
      sendJson(response, 502, { code: 'VLIBRAS_EMPTY_RESPONSE', message: 'O VLibras não retornou a glosa da frase.' })
      return
    }
    sendJson(response, 200, { gloss, source: 'vlibras' })
  } catch (error) {
    const isTimeout = error.name === 'TimeoutError' || error.code === 'UND_ERR_CONNECT_TIMEOUT'
    sendJson(response, 502, {
      code: isTimeout ? 'VLIBRAS_TIMEOUT' : 'VLIBRAS_UNAVAILABLE',
      message: isTimeout ? 'O VLibras demorou para responder. Tente novamente.' : error.message || 'Não foi possível conectar ao VLibras.',
    })
  }
}

async function handleVlibrasVideo(request, response) {
  if (!vlibrasBaseUrl) {
    sendJson(response, 503, {
      code: 'VLIBRAS_API_NOT_CONFIGURED',
      message: 'Configure VLIBRAS_API_BASE_URL no servidor para gerar o vídeo em Libras.',
    })
    return
  }

  let input
  try {
    input = JSON.parse(await readBody(request))
  } catch (error) {
    sendJson(response, error.statusCode || 400, { code: 'INVALID_REQUEST', message: error.message || 'Requisição inválida.' })
    return
  }

  const gloss = typeof input.gloss === 'string' ? input.gloss.trim() : ''
  if (!gloss) {
    sendJson(response, 400, { code: 'GLOSS_REQUIRED', message: 'A glosa do VLibras é obrigatória.' })
    return
  }

  try {
    const upstream = await fetch(vlibrasUrl(vlibrasVideoPath), {
      method: 'POST',
      headers: vlibrasHeaders(true),
      body: JSON.stringify({ gloss }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const payload = parseUpstreamPayload(await upstream.text())
    if (!upstream.ok) {
      sendJson(response, 502, { code: 'VLIBRAS_VIDEO_FAILED', message: providerErrorMessage(payload, upstream.status) })
      return
    }

    sendJson(response, 200, { gloss, source: 'vlibras', ...normalizeVlibrasVideo(payload) })
  } catch (error) {
    const isTimeout = error.name === 'TimeoutError' || error.code === 'UND_ERR_CONNECT_TIMEOUT'
    sendJson(response, 502, {
      code: isTimeout ? 'VLIBRAS_TIMEOUT' : 'VLIBRAS_UNAVAILABLE',
      message: isTimeout ? 'O VLibras demorou para gerar o vídeo. Tente novamente.' : error.message || 'Não foi possível gerar o vídeo em Libras.',
    })
  }
}

function firstNumber(payload, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], payload)
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number)) return Math.max(0, Math.min(1, number))
  }
  return null
}

function normalizeProviderResponse(payload) {
  const text = firstText(payload, [
    'text',
    'translation',
    'transcript',
    'transcription',
    'sentence',
    'phrase',
    'result.text',
    'data.text',
    'output.text',
    'prediction',
  ])
  const status = firstText(payload, ['status', 'result.status', 'data.status']).toLowerCase()
  const confidence = firstNumber(payload, ['confidence', 'score', 'result.confidence', 'data.confidence'])
  const title = firstText(payload, ['title', 'intent', 'result.intent', 'data.intent']) || 'Pedido traduzido em Libras'
  const sector = firstText(payload, ['sector', 'department', 'result.sector', 'data.sector']) || 'Atendimento'
  const modelVersion = firstText(payload, ['modelVersion', 'model', 'version', 'result.modelVersion']) || 'provedor-libras'

  return {
    status: status.includes('uncertain') || status.includes('low') ? 'low-confidence' : 'recognized',
    mode: 'libras-api',
    source: 'vídeo da câmera',
    modelVersion,
    confidence,
    title,
    sector,
    text,
    isRealRecognition: Boolean(text),
    isPrototype: false,
    requiresRetry: !text || status.includes('uncertain') || status.includes('low'),
  }
}

async function handleTranslation(request, response) {
  if (!providerUrl) {
    sendJson(response, 503, {
      code: 'LIBRAS_API_NOT_CONFIGURED',
      message: 'O serviço de reconhecimento de Libras ainda não foi configurado. Defina LIBRAS_API_URL no servidor.',
    })
    return
  }

  let input
  try {
    input = JSON.parse(await readBody(request))
  } catch (error) {
    sendJson(response, error.statusCode || 400, { code: 'INVALID_REQUEST', message: error.message || 'Requisição inválida.' })
    return
  }

  if (!input.videoBase64 || typeof input.videoBase64 !== 'string') {
    sendJson(response, 400, { code: 'VIDEO_REQUIRED', message: 'Envie um vídeo para interpretação.' })
    return
  }

  try {
    const providerResponse = await requestProvider(input)
    const translation = normalizeProviderResponse(providerResponse)
    if (!translation.text) {
      sendJson(response, 502, { code: 'PROVIDER_EMPTY_RESPONSE', message: 'O serviço externo não retornou texto em português.' })
      return
    }
    sendJson(response, 200, translation)
  } catch (error) {
    const isTimeout = error.name === 'TimeoutError' || error.code === 'UND_ERR_CONNECT_TIMEOUT'
    sendJson(response, error.statusCode || 502, {
      code: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      message: isTimeout ? 'O serviço demorou para responder. Tente novamente.' : error.message || 'Falha no serviço de tradução.',
    })
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      state: providerUrl ? 'ready' : 'not-configured',
      configured: Boolean(providerUrl),
      provider: providerUrl ? 'external' : 'none',
      message: providerUrl ? 'Serviço de reconhecimento configurado.' : 'Configure uma API de Libras para habilitar a tradução.',
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/vlibras/health') {
    sendJson(response, 200, {
      state: vlibrasBaseUrl ? 'ready' : 'not-configured',
      configured: Boolean(vlibrasBaseUrl),
      provider: 'vlibras',
      videoEnabled: vlibrasVideoEnabled,
      message: vlibrasBaseUrl ? 'VLibras configurado para português → Libras.' : 'Configure VLIBRAS_API_BASE_URL para habilitar português → Libras.',
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/expert-dataset/annotations') {
    await handleExpertAnnotations(response)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/expert-dataset/video') {
    await handleExpertVideo(request, response, url)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/translate-sign') {
    await handleTranslation(request, response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/vlibras/translate') {
    await handleVlibrasTranslate(request, response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/vlibras/video') {
    await handleVlibrasVideo(request, response)
    return
  }

  sendJson(response, 404, { code: 'NOT_FOUND', message: 'Rota não encontrada.' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[libras-api] http://127.0.0.1:${port} · reconhecimento: ${providerUrl ? 'configurado' : 'aguardando LIBRAS_API_URL'} · VLibras: ${vlibrasBaseUrl ? 'configurado' : 'aguardando VLIBRAS_API_BASE_URL'}`)
})
