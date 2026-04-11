import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionConstructor = new () => SpeechRecognition;

/** Maps `i18n.language` (and similar) to a BCP-47 tag well supported by `SpeechRecognition.lang`. */
export function getSpeechRecognitionLanguage(appLanguage: string): string {
  const lower = appLanguage.toLowerCase();
  if (lower === 'pt-br' || lower.startsWith('pt-br')) return 'pt-BR';
  if (lower.startsWith('pt')) return 'pt-PT';
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('es')) return 'es-ES';
  return 'pt-PT';
}

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechToText() {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTextRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    setIsSupported(getRecognitionCtor() !== null);
  }, []);

  const stopListening = useCallback(() => {
    const r = recognitionRef.current;
    recognitionRef.current = null;
    if (r) {
      try {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.stop();
      } catch {
        try {
          r.abort();
        } catch {
          /* ignore */
        }
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    (onText: (text: string) => void, lang?: string) => {
      setError(null);
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        setError('not-supported');
        return;
      }

      stopListening();

      onTextRef.current = onText;
      const recognition = new Ctor();
      recognition.lang = lang || 'pt-PT';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let piece = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            piece += event.results[i][0].transcript;
          }
        }
        const trimmed = piece.trim();
        if (trimmed) {
          onTextRef.current(trimmed);
        }
      };

      recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (ev.error === 'aborted') return;
        if (ev.error === 'no-speech') return;
        if (ev.error === 'audio-capture') {
          setError('audio-capture');
        } else if (ev.error === 'not-allowed') {
          setError('not-allowed');
        } else {
          setError(ev.error);
        }
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        recognitionRef.current = null;
        setError('start-failed');
        setIsListening(false);
      }
    },
    [stopListening],
  );

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isSupported,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
