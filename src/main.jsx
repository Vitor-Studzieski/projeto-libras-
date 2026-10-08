import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Camera, Check, Database, Hand, Info, Languages, LoaderCircle, Sparkles, WifiOff } from 'lucide-react'
import './styles.css'
import { DatasetBuilder } from './DatasetBuilder'
import { exportTrainingDataset } from './localRecognizer'
import { extractFrameFeatures, MAX_SEQUENCE_FRAMES } from './signFeatures'
import { getSignServiceStatus, SignTranslationError, translateSignVideo } from './signApi'
import { intentCatalog, translateSequence } from './translator'
import { generateVlibrasVideo, getVlibrasStatus, translatePortugueseToGloss, VlibrasTranslationError } from './vlibrasApi'
import { VlibrasTestScreen } from './VlibrasTestScreen'
import { useHandTracking } from './useHandTracking'
import { AlphabetPractice } from './AlphabetPractice'

function MainApp() {
  const query = new URLSearchParams(window.location.search)
  const developmentMode = query.get('modo') === 'desenvolvimento'
  const datasetMode = developmentMode && query.get('dataset') === '1'
  const vlibrasTestMode = query.get('modo') === 'teste'
  const [translation, setTranslation] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [notice, setNotice] = useState('')
  const [serviceStatus, setServiceStatus] = useState({ state: 'checking', configured: false, provider: 'none', message: 'Consultando serviço de tradução...' })
  const [trainingLabel, setTrainingLabel] = useState(intentCatalog[0].label)
  const [attendantText, setAttendantText] = useState('')
  const [vlibrasResult, setVlibrasResult] = useState(null)
  const [isTranslatingAttendant, setIsTranslatingAttendant] = useState(false)
  const [vlibrasError, setVlibrasError] = useState('')
  const [vlibrasStatus, setVlibrasStatus] = useState({ configured: false, state: 'checking' })
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const sequenceRef = useRef([])
  const collectingRef = useRef(false)
  const recorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingDoneRef = useRef(null)
  const recordedVideoRef = useRef(null)

  const stopVideoRecording = () => {
    const recorder = recorderRef.current
    if (!recorder) return Promise.resolve(recordedVideoRef.current)
    const finished = recordingDoneRef.current || Promise.resolve(recordedVideoRef.current)
    if (recorder.state !== 'inactive') recorder.stop()
    return finished
  }

  const analyzeCapture = async (videoBlob) => {
    if (sequenceRef.current.length < 20) {
      setNotice('Faça o sinal por alguns instantes antes de interpretar.')
      return
    }

    setIsAnalyzing(true)
    setTranslation(null)
    if (!serviceStatus.configured) {
      const localResult = translateSequence(sequenceRef.current)
      setTranslation(localResult)
      setNotice(localResult.status === 'recognized'
        ? 'Resultado local de desenvolvimento. Valide-o com uma pessoa fluente em Libras.'
        : localResult.status === 'model-unavailable'
          ? 'Nenhum modelo treinado está disponível. Prepare exemplos de especialistas ou configure uma API de reconhecimento.'
          : 'O modelo não identificou esse sinal com segurança.')
      setIsAnalyzing(false)
      return
    }

    try {
      const result = await translateSignVideo(videoBlob)
      setTranslation(result)
      setNotice('Revise a tradução antes de usá-la no atendimento.')
    } catch (error) {
      const message = error instanceof SignTranslationError
        ? error.message
        : 'Não foi possível interpretar o sinal agora.'
      const localResult = translateSequence(sequenceRef.current)
      setTranslation({ ...localResult, fallbackReason: message })
      setNotice('O serviço não respondeu. O resultado local é apenas uma referência de desenvolvimento.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const finishCaptureAndAnalyze = async () => {
    collectingRef.current = false
    const videoBlob = await stopVideoRecording()
    recordedVideoRef.current = videoBlob
    if (!videoBlob?.size) {
      setNotice('Não foi possível preparar a captura. Tente novamente.')
      return
    }
    await analyzeCapture(videoBlob)
    if (streamRef.current && cameraActive) startCapture()
  }

  const handleTrackingFrame = (result) => {
    if (!collectingRef.current || !result.landmarks?.length) return
    const nextSequence = [...sequenceRef.current, extractFrameFeatures(result)].slice(-MAX_SEQUENCE_FRAMES)
    sequenceRef.current = nextSequence

    if (nextSequence.length >= MAX_SEQUENCE_FRAMES) void finishCaptureAndAnalyze()
  }

  const handTracking = useHandTracking({
    videoRef,
    canvasRef,
    enabled: cameraActive,
    onFrame: handleTrackingFrame,
  })

  useEffect(() => {
    let active = true
    getSignServiceStatus().then((status) => {
      if (active) setServiceStatus(status)
    })
    getVlibrasStatus().then((status) => {
      if (active) setVlibrasStatus(status)
    }).catch(() => {
      if (active) setVlibrasStatus({ configured: false, state: 'unavailable' })
    })
    return () => { active = false }
  }, [])

  useEffect(() => () => {
    collectingRef.current = false
    void stopVideoRecording()
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    videoRef.current.play().catch(() => {})
  }, [cameraActive])

  const startCamera = async () => {
    setCameraError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não disponibiliza acesso à câmera.')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
      if (startCapture()) setNotice('Câmera ativa. A interpretação contínua começou.')
    } catch (error) {
      setCameraError(error.message || 'Não foi possível acessar a câmera.')
      setCameraActive(false)
    }
  }

  const stopCamera = () => {
    collectingRef.current = false
    void stopVideoRecording()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  const startVideoRecording = () => {
    if (!streamRef.current || !globalThis.MediaRecorder) {
      setNotice('Este navegador não permite capturar o vídeo necessário para interpretar o sinal.')
      return false
    }

    const supportedMimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((mimeType) => globalThis.MediaRecorder.isTypeSupported?.(mimeType))
    const recorder = supportedMimeType
      ? new MediaRecorder(streamRef.current, { mimeType: supportedMimeType })
      : new MediaRecorder(streamRef.current)

    recordingChunksRef.current = []
    recordedVideoRef.current = null
    recordingDoneRef.current = new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        recordedVideoRef.current = blob
        recordingChunksRef.current = []
        recorderRef.current = null
        recordingDoneRef.current = null
        resolve(blob)
      }
    })
    recorder.ondataavailable = (event) => {
      if (event.data?.size) recordingChunksRef.current.push(event.data)
    }
    recorder.onerror = () => setNotice('Não foi possível capturar o vídeo. Tente novamente.')
    recorder.start(250)
    recorderRef.current = recorder
    return true
  }

  const startCapture = () => {
    sequenceRef.current = []
    recordedVideoRef.current = null
    if (!startVideoRecording()) return false
    collectingRef.current = true
    return true
  }

  const exportTrainingData = () => {
    const blob = new Blob([exportTrainingDataset()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `libras-dataset-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const translateAttendantResponse = async (event) => {
    event.preventDefault()
    const text = attendantText.trim()
    if (!text) return

    setIsTranslatingAttendant(true)
    setVlibrasError('')
    setVlibrasResult(null)
    try {
      const glossResult = await translatePortugueseToGloss(text)
      let videoResult = {}
      let videoMessage = ''

      try {
        if (vlibrasStatus.videoEnabled) videoResult = await generateVlibrasVideo(glossResult.gloss)
      } catch (error) {
        videoMessage = error instanceof VlibrasTranslationError
          ? error.message
          : 'A glosa foi gerada, mas o vídeo não ficou disponível.'
      }

      setVlibrasResult({ ...glossResult, ...videoResult, videoMessage })
      if (videoMessage) setVlibrasError(videoMessage)
    } catch (error) {
      setVlibrasError(error instanceof VlibrasTranslationError
        ? error.message
        : 'Não foi possível conectar ao VLibras agora.')
    } finally {
      setIsTranslatingAttendant(false)
    }
  }

  if (datasetMode) {
    return <div className="app-shell">
      <header className="topbar"><div className="brand"><div className="brand-mark"><Database size={21} /></div><strong>Preparação do dataset</strong></div><a className="dev-link" href="/?modo=desenvolvimento">Voltar ao atendimento</a></header>
      <main className="main-content"><DatasetScreen trainingLabel={trainingLabel} onTrainingLabelChange={setTrainingLabel} onExportTrainingData={exportTrainingData} /></main>
    </div>
  }

  if (vlibrasTestMode) return <VlibrasTestScreen />

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Hand size={21} /></div><strong>Atendimento em Libras</strong></div>
      <div className="topbar-status"><span className={`status-dot ${serviceStatus.configured ? '' : 'status-dot-warning'}`} /> {serviceStatus.configured ? 'Serviço conectado' : 'Serviço não configurado'}</div>
    </header>

    <main className="main-content">
      <section className="capture-section">
        <div className="capture-header"><div><span className="kicker">Tradução de Libras</span><h1>Interpretação contínua</h1><p>Ative a câmera e faça seus sinais. A tradução aparece automaticamente em português.</p></div><div className="capture-header-links"><a className="dev-link" href="/?modo=alfabeto"><Sparkles size={15} /> Praticar alfabeto</a><a className="dev-link" href="/?modo=teste"><Languages size={15} /> Testar VLibras</a>{developmentMode && <a className="dev-link" href="/?modo=desenvolvimento&dataset=1"><Database size={15} /> Preparar dataset</a>}</div></div>
        <div className="capture-grid">
          <div className="camera-panel">
            <div className="camera-frame">
              {cameraActive ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder"><Camera size={42} /><span>Câmera desligada</span><button className="primary-button" onClick={startCamera}><Camera size={17} /> Ativar câmera</button></div>}
              {cameraActive && <canvas ref={canvasRef} className="landmark-canvas" aria-hidden="true" />}
              {isAnalyzing && <div className="analysis-overlay"><div className="loader" /><strong>Interpretando automaticamente...</strong></div>}
            </div>
            {cameraError && <div className="error-message"><WifiOff size={17} /> {cameraError}</div>}
            <div className="tracking-status"><div className={`tracking-badge tracking-${handTracking.status}`}><span className="tracking-dot" /> {handTracking.status === 'detecting' ? 'Detectando mãos' : handTracking.status === 'loading' ? 'Carregando detector' : handTracking.status === 'error' ? 'Detector indisponível' : cameraActive ? 'Detector pronto' : 'Aguardando câmera'}</div><span>{handTracking.hands} {handTracking.hands === 1 ? 'mão detectada' : 'mãos detectadas'}</span></div>
            {handTracking.error && <div className="tracking-error"><Info size={15} /> {handTracking.error}</div>}
            <div className="camera-actions">{cameraActive && <button className="secondary-button" onClick={stopCamera}>Desligar câmera</button>}</div>
            <div className="camera-tips"><span><Check size={15} /> Mãos visíveis</span><span><Check size={15} /> Ambiente iluminado</span></div>
          </div>

          <div className="translation-panel">
            <div className="panel-label"><span className="label-dot" /> Resultado em português <span className="panel-demo-label">{translation ? 'resultado' : 'aguardando sinal'}</span></div>
            <div className="recognized-field"><div className="recognized-field-header"><label htmlFor="recognized-text">Texto interpretado</label><span>{translation ? translation.status === 'recognized' ? 'Resultado disponível' : 'Revisar resultado' : isAnalyzing ? 'Analisando' : 'Aguardando'}</span></div><textarea id="recognized-text" value={translation?.text || (isAnalyzing ? 'Analisando o sinal...' : '')} readOnly placeholder="O texto aparecerá aqui." /></div>
            {!translation && !isAnalyzing && <div className="empty-translation"><Hand size={34} /><strong>Aguardando sinal</strong><span>Ative a câmera e faça seu sinal. A interpretação acontece automaticamente.</span></div>}
            {isAnalyzing && <div className="empty-translation analyzing-copy"><div className="pulse-dot" /><strong>Interpretando</strong><span>Aguarde o resultado em português.</span></div>}
            {translation && !isAnalyzing && <div className="translation-result"><div className="demo-disclaimer"><Sparkles size={17} /><div><strong>{translation.status === 'recognized' ? 'Resultado encontrado' : 'Reconhecimento inconclusivo'}</strong><span>{translation.isPrototype ? 'Resultado local de desenvolvimento; valide com uma pessoa fluente em Libras.' : 'Revise o texto antes de utilizá-lo.'}</span></div></div>{translation.confidence != null && <span className="confidence"><Info size={16} /> Confiança: {Math.round(translation.confidence * 100)}%</span>}<blockquote>“{translation.text}”</blockquote></div>}
          </div>
        </div>
        <form className="vlibras-panel" onSubmit={translateAttendantResponse}>
          <div className="panel-label"><span className="label-dot vlibras-dot" /> Resposta do atendente em Libras <span className="panel-demo-label">{vlibrasStatus.configured ? 'VLibras conectado' : 'API não configurada'}</span></div>
          <div className="vlibras-input">
            <label htmlFor="attendant-response">Digite em português</label>
            <textarea id="attendant-response" value={attendantText} onChange={(event) => setAttendantText(event.target.value)} placeholder="Ex.: Olá, como posso ajudar?" rows={2} />
            <button className="primary-button" type="submit" disabled={isTranslatingAttendant || !attendantText.trim()}>{isTranslatingAttendant ? <><LoaderCircle size={17} className="spin" /> Traduzindo...</> : <><Languages size={17} /> Traduzir para Libras</>}</button>
          </div>
          {!vlibrasStatus.configured && <small className="vlibras-hint">Configure VLIBRAS_API_BASE_URL no servidor para ativar essa resposta.</small>}
          {vlibrasError && <div className="error-message vlibras-error"><Info size={16} /> {vlibrasError}</div>}
          {vlibrasResult && <div className="vlibras-result">
            <div className="recognized-field-header"><label htmlFor="vlibras-gloss">Glosa retornada pelo VLibras</label><span>tradução disponível</span></div>
            <textarea id="vlibras-gloss" value={vlibrasResult.gloss || ''} readOnly rows={2} />
            {vlibrasResult.videoUrl ? <video className="vlibras-video" controls src={vlibrasResult.videoUrl} /> : <small className="vlibras-hint">{vlibrasResult.videoId ? `Vídeo solicitado. Identificador: ${vlibrasResult.videoId}` : 'Glosa disponível. O vídeo pode ser ativado quando a rota de vídeo do VLibras estiver configurada.'}</small>}
          </div>}
        </form>
        {notice && <div className="notice"><Info size={16} /> {notice}</div>}
      </section>
    </main>

    <footer className="footer"><Info size={15} /> O vídeo é usado somente durante a interpretação e não fica armazenado pelo aplicativo.</footer>
  </div>
}

function App() {
  const mode = new URLSearchParams(window.location.search).get('modo')
  if (mode === 'alfabeto') return <AlphabetPractice />
  return <MainApp />
}

function DatasetScreen({ trainingLabel, onTrainingLabelChange, onExportTrainingData }) {
  return <section className="flow-section dataset-screen"><div className="dataset-screen-heading"><span className="kicker"><Database size={16} /> Desenvolvimento</span><h2>Dataset de especialistas</h2><p>Use vídeos rotulados de articuladores para preparar o reconhecimento.</p></div><DatasetBuilder trainingLabel={trainingLabel} onTrainingLabelChange={onTrainingLabelChange} onExportTrainingData={onExportTrainingData} /></section>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
