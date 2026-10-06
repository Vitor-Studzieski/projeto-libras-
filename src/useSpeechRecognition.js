import { useCallback, useEffect, useRef, useState } from 'react'

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function useSpeechRecognition({ onFinalTranscript }) {
  const recognitionRef = useRef(null)
  const callbackRef = useRef(onFinalTranscript)
  const supported = Boolean(getSpeechRecognitionConstructor())
  const [state, setState] = useState({
    status: supported ? 'idle' : 'unsupported',
    interimTranscript: '',
    transcript: '',
    error: '',
  })

  useEffect(() => {
    callbackRef.current = onFinalTranscript
  }, [onFinalTranscript])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setState((current) => ({ ...current, status: 'idle', interimTranscript: '' }))
  }, [])

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      setState((current) => ({ ...current, status: 'unsupported', error: 'Este navegador não oferece reconhecimento de voz.' }))
      return
    }

    recognitionRef.current?.abort()
    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setState((current) => ({ ...current, status: 'listening', interimTranscript: '', error: '' }))
    }

    recognition.onresult = (event) => {
      let interimTranscript = ''
      let finalTranscript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript
        if (event.results[index].isFinal) finalTranscript += text
        else interimTranscript += text
      }
      setState((current) => ({ ...current, interimTranscript, transcript: finalTranscript || current.transcript }))
      if (finalTranscript.trim()) callbackRef.current(finalTranscript.trim())
    }

    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'O acesso ao microfone foi negado.',
        'audio-capture': 'Nenhum microfone disponível foi encontrado.',
        'no-speech': 'Nenhuma fala foi detectada.',
        network: 'O serviço de reconhecimento de voz não está disponível.',
      }
      setState((current) => ({ ...current, status: 'error', error: messages[event.error] || `Erro no reconhecimento de voz: ${event.error}` }))
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setState((current) => ({ ...current, status: current.status === 'error' ? 'error' : 'idle', interimTranscript: '' }))
    }

    recognitionRef.current = recognition
    setState((current) => ({ ...current, status: 'starting', error: '' }))
    try {
      recognition.start()
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error: error.message || 'Não foi possível iniciar o microfone.' }))
    }
  }, [])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { ...state, supported, start, stop }
}
