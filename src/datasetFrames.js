export const MAX_DATASET_SNAPSHOTS = 10
const MAX_SNAPSHOT_WIDTH = 640

export function captureFrameSnapshot(video, time = 0) {
  if (!video?.videoWidth || !video?.videoHeight) return null

  const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return null

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return {
      time: Number(Number(time).toFixed(3)),
      mimeType: 'image/jpeg',
      image: canvas.toDataURL('image/jpeg', 0.68),
    }
  } catch {
    // Remote expert videos may disallow canvas export through CORS.
    // Landmarks remain usable even when review snapshots are unavailable.
    return null
  }
}
