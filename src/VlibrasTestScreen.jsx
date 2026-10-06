import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Info, Languages, LoaderCircle, Sparkles } from 'lucide-react'
import { generateVlibrasVideo, getVlibrasStatus, translatePortugueseToGloss, VlibrasTranslationError } from './vlibrasApi'

const testPhrases = [
  'Olá, como posso ajudar?',
  'Seu pedido está pronto.',
  'Aguarde um momento, por favor.',
  'O valor ficou cinquenta reais.',
]

export function VlibrasTestScreen() {
  const [text, setText] = useState(testPhrases[0])
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState({ state: 'checking', configured: false, videoEnabled: false })
  const [error, setError] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)

  useEffect(() => {
    let active = true
    getVlibrasStatus().then((nextStatus) => {
      if (active) setStatus(nextStatus)
    }).catch(() => {
      if (active) setStatus({ state: 'unavailable', configured: false, videoEnabled: false })
    })
    return () => { active = false }
  }, [])

  const translate = async (event) => {
    event.preventDefault()
    const phrase = text.trim()
    if (!phrase) return

    setIsTranslating(true)
    setError('')
    setResult(null)
    try {
      const glossResult = await translatePortugueseToGloss(phrase)
      let videoResult = {}
      let videoMessage = ''

      if (status.videoEnabled) {
        try {
          videoResult = await generateVlibrasVideo(glossResult.gloss)
        } catch (videoError) {
          videoMessage = videoError instanceof VlibrasTranslationError
            ? videoError.message
            : 'A glosa foi gerada, mas o vídeo não ficou disponível.'
        }
      }

      setResult({ ...glossResult, ...videoResult, videoMessage })
      if (videoMessage) setError(videoMessage)
    } catch (translationError) {
      setError(translationError instanceof VlibrasTranslationError
        ? translationError.message
        : 'Não foi possível conectar ao VLibras agora.')
    } finally {
      setIsTranslating(false)
    }
  }

  const statusLabel = status.state === 'checking'
    ? 'Verificando conexão...'
    : status.configured
      ? 'API VLibras pronta'
      : 'API aguardando configuração'

  return <div className="app-shell test-app-shell">
    <header className="topbar test-topbar">
      <div className="brand"><div className="brand-mark"><Languages size={21} /></div><strong>Laboratório VLibras</strong></div>
      <div className={`test-api-status ${status.configured ? 'is-ready' : ''}`}><span className="status-dot" /> {statusLabel}</div>
    </header>

    <main className="main-content test-main-content">
      <a className="test-back-link" href="/"><ArrowLeft size={16} /> Voltar ao atendimento</a>
      <div className="test-heading">
        <div>
          <span className="kicker"><Sparkles size={15} /> Modo de teste</span>
          <h1>Português → Libras</h1>
          <p>Digite como o atendente falaria e confira a tradução que será entregue à pessoa surda.</p>
        </div>
        <div className="test-scope"><strong>Teste atual</strong><span>Resposta do atendente em Libras</span></div>
      </div>

      <div className="test-layout">
        <form className="test-card test-input-card" onSubmit={translate}>
          <div className="test-card-heading"><span className="test-step">1</span><div><strong>Escreva a frase</strong><span>Use uma frase curta para começar.</span></div></div>
          <label className="test-field-label" htmlFor="test-phrase">Frase do atendente</label>
          <textarea id="test-phrase" value={text} onChange={(event) => setText(event.target.value)} placeholder="Digite uma frase em português" rows={5} />
          <div className="test-phrases"><span>Exemplos</span>{testPhrases.map((phrase) => <button type="button" className={text === phrase ? 'selected' : ''} key={phrase} onClick={() => setText(phrase)}>{phrase}</button>)}</div>
          <button className="primary-button test-submit" type="submit" disabled={isTranslating || !text.trim()}>{isTranslating ? <><LoaderCircle size={17} className="spin" /> Traduzindo...</> : <><Languages size={17} /> Traduzir para Libras</>}</button>
          {!status.configured && <div className="test-warning"><Info size={16} /> Configure VLIBRAS_API_BASE_URL e reinicie o projeto para usar a API.</div>}
        </form>

        <section className={`test-card test-result-card ${result ? 'has-result' : ''}`} aria-live="polite">
          <div className="test-card-heading"><span className="test-step">2</span><div><strong>Resultado do VLibras</strong><span>Veja a glosa e o vídeo, se habilitado.</span></div></div>
          {!result && !isTranslating && <div className="test-empty"><Languages size={34} /><strong>Ainda não há tradução</strong><span>Envie uma frase ao lado para começar o teste.</span></div>}
          {isTranslating && <div className="test-empty"><LoaderCircle size={34} className="spin" /><strong>Consultando o VLibras</strong><span>Aguarde o retorno da tradução.</span></div>}
          {result && !isTranslating && <div className="test-output">
            <div className="test-success"><CheckCircle2 size={17} /> Glosa recebida</div>
            <label className="test-field-label" htmlFor="test-gloss">Glosa em Libras</label>
            <textarea id="test-gloss" value={result.gloss || ''} readOnly rows={4} />
            {result.videoUrl ? <video className="test-video" controls src={result.videoUrl} /> : <div className="test-video-note"><Info size={16} /> A glosa foi retornada. O vídeo fica disponível quando a rota de vídeo do VLibras estiver habilitada.</div>}
          </div>}
          {error && <div className="test-error"><Info size={16} /> {error}</div>}
        </section>
      </div>

      <div className="test-footer-note"><Info size={15} /> Esta tela valida somente Português → Libras. O reconhecimento de sinais pela câmera será tratado na próxima etapa.</div>
    </main>
  </div>
}
