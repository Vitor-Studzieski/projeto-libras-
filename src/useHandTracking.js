import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

function drawLandmarks(canvas, results) {
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  results.landmarks?.forEach((landmarks) => {
    context.strokeStyle = '#f2b84b'
    context.lineWidth = Math.max(2, canvas.width / 420)
    HAND_CONNECTIONS.forEach(([from, to]) => {
      const start = landmarks[from]
      const end = landmarks[to]
      context.beginPath()
      context.moveTo(start.x * canvas.width, start.y * canvas.height)
      context.lineTo(end.x * canvas.width, end.y * canvas.height)
      context.stroke()
    })

    context.fillStyle = '#ffffff'
    landmarks.forEach((landmark) => {
      context.beginPath()
      context.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(3, canvas.width / 210), 0, Math.PI * 2)
      context.fill()
    })
  })
}

function getMovement(previousWrists, landmarks) {
  let largestMovement = 0
  landmarks.forEach((hand, index) => {
    const wrist = hand[0]
    const previous = previousWrists[index]
    if (!previous) return
    const distance = Math.sqrt(((wrist.x - previous.x) ** 2) + ((wrist.y - previous.y) ** 2))
    largestMovement = Math.max(largestMovement, distance)
  })
  return largestMovement
}

export function useHandTracking({ videoRef, canvasRef, enabled, onFrame }) {
  const onFrameRef = useRef(onFrame)
  const [tracking, setTracking] = useState({
    status: 'idle',
    hands: 0,
    framesProcessed: 0,
    movementDetected: false,
    movementScore: 0,
    imageWidth: 0,
    imageHeight: 0,
    error: '',
  })

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  useEffect(() => {
    if (!enabled) {
      setTracking((current) => ({ ...current, status: 'idle', hands: 0, movementDetected: false }))
      if (canvasRef.current) {
        canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
      return undefined
    }

    let cancelled = false
    let animationFrameId = null
    let landmarker = null
    let lastVideoTime = -1
    let framesProcessed = 0
    let previousWrists = []
    let lastUiUpdate = 0

    const start = async () => {
      setTracking((current) => ({ ...current, status: 'loading', error: '' }))
      try {
        const vision = await FilesetResolver.forVisionTasks('/wasm')
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })

        if (cancelled) {
          landmarker.close()
          return
        }
        setTracking((current) => ({ ...current, status: 'ready' }))

        const renderLoop = () => {
          if (cancelled) return
          const video = videoRef.current
          if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            const timestamp = performance.now()
            const results = landmarker.detectForVideo(video, timestamp)
            const landmarks = results.landmarks || []
            onFrameRef.current?.({
              ...results,
              timestamp,
              imageWidth: video.videoWidth,
              imageHeight: video.videoHeight,
            })
            const movementScore = getMovement(previousWrists, landmarks)
            const movementDetected = movementScore >= 0.012
            previousWrists = landmarks.map((hand) => hand[0])
            lastVideoTime = video.currentTime
            framesProcessed += 1
            if (canvasRef.current) {
              if (canvasRef.current.width !== video.videoWidth || canvasRef.current.height !== video.videoHeight) {
                canvasRef.current.width = video.videoWidth
                canvasRef.current.height = video.videoHeight
              }
              drawLandmarks(canvasRef.current, results)
            }

            if (timestamp - lastUiUpdate > 120) {
              setTracking({
                status: 'detecting',
                hands: landmarks.length,
                framesProcessed,
                movementDetected,
                movementScore,
                imageWidth: video.videoWidth,
                imageHeight: video.videoHeight,
                error: '',
              })
              lastUiUpdate = timestamp
            }
          }
          animationFrameId = requestAnimationFrame(renderLoop)
        }

        renderLoop()
      } catch (error) {
        if (cancelled) return
        setTracking((current) => ({
          ...current,
          status: 'error',
          error: error.message || 'Não foi possível carregar o detector de mãos.',
        }))
      }
    }

    start()

    return () => {
      cancelled = true
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
      landmarker?.close()
      previousWrists = []
      if (canvasRef.current) {
        canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
    }
  }, [canvasRef, enabled, videoRef])

  return tracking
}
