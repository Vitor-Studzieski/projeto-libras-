import { useEffect, useRef, useState } from 'react'
import { Check, Database, FileVideo, Image, Pause, Play, Save, Search, Upload } from 'lucide-react'
import { extractFrameFeatures } from './signFeatures'
import { saveTrainingSample } from './localRecognizer'
import { intentCatalog } from './translator'
import { useHandTracking } from './useHandTracking'
import { LIBRAS_COURSE_LESSONS, LIBRAS_COURSE_PRIORITY } from './courseLessons'
import { captureFrameSnapshot, MAX_DATASET_SNAPSHOTS } from './datasetFrames'
import { findExpertVideos, getExpertVideoRemoteUrl, getExpertVideoSource, loadVibrasilAnnotations, VLIBRASIL_DATASET_URL } from './expertDataset'

const SAMPLE_INTERVAL_SECONDS = 0.1
const COURSE_LESSON_OPTIONS = LIBRAS_COURSE_PRIORITY
  .map((lessonNumber) => LIBRAS_COURSE_LESSONS[lessonNumber - 1])
  .filter(Boolean)

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function expertVideoKey(video) {
  return `${video.video_id || video.video_name || video.class}-${video.user_id || 'articulador'}`
}

export function DatasetBuilder({ trainingLabel, onTrainingLabelChange, onSamplesSaved, onExportTrainingData }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const objectUrlRef = useRef('')
  const capturingRef = useRef(false)
  const frameBufferRef = useRef([])
  const snapshotBufferRef = useRef([])
  const lastSampleTimeRef = useRef(-Infinity)
  const startTimeRef = useRef(0)
  const endTimeRef = useRef(2)

  const [videoFile, setVideoFile] = useState(null)
  const [sourceMode, setSourceMode] = useState('expert')
  const [videoUrl, setVideoUrl] = useState('')
  const [expertVideos, setExpertVideos] = useState([])
  const [selectedExpertVideoId, setSelectedExpertVideoId] = useState('')
  const [expertLoading, setExpertLoading] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [duration, setDuration] = useState(0)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(2)
  const [sourceReference, setSourceReference] = useState('')
  const [selectedLessonNumber, setSelectedLessonNumber] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [capturedFrameCount, setCapturedFrameCount] = useState(0)
  const [message, setMessage] = useState('Selecione um vídeo autorizado e marque o trecho de um sinal.')
  const selectedExpertVideo = expertVideos.find((video) => expertVideoKey(video) === selectedExpertVideoId)
  const videoSource = sourceMode === 'expert' ? videoUrl : objectUrlRef.current

  const finishCapture = () => {
    if (!capturingRef.current) return
    capturingRef.current = false
    setIsCapturing(false)
    videoRef.current?.pause()

    const sequence = frameBufferRef.current
    const snapshots = snapshotBufferRef.current
    if (sequence.length < 12) {
      setMessage('Poucos frames com mão detectada. Escolha um trecho mais claro e tente novamente.')
      return
    }

    try {
      const result = saveTrainingSample(trainingLabel, sequence, {
        source: sourceMode === 'expert' ? 'expert-dataset' : 'video-local',
        sourceReference: sourceReference.trim() || undefined,
        courseLessonNumber: selectedLesson?.number,
        courseLessonTitle: selectedLesson?.title,
        courseLessonUrl: selectedLesson?.url,
        expertDataset: sourceMode === 'expert' ? 'V-Librasil' : undefined,
        expertClass: selectedExpertVideo?.class,
        expertArticulator: selectedExpertVideo?.user_id,
        expertVideoUrl: getExpertVideoRemoteUrl(selectedExpertVideo),
        expertOriginalVideoUrl: selectedExpertVideo?.url_download,
        videoFileName: videoFile?.name || undefined,
        startTime: startTimeRef.current,
        endTime: endTimeRef.current,
        sampleRate: 1 / SAMPLE_INTERVAL_SECONDS,
        frameSnapshots: snapshots,
      })
      onSamplesSaved?.()
      setMessage(result.imagesStored
        ? `Exemplo salvo com ${sequence.length} sequências e ${snapshots.length} frames de conferência.`
        : `Landmarks salvos com ${sequence.length} sequências. O armazenamento ficou sem espaço para guardar as imagens.`)
    } catch (error) {
      setMessage(`Não foi possível salvar o exemplo: ${error.message || 'armazenamento indisponível'}`)
    }
  }

  const handleTrackingFrame = (result) => {
    if (!capturingRef.current || !result.landmarks?.length) return
    const video = videoRef.current
    if (!video) return
    const currentTime = video.currentTime
    if (currentTime < startTimeRef.current - 0.04) return
    if (currentTime >= endTimeRef.current) {
      finishCapture()
      return
    }
    if (currentTime - lastSampleTimeRef.current < SAMPLE_INTERVAL_SECONDS) return

    frameBufferRef.current.push(extractFrameFeatures(result))
    if (snapshotBufferRef.current.length < MAX_DATASET_SNAPSHOTS && frameBufferRef.current.length % 3 === 1) {
      const snapshot = captureFrameSnapshot(video, currentTime)
      if (snapshot) snapshotBufferRef.current.push(snapshot)
    }
    lastSampleTimeRef.current = currentTime
    setCapturedFrameCount(frameBufferRef.current.length)
  }

  const tracking = useHandTracking({
    videoRef,
    canvasRef,
    enabled: videoReady,
    onFrame: handleTrackingFrame,
  })

  useEffect(() => () => {
    capturingRef.current = false
    videoRef.current?.pause()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  const resetVideoState = (nextMessage) => {
    capturingRef.current = false
    setIsCapturing(false)
    setVideoReady(false)
    setDuration(0)
    setStartTime(0)
    setEndTime(2)
    setCapturedFrameCount(0)
    if (nextMessage) setMessage(nextMessage)
  }

  const loadExpertVideo = async () => {
    const intent = intentCatalog.find((item) => item.label === trainingLabel)
    setExpertLoading(true)
    setMessage('Buscando vídeos rotulados de articuladores da base V-Librasil...')
    try {
      const annotations = await loadVibrasilAnnotations()
      const matches = findExpertVideos(annotations, intent).slice(0, 12)
      if (!matches.length) throw new Error('Não encontrei um vídeo rotulado para esse sinal nessa base.')
      const first = matches[0]
      setSourceMode('expert')
      setExpertVideos(matches)
      setSelectedExpertVideoId(expertVideoKey(first))
      setVideoUrl(getExpertVideoSource(first))
      setVideoFile(null)
      resetVideoState(`Vídeo de especialista carregado: ${first.class} · ${first.user_id}. Ajuste o trecho e extraia os frames.`)
      setSourceReference(`V-Librasil — ${first.class} — ${first.user_id}`)
    } catch (error) {
      setMessage(error.message || 'Não foi possível carregar um vídeo de especialista.')
    } finally {
      setExpertLoading(false)
    }
  }

  const handleExpertVideoChange = (event) => {
    const nextVideo = expertVideos.find((video) => expertVideoKey(video) === event.target.value)
    if (!nextVideo) return
    setSelectedExpertVideoId(event.target.value)
    setVideoUrl(getExpertVideoSource(nextVideo))
    resetVideoState(`Vídeo de especialista selecionado: ${nextVideo.class} · ${nextVideo.user_id}.`)
    setSourceReference(`V-Librasil — ${nextVideo.class} — ${nextVideo.user_id}`)
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = URL.createObjectURL(file)
    setSourceMode('local')
    setVideoUrl('')
    setExpertVideos([])
    setSelectedExpertVideoId('')
    capturingRef.current = false
    setIsCapturing(false)
    setVideoFile(file)
    setVideoReady(false)
    setDuration(0)
    setStartTime(0)
    setEndTime(2)
    setCapturedFrameCount(0)
    setMessage('Vídeo carregado. Ajuste o intervalo e selecione o sinal representado.')
  }

  const handleVideoMetadata = () => {
    const nextDuration = videoRef.current?.duration || 0
    setDuration(nextDuration)
    setEndTime((currentEnd) => Math.min(Math.max(currentEnd, 0.5), nextDuration || currentEnd))
    setVideoReady(true)
  }

  const startCapture = async () => {
    const video = videoRef.current
    const validStart = clamp(Number(startTime) || 0, 0, Math.max(0, duration - 0.1))
    const validEnd = clamp(Number(endTime) || 0, validStart + 0.5, duration || validStart + 0.5)
    if ((!videoFile && !videoUrl) || !videoReady || !video || validEnd <= validStart) {
      setMessage('Carregue um vídeo de especialista e informe um intervalo válido de pelo menos meio segundo.')
      return
    }

    setStartTime(validStart)
    setEndTime(validEnd)
    startTimeRef.current = validStart
    endTimeRef.current = validEnd
    frameBufferRef.current = []
    snapshotBufferRef.current = []
    lastSampleTimeRef.current = -Infinity
    setCapturedFrameCount(0)
    setMessage('Extraindo landmarks e frames do trecho...')
    capturingRef.current = true
    setIsCapturing(true)
    video.currentTime = validStart
    try {
      await video.play()
    } catch {
      capturingRef.current = false
      setIsCapturing(false)
      setMessage('O navegador bloqueou a reprodução. Clique novamente para iniciar a captura.')
    }
  }

  const stopCapture = () => finishCapture()

  const selectedLesson = COURSE_LESSON_OPTIONS.find((lesson) => String(lesson.number) === selectedLessonNumber)
  const handleCourseLessonChange = (event) => {
    const nextNumber = event.target.value
    setSelectedLessonNumber(nextNumber)
    const nextLesson = COURSE_LESSON_OPTIONS.find((lesson) => String(lesson.number) === nextNumber)
    if (nextLesson) setSourceReference(`Aula ${nextLesson.number} — ${nextLesson.title}`)
  }

  return <div className="dataset-builder">
    <div className="dataset-heading">
      <div><strong>Construir dataset com vídeos de especialistas</strong><span>Use uma execução rotulada. O vídeo permanece no navegador.</span></div>
      <FileVideo size={19} />
    </div>
    <div className="dataset-source-tabs"><button className={sourceMode === 'expert' ? 'active' : ''} type="button" onClick={() => setSourceMode('expert')} disabled={isCapturing}><Database size={16} /> Base pública de especialistas</button><button className={sourceMode === 'local' ? 'active' : ''} type="button" onClick={() => setSourceMode('local')} disabled={isCapturing}><Upload size={16} /> Arquivo local autorizado</button></div>
    {sourceMode === 'expert' ? <div className="dataset-expert-source"><span>Use vídeos rotulados de articuladores do V-Librasil. O rótulo vem da própria base.</span><button className="secondary-button" type="button" onClick={loadExpertVideo} disabled={expertLoading || isCapturing}>{expertLoading ? 'Buscando vídeo...' : <><Search size={16} /> Buscar vídeo para este sinal</>}</button>{expertVideos.length > 0 && <label><span>Variação do especialista</span><select value={selectedExpertVideoId} onChange={handleExpertVideoChange} disabled={isCapturing}>{expertVideos.map((video) => <option value={expertVideoKey(video)} key={expertVideoKey(video)}>{video.class} · {video.user_id}</option>)}</select></label>}<a href={VLIBRASIL_DATASET_URL} target="_blank" rel="noreferrer">Ver origem e licença da base V-Librasil</a></div> : <label className="dataset-file-picker"><Upload size={17} /><span>{videoFile ? videoFile.name : 'Selecionar vídeo local autorizado'}</span><input type="file" accept="video/*" onChange={handleFileChange} /></label>}
    {videoSource && <div className="dataset-video-shell"><video ref={videoRef} crossOrigin={sourceMode === 'expert' ? 'anonymous' : undefined} controls playsInline onLoadedMetadata={handleVideoMetadata} onError={() => { setVideoReady(false); setMessage('O vídeo remoto não pôde ser lido pelo navegador. Tente outra variação ou um arquivo local autorizado.') }} onEnded={finishCapture} src={videoSource} /><canvas ref={canvasRef} className="dataset-landmark-canvas" aria-hidden="true" /></div>}
    <div className="dataset-fields">
      <label><span>Sinal representado</span><select value={trainingLabel} onChange={(event) => onTrainingLabelChange(event.target.value)} disabled={isCapturing}>{intentCatalog.map((intent) => <option value={intent.label} key={intent.label}>{intent.title}</option>)}</select></label>
      <label><span>Aula do curso</span><select value={selectedLessonNumber} onChange={handleCourseLessonChange} disabled={isCapturing}><option value="">Selecionar aula prioritária</option>{COURSE_LESSON_OPTIONS.map((lesson) => <option value={lesson.number} key={lesson.number}>Aula {lesson.number} — {lesson.title}</option>)}</select></label>
      <label><span>Referência</span><input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Ex.: aula 44 — alimentos" disabled={isCapturing} /></label>
      <label><span>Início (s)</span><input type="number" min="0" max={duration || undefined} step="0.1" value={startTime} onChange={(event) => setStartTime(Number(event.target.value))} disabled={isCapturing} /></label>
      <label><span>Fim (s)</span><input type="number" min="0.5" max={duration || undefined} step="0.1" value={endTime} onChange={(event) => setEndTime(Number(event.target.value))} disabled={isCapturing} /></label>
    </div>
    {selectedLesson && <a className="dataset-course-link" href={selectedLesson.url} target="_blank" rel="noreferrer">Abrir aula {selectedLesson.number} no YouTube</a>}
    <div className="dataset-actions"><button className="secondary-button" type="button" onClick={isCapturing ? stopCapture : startCapture} disabled={!videoReady}>{isCapturing ? <><Pause size={16} /> Parar e salvar</> : <><Play size={16} /> Extrair trecho</>}</button><button className="text-button" type="button" onClick={onExportTrainingData}><Save size={15} /> Exportar dataset</button></div>
    <div className="dataset-status"><span className={`tracking-dot ${tracking.status === 'detecting' ? 'dataset-status-live' : ''}`} /> {tracking.status === 'error' ? 'Detector indisponível' : tracking.status === 'loading' ? 'Carregando detector' : tracking.hands ? `${tracking.hands} mão(s) detectada(s)` : 'Aguardando mãos'} <span>·</span> {capturedFrameCount} frames extraídos</div>
    {tracking.error && <small className="dataset-error">{tracking.error}</small>}
    <small className="dataset-message"><Check size={14} /> {message}{duration ? ` Duração: ${duration.toFixed(1)}s.` : ''}</small>
    <small className="dataset-note"><Image size={14} /> Cada trecho salva landmarks para o classificador e até {MAX_DATASET_SNAPSHOTS} imagens reduzidas para conferência. Use somente conteúdo próprio ou autorizado.</small>
  </div>
}
