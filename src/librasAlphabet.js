const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']
const JOINTS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
}

const THRESHOLDS = {
  longFingerFullBend: 90,
  thumbSpanOpen: 1.15,
  thumbSpanClosed: 0.45,
  thumbFullBend: 55,
  extended: 0.32,
  curled: 0.62,
  pinchTouch: 0.45,
  pinchNear: 1.05,
  spread: 0.45,
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const length = (vector) => Math.hypot(vector.x, vector.y, vector.z)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const distance = (a, b) => length(subtract(a, b))

function angleAt(a, b, c) {
  const first = subtract(a, b)
  const second = subtract(c, b)
  const denominator = length(first) * length(second)
  if (denominator < 1e-6) return 180
  return Math.acos(clamp(dot(first, second) / denominator, -1, 1)) * (180 / Math.PI)
}

function fingerCurl(landmarks, finger, palmWidth) {
  const [mcp, pip, dip, tip] = JOINTS[finger]
  if (finger === 'thumb') {
    const span = distance(landmarks[tip], landmarks[5]) / palmWidth
    const bend = 180 - angleAt(landmarks[mcp], landmarks[pip], landmarks[tip])
    const bySpan = clamp(
      (THRESHOLDS.thumbSpanOpen - span) / (THRESHOLDS.thumbSpanOpen - THRESHOLDS.thumbSpanClosed),
      0,
      1,
    )
    const byBend = clamp(bend / THRESHOLDS.thumbFullBend, 0, 1)
    return clamp(bySpan * 0.7 + byBend * 0.3, 0, 1)
  }

  const firstBend = 180 - angleAt(landmarks[mcp], landmarks[pip], landmarks[dip])
  const secondBend = 180 - angleAt(landmarks[pip], landmarks[dip], landmarks[tip])
  return clamp((firstBend + secondBend) / 2 / THRESHOLDS.longFingerFullBend, 0, 1)
}

function stateFromCurl(curl) {
  if (curl < THRESHOLDS.extended) return 'extended'
  if (curl > THRESHOLDS.curled) return 'curled'
  return 'half'
}

function getOrientation(landmarks) {
  const vector = subtract(landmarks[9], landmarks[0])
  if (Math.abs(vector.y) >= Math.abs(vector.x)) return vector.y < 0 ? 'up' : 'down'
  return vector.x > 0 ? 'right' : 'left'
}

function getPinchGap(ratio) {
  if (ratio < THRESHOLDS.pinchTouch) return 'touch'
  if (ratio < THRESHOLDS.pinchNear) return 'near'
  return 'far'
}

function isThumbAcrossPalm(landmarks, palmSize) {
  const base = landmarks[5]
  const axis = subtract(landmarks[17], base)
  const lengthSquared = dot(axis, axis)
  if (lengthSquared < 1e-6) return false
  const t = dot(subtract(landmarks[4], base), axis) / lengthSquared
  const projected = {
    x: base.x + axis.x * t,
    y: base.y + axis.y * t,
    z: base.z + axis.z * t,
  }
  return t > 0.1 && t < 1.15 && distance(landmarks[4], projected) / palmSize < 0.55
}

function areFingersCrossed(landmarks) {
  const tipDelta = landmarks[8].x - landmarks[12].x
  const baseDelta = landmarks[5].x - landmarks[9].x
  if (Math.abs(tipDelta) < 0.01 || Math.abs(baseDelta) < 0.01) return false
  return Math.sign(tipDelta) !== Math.sign(baseDelta)
}

/** Converte os 21 pontos do MediaPipe em características aproximadas da pose. */
export function extractHandFeatures(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null
  if (landmarks.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(point?.z))) return null

  const palmSize = Math.max(distance(landmarks[0], landmarks[9]), 1e-4)
  const palmWidth = Math.max(distance(landmarks[5], landmarks[17]), 1e-4)
  const curls = {}
  const fingers = {}
  for (const finger of FINGERS) {
    curls[finger] = fingerCurl(landmarks, finger, palmWidth)
    fingers[finger] = stateFromCurl(curls[finger])
  }

  return {
    fingers,
    curls,
    orientation: getOrientation(landmarks),
    thumbIndexGap: getPinchGap(distance(landmarks[4], landmarks[8]) / palmSize),
    spread: fingers.index !== 'curled'
      && fingers.middle !== 'curled'
      && distance(landmarks[8], landmarks[12]) / palmSize > THRESHOLDS.spread,
    crossed: areFingersCrossed(landmarks),
    thumbAcrossPalm: isThumbAcrossPalm(landmarks, palmSize),
  }
}

/** Assinaturas heurísticas para estudo do alfabeto; não são um modelo treinado. */
export const LIBRAS_ALPHABET = [
  { letter: 'A', fingers: { thumb: 'extended', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', thumbAcrossPalm: false, hint: 'Punho fechado com o polegar esticado ao lado da mão.' },
  { letter: 'B', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' }, orientation: 'up', spread: false, thumbAcrossPalm: true, hint: 'Quatro dedos esticados e juntos, polegar dobrado sobre a palma.' },
  { letter: 'C', fingers: { thumb: 'half', index: 'half', middle: 'half', ring: 'half', pinky: 'half' }, orientation: 'side', thumbIndexGap: 'near', hint: 'Mão curvada em forma de C, de lado para a câmera.' },
  { letter: 'D', fingers: { thumb: 'half', index: 'extended', middle: 'half', ring: 'half', pinky: 'half' }, orientation: 'up', thumbIndexGap: 'far', hint: 'Indicador esticado para cima; os outros dedos se aproximam do polegar.' },
  { letter: 'E', fingers: { thumb: 'curled', index: 'half', middle: 'half', ring: 'half', pinky: 'half' }, orientation: 'up', thumbIndexGap: 'touch', hint: 'Dedos curvados, polegar recolhido à frente.' },
  { letter: 'F', fingers: { thumb: 'half', index: 'half', middle: 'extended', ring: 'extended', pinky: 'extended' }, orientation: 'up', thumbIndexGap: 'touch', hint: 'Polegar e indicador se tocam; os outros dedos ficam esticados.' },
  { letter: 'G', fingers: { thumb: 'extended', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'side', hint: 'Indicador e polegar esticados, mão apontando para o lado.' },
  { letter: 'H', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'side', spread: false, hint: 'Indicador e médio juntos e esticados, apontando para o lado.', motion: 'O H pode envolver movimento; a tabela avalia apenas uma pose.' },
  { letter: 'I', fingers: { thumb: 'curled', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'extended' }, orientation: 'up', hint: 'Só o mindinho esticado para cima.' },
  { letter: 'J', fingers: { thumb: 'curled', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'extended' }, orientation: 'up', hint: 'Pose semelhante a I.', motion: 'O J é distinguido pelo movimento; esta prática não acompanha a trajetória.' },
  { letter: 'K', fingers: { thumb: 'extended', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'up', spread: true, hint: 'Indicador e médio abertos em V com o polegar entre eles.', motion: 'A tabela considera só a pose inicial.' },
  { letter: 'L', fingers: { thumb: 'extended', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', thumbIndexGap: 'far', hint: 'Polegar e indicador esticados formando um L.' },
  { letter: 'M', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'curled' }, orientation: 'down', spread: false, hint: 'Indicador, médio e anelar esticados apontando para baixo.' },
  { letter: 'N', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'down', spread: false, hint: 'Indicador e médio esticados apontando para baixo.' },
  { letter: 'O', fingers: { thumb: 'half', index: 'half', middle: 'half', ring: 'half', pinky: 'half' }, orientation: 'up', thumbIndexGap: 'touch', hint: 'Dedos curvados aproximando-se do polegar.' },
  { letter: 'P', fingers: { thumb: 'extended', index: 'extended', middle: 'half', ring: 'curled', pinky: 'curled' }, orientation: 'down', hint: 'Pose aproximada de K virada para baixo.' },
  { letter: 'Q', fingers: { thumb: 'extended', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'down', hint: 'Pose aproximada de G apontando para baixo.' },
  { letter: 'R', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'up', crossed: true, hint: 'Indicador e médio esticados e cruzados.' },
  { letter: 'S', fingers: { thumb: 'curled', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', thumbAcrossPalm: true, thumbIndexGap: 'near', hint: 'Punho fechado com o polegar cruzando os dedos.' },
  { letter: 'T', fingers: { thumb: 'half', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', thumbAcrossPalm: true, thumbIndexGap: 'touch', hint: 'Punho fechado com o polegar entre indicador e médio.' },
  { letter: 'U', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'up', spread: false, crossed: false, hint: 'Indicador e médio esticados e juntos.' },
  { letter: 'V', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }, orientation: 'up', spread: true, hint: 'Indicador e médio esticados e afastados, formando um V.' },
  { letter: 'W', fingers: { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'curled' }, orientation: 'up', spread: true, hint: 'Indicador, médio e anelar esticados e afastados.' },
  { letter: 'X', fingers: { thumb: 'curled', index: 'half', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', hint: 'Indicador dobrado como um gancho.', motion: 'A forma pode depender de movimento; esta tabela avalia uma pose.' },
  { letter: 'Y', fingers: { thumb: 'extended', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'extended' }, orientation: 'up', hint: 'Polegar e mindinho esticados.' },
  { letter: 'Z', fingers: { thumb: 'curled', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }, orientation: 'up', hint: 'Indicador esticado.', motion: 'O Z é distinguido pelo movimento; esta prática não acompanha a trajetória.' },
]

const WEIGHTS = { finger: 1, orientation: 1.2, gap: 0.8, spread: 0.9, crossed: 1.5, thumbAcrossPalm: 1 }
const STATE_ORDER = ['curled', 'half', 'extended']

function scoreFinger(expected, actual) {
  if (expected === actual) return 1
  return Math.abs(STATE_ORDER.indexOf(expected) - STATE_ORDER.indexOf(actual)) === 1 ? 0.45 : 0
}

function scoreSignature(signature, features) {
  let score = 0
  let max = 0
  for (const finger of FINGERS) {
    const expected = signature.fingers[finger]
    if (!expected) continue
    max += WEIGHTS.finger
    score += WEIGHTS.finger * scoreFinger(expected, features.fingers[finger])
  }

  if (signature.orientation) {
    max += WEIGHTS.orientation
    const matches = signature.orientation === 'side'
      ? features.orientation === 'left' || features.orientation === 'right'
      : signature.orientation === features.orientation
    if (matches) score += WEIGHTS.orientation
  }
  if (signature.thumbIndexGap) {
    max += WEIGHTS.gap
    if (signature.thumbIndexGap === features.thumbIndexGap) score += WEIGHTS.gap
  }
  if (signature.spread !== undefined) {
    max += WEIGHTS.spread
    if (signature.spread === features.spread) score += WEIGHTS.spread
  }
  if (signature.crossed !== undefined) {
    max += WEIGHTS.crossed
    if (signature.crossed === features.crossed) score += WEIGHTS.crossed
  }
  if (signature.thumbAcrossPalm !== undefined) {
    max += WEIGHTS.thumbAcrossPalm
    if (signature.thumbAcrossPalm === features.thumbAcrossPalm) score += WEIGHTS.thumbAcrossPalm
  }
  return max ? score / max : 0
}

export function recognizeStaticLetter(features, topN = 3) {
  if (!features) return []
  return LIBRAS_ALPHABET.map((signature) => ({
    signature,
    score: scoreSignature(signature, features),
  })).sort((a, b) => b.score - a.score).slice(0, topN)
}

/** Reduz oscilações; a saída é apenas um palpite de pose, nunca uma tradução. */
export class LetterStabilizer {
  constructor(size = 12, ratio = 0.7, minScore = 0.82) {
    this.size = size
    this.ratio = ratio
    this.minScore = minScore
    this.window = []
  }

  push(match) {
    const candidate = match && match.score >= this.minScore ? match.signature.letter : null
    this.window.push(candidate)
    if (this.window.length > this.size) this.window.shift()
    if (this.window.length < this.size) return null

    const counts = new Map()
    for (const letter of this.window) {
      if (letter) counts.set(letter, (counts.get(letter) || 0) + 1)
    }
    let best = null
    let bestCount = 0
    for (const [letter, count] of counts) {
      if (count > bestCount) {
        best = letter
        bestCount = count
      }
    }
    return bestCount >= this.size * this.ratio ? best : null
  }

  reset() {
    this.window.length = 0
  }
}

export const FINGER_LABELS = {
  thumb: 'Polegar',
  index: 'Indicador',
  middle: 'Médio',
  ring: 'Anelar',
  pinky: 'Mindinho',
}

export const FINGER_STATE_LABELS = { extended: 'esticado', half: 'meio', curled: 'dobrado' }
