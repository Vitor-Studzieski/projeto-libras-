export const FEATURE_VERSION = 'hands-normalized-v1'
export const MAX_SEQUENCE_FRAMES = 90

function emptyHand() {
  return Array.from({ length: 21 * 3 }, () => 0)
}

function normalizeHand(landmarks) {
  if (!landmarks?.length) return emptyHand()

  const wrist = landmarks[0]
  let scale = 0
  landmarks.forEach((landmark) => {
    const distance = Math.sqrt(
      ((landmark.x - wrist.x) ** 2) +
      ((landmark.y - wrist.y) ** 2) +
      ((landmark.z - wrist.z) ** 2),
    )
    scale = Math.max(scale, distance)
  })

  const safeScale = scale || 1
  return landmarks.flatMap((landmark) => [
    (landmark.x - wrist.x) / safeScale,
    (landmark.y - wrist.y) / safeScale,
    (landmark.z - wrist.z) / safeScale,
  ])
}

function distance(first, second) {
  return Math.sqrt(
    ((first.x - second.x) ** 2) +
    ((first.y - second.y) ** 2) +
    ((first.z - second.z) ** 2),
  )
}

function getHandShape(landmarks) {
  if (!landmarks?.length) return null

  const wrist = landmarks[0]
  const safeScale = Math.max(...landmarks.map((landmark) => distance(landmark, wrist)), 1)
  const normalized = landmarks.map((landmark) => ({
    x: (landmark.x - wrist.x) / safeScale,
    y: (landmark.y - wrist.y) / safeScale,
    z: (landmark.z - wrist.z) / safeScale,
  }))
  const fingertipIndexes = [4, 8, 12, 16, 20]
  const pipIndexes = [3, 6, 10, 14, 18]
  const fingers = fingertipIndexes.map((tipIndex, fingerIndex) => {
    const tipDistance = distance(normalized[tipIndex], normalized[0])
    const pipDistance = distance(normalized[pipIndexes[fingerIndex]], normalized[0])
    return tipDistance > Math.max(0.45, pipDistance * 1.08)
  })

  return {
    fingers,
    fingerCount: fingers.filter(Boolean).length,
    palmOpen: fingers.filter(Boolean).length >= 4,
    wrist: { x: wrist.x, y: wrist.y, z: wrist.z },
  }
}

function handSide(result, index) {
  const category = result.handedness?.[index]?.[0]
  const name = category?.categoryName?.toLowerCase()
  if (name === 'left' || name === 'right') return name

  // Fallback used only if an older detector does not return handedness.
  return index === 0 ? 'left' : 'right'
}

export function extractFrameFeatures(result) {
  const hands = result?.landmarks || []
  const normalizedHands = { left: emptyHand(), right: emptyHand() }
  const handShapes = { left: null, right: null }

  hands.forEach((landmarks, index) => {
    const side = handSide(result, index)
    normalizedHands[side] = normalizeHand(landmarks)
    handShapes[side] = getHandShape(landmarks)
  })

  return {
    version: FEATURE_VERSION,
    vector: [...normalizedHands.left, ...normalizedHands.right],
    handShapes,
    hands: hands.length,
    timestamp: result?.timestamp || performance.now(),
  }
}

export function resampleSequence(sequence, targetLength = MAX_SEQUENCE_FRAMES) {
  if (!sequence?.length) return []
  if (sequence.length === targetLength) return sequence

  return Array.from({ length: targetLength }, (_, targetIndex) => {
    const sourceIndex = Math.round((targetIndex * (sequence.length - 1)) / (targetLength - 1 || 1))
    return sequence[sourceIndex]
  })
}

export function sequenceDistance(firstSequence, secondSequence) {
  const first = resampleSequence(firstSequence)
  const second = resampleSequence(secondSequence)
  if (!first.length || !second.length) return Number.POSITIVE_INFINITY

  let total = 0
  let count = 0
  first.forEach((frame, frameIndex) => {
    const other = second[frameIndex]
    frame.vector.forEach((value, valueIndex) => {
      total += Math.abs(value - other.vector[valueIndex])
      count += 1
    })
  })

  return count ? total / count : Number.POSITIVE_INFINITY
}
