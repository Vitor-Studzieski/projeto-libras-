import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, Hand, Info, RotateCcw, Sparkles } from 'lucide-react'
import { useHandTracking } from './useHandTracking'
import {
  extractHandFeatures,
  FINGER_LABELS,
  FINGER_STATE_LABELS,
  LetterStabilizer,
  LIBRAS_ALPHABET,
  recognizeStaticLetter,
} from './librasAlphabet'

const STATE_CLASSES = {
  extended: 'alphabet-state-extended',
  half: 'alphabet-state-half',
  curled: 'alphabet-state-curled',
}

export function AlphabetPractice() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const stabilizerRef = useRef(new LetterStabilizer())
  const lastUiUpdateRef = useRef(0)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [selectedLetter, setSelectedLetter] = useState(null)
  const [snapshot, setSnapshot] = useState({ features: null, matches: [], stable: null })

  const handleFrame = useCallback((result) => {
    const landmarks = result.landmarks?.[0]
    const features = extractHandFeatures(landmarks)
    const matches = recognizeStaticLetter(features)
    const stable = stabilizerRef.current.push(matches[0] || null)
    const now = performance.now()
    if (now - lastUiUpdateRef.current >= 140) {
      setSnapshot({ features, matches, stable })
      lastUiUpdateRef.current = now
    }
  }, [])

  const tracking = useHandTracking({
    videoRef,
    canvasRef,
    enabled: active,
    onFrame: handleFrame,
  })

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    stabilizerRef.current.reset()
    setSnapshot({ features: null, matches: [], stable: null })
    setActive(false)
  }, [])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const startCamera = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador não disponibiliza acesso à câmera.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      stabilizerRef.current.reset()
      setActive(true)
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      const message = cause instanceof Error ? cause.message : 'Não foi possível acessar a câmera.'
      setError(message)
    }
  }

  const best = snapshot.matches[0]
  const target = LIBRAS_ALPHABET.find((item) => item.letter === selectedLetter)
  const stableTarget = target && snapshot.stable === target.letter

  return (
    <div className="app-shell alphabet-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Hand size={21} /></div>
          <strong>Prática do alfabeto manual</strong>
        </div>
        <a className="dev-link" href="/"><ArrowLeft size={15} /> Voltar ao atendimento</a>
      </header>

      <main className="main-content alphabet-main">
        <section className="alphabet-heading">
          <span className="kicker"><Sparkles size={15} /> Laboratório experimental</span>
          <h1>Explore as formas das letras</h1>
          <p>
            Compare poses estáticas da mão com uma tabela heurística. O recurso ajuda a explorar
            formas do alfabeto manual, mas não reconhece Libras de forma confiável nem traduz sinais.
          </p>
        </section>

        <div className="alphabet-layout">
          <section className="alphabet-card">
            <div className="alphabet-video">
              <video ref={videoRef} autoPlay muted playsInline />
              {active && <canvas ref={canvasRef} className="landmark-canvas" aria-hidden="true" />}
              {!active && (
                <div className="alphabet-camera-overlay">
                  <Camera size={38} />
                  <strong>Ative a câmera para explorar as poses</strong>
                  <button className="primary-button" type="button" onClick={startCamera}>
                    <Camera size={16} /> Ativar câmera
                  </button>
                </div>
              )}
            </div>

            {error && <div className="error-message"><Info size={16} /> {error}</div>}

            <div className="alphabet-camera-status">
              <span className={`tracking-badge tracking-${tracking.status}`}>
                <span className="tracking-dot" />
                {tracking.status === 'detecting' ? 'Detectando mãos'
                  : tracking.status === 'loading' ? 'Carregando detector'
                    : tracking.status === 'error' ? 'Detector indisponível'
                      : active ? 'Câmera ativa' : 'Câmera desligada'}
              </span>
              <span>{tracking.hands} {tracking.hands === 1 ? 'mão detectada' : 'mãos detectadas'}</span>
            </div>
            {tracking.error && <div className="tracking-error"><Info size={15} /> {tracking.error}</div>}

            <div className="alphabet-actions">
              {active && <button className="secondary-button" type="button" onClick={stopCamera}><RotateCcw size={15} /> Desligar câmera</button>}
              {target && <button className="secondary-button" type="button" onClick={() => setSelectedLetter(null)}>Sair do exercício</button>}
            </div>

            {target ? (
              <div className="alphabet-target">
                <span className="alphabet-target-label">Letra escolhida para praticar</span>
                <div className="alphabet-target-row">
                  <strong>{target.letter}</strong>
                  <div>
                    <span>{target.hint}</span>
                    {target.motion && <small>{target.motion}</small>}
                  </div>
                </div>
                <p className={stableTarget ? 'alphabet-feedback is-match' : 'alphabet-feedback'}>
                  {stableTarget
                    ? 'A tabela encontrou uma pose parecida de forma estável. Use apenas como referência de estudo.'
                    : best
                      ? `Melhor correspondência agora: ${best.signature.letter} (${Math.round(best.score * 100)}% de compatibilidade estimada).`
                      : 'Mostre uma mão para a câmera para começar a comparar a pose.'}
                </p>
              </div>
            ) : (
              <p className="alphabet-instruction">Escolha uma letra abaixo para ver a descrição da pose enquanto pratica.</p>
            )}
          </section>

          <div className="alphabet-side-column">
            <section className="alphabet-card alphabet-prediction">
              <div className="alphabet-card-heading">
                <div>
                  <span>Palpite de pose</span>
                  <strong>{snapshot.stable || best?.signature.letter || '—'}</strong>
                </div>
                {best && <span className="alphabet-score">{Math.round(best.score * 100)}%<small> compatibilidade</small></span>}
              </div>
              <p>{best?.signature.hint || (active ? 'Mantenha a mão visível no quadro.' : 'A estimativa aparece ao ativar a câmera.')}</p>
              {best?.signature.motion && <small className="alphabet-motion-note">{best.signature.motion}</small>}
              <div className="alphabet-match-list">
                {snapshot.matches.map((match) => (
                  <div className="alphabet-match" key={match.signature.letter}>
                    <span>{match.signature.letter}</span>
                    <div><i style={{ width: `${Math.round(match.score * 100)}%` }} /></div>
                    <small>{Math.round(match.score * 100)}%</small>
                  </div>
                ))}
                {!snapshot.matches.length && <span className="alphabet-muted">Sem pose disponível.</span>}
              </div>
            </section>

            <section className="alphabet-card alphabet-hand-state">
              <div className="alphabet-section-heading">
                <div><span>Leitura geométrica</span><strong>Estado estimado dos dedos</strong></div>
              </div>
              {snapshot.features ? (
                <div className="alphabet-finger-list">
                  {Object.entries(FINGER_LABELS).map(([finger, label]) => {
                    const state = snapshot.features.fingers[finger]
                    return (
                      <div className={`alphabet-finger ${STATE_CLASSES[state]}`} key={finger}>
                        <span>{label}</span>
                        <strong>{FINGER_STATE_LABELS[state]} · {snapshot.features.curls[finger].toFixed(2)}</strong>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="alphabet-muted">Aguardando uma mão no quadro.</p>}
            </section>
          </div>
        </div>

        <section className="alphabet-card alphabet-reference">
          <div className="alphabet-section-heading">
            <div><span>Referência textual</span><strong>Alfabeto manual</strong></div>
            <small>Selecione uma letra para praticar</small>
          </div>
          <div className="alphabet-grid">
            {LIBRAS_ALPHABET.map((item) => (
              <button
                type="button"
                key={item.letter}
                title={item.hint}
                aria-pressed={selectedLetter === item.letter}
                className={selectedLetter === item.letter ? 'is-selected' : ''}
                onClick={() => setSelectedLetter((current) => current === item.letter ? null : item.letter)}
              >
                {item.letter}
              </button>
            ))}
          </div>
        </section>

        <aside className="alphabet-disclaimer">
          <Info size={17} />
          <p><strong>Uso educacional experimental.</strong> As assinaturas e pontuações são aproximações escritas à mão, não foram validadas com uma base representativa e não devem orientar atendimento, comunicação ou avaliação de proficiência. Letras que dependem de movimento não podem ser distinguidas apenas pela pose.</p>
        </aside>
      </main>
      <footer className="footer"><Info size={15} /> A câmera é processada localmente pelo MediaPipe; esta tela não grava nem envia vídeo.</footer>
    </div>
  )
}
