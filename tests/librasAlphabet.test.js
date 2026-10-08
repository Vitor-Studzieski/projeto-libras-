import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractHandFeatures,
  LetterStabilizer,
  recognizeStaticLetter,
} from '../src/librasAlphabet.js'

const PHALANX_LENGTHS = [0.07, 0.045, 0.035]
const FINGER_BASES = {
  index: [0.44, 0.635],
  middle: [0.5, 0.62],
  ring: [0.56, 0.635],
  pinky: [0.615, 0.665],
}
const BEND_ANGLE = { extended: 4, half: 45, curled: 85 }
const THUMB_POSES = {
  extended: [[0.455, 0.845], [0.4, 0.78], [0.335, 0.715], [0.275, 0.655]],
  half: [[0.455, 0.845], [0.41, 0.785], [0.395, 0.72], [0.425, 0.675]],
  curled: [[0.455, 0.845], [0.42, 0.79], [0.445, 0.735], [0.495, 0.705]],
}

function rotate(point, degrees) {
  const radians = degrees * Math.PI / 180
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  }
}

function buildFinger(name, state, splay) {
  const [baseX, baseY] = FINGER_BASES[name]
  const points = [{ x: baseX, y: baseY, z: 0 }]
  let direction = rotate({ x: 0, y: -1 }, splay)
  let cursor = { x: baseX, y: baseY }

  for (let index = 0; index < PHALANX_LENGTHS.length; index += 1) {
    if (index > 0) direction = rotate(direction, BEND_ANGLE[state])
    cursor = {
      x: cursor.x + direction.x * PHALANX_LENGTHS[index],
      y: cursor.y + direction.y * PHALANX_LENGTHS[index],
    }
    points.push({ ...cursor, z: 0 })
  }
  return points
}

function makeHand(pose) {
  const spread = pose.spread ? 14 : 0
  const landmarks = [
    { x: 0.5, y: 0.9, z: 0 },
    ...THUMB_POSES[pose.thumb].map(([x, y]) => ({ x, y, z: 0 })),
    ...buildFinger('index', pose.index, -spread),
    ...buildFinger('middle', pose.middle, spread),
    ...buildFinger('ring', pose.ring, spread * 1.6),
    ...buildFinger('pinky', pose.pinky, spread * 2.2),
  ]

  if (!pose.rotate) return landmarks
  const wrist = { x: 0.5, y: 0.9 }
  return landmarks.map((point) => {
    const vector = rotate({ x: point.x - wrist.x, y: point.y - wrist.y }, pose.rotate)
    return { x: wrist.x + vector.x, y: wrist.y + vector.y, z: point.z }
  })
}

const poses = [
  ['A', { thumb: 'extended', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' }],
  ['B', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' }],
  ['G', { thumb: 'extended', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled', rotate: -90 }],
  ['H', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled', rotate: -90 }],
  ['I', { thumb: 'curled', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'extended' }],
  ['L', { thumb: 'extended', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }],
  ['M', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'curled', rotate: 180 }],
  ['N', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled', rotate: 180 }],
  ['U', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' }],
  ['V', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled', spread: true }],
  ['W', { thumb: 'curled', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'curled', spread: true }],
  ['Y', { thumb: 'extended', index: 'curled', middle: 'curled', ring: 'curled', pinky: 'extended' }],
  ['Z', { thumb: 'curled', index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' }],
]

test('extracts features from a 21-point hand and rejects invalid landmarks', () => {
  assert.ok(extractHandFeatures(makeHand(poses[0][1])))
  assert.equal(extractHandFeatures([]), null)
  assert.equal(extractHandFeatures(Array.from({ length: 21 }, () => ({ x: NaN, y: 0, z: 0 }))), null)
})

test('recognizes synthetic static hand poses used by the imported alphabet table', () => {
  for (const [expected, pose] of poses) {
    const result = recognizeStaticLetter(extractHandFeatures(makeHand(pose)))[0]
    assert.equal(result?.signature.letter, expected, `${expected} pose ranked as ${result?.signature.letter}`)
    assert.ok(result.score >= 0.82, `${expected} score ${result.score.toFixed(2)} is below the recognition threshold`)
    const stabilizer = new LetterStabilizer()
    let stable
    for (let frame = 0; frame < 12; frame += 1) stable = stabilizer.push(result)
    assert.equal(stable, expected, `${expected} pose did not stabilize`)
  }
})

test('requires a stable majority before returning a letter', () => {
  const stabilizer = new LetterStabilizer()
  const candidate = { score: 0.9, signature: { letter: 'A' } }
  for (let index = 0; index < 11; index += 1) assert.equal(stabilizer.push(candidate), null)
  assert.equal(stabilizer.push(candidate), 'A')
  stabilizer.reset()
  assert.equal(stabilizer.push({ ...candidate, score: 0.6 }), null)
})
