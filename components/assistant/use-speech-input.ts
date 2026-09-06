"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Dictation via the browser's own speech recognition.
 *
 * Chrome and Edge implement this as `webkitSpeechRecognition` and hand the audio
 * to a Google service; Firefox implements nothing. So `supported` is false more
 * often than not, and every caller has to render a keyboard-only path anyway —
 * the microphone is an addition to the composer, never the way in.
 *
 * The API is unusual in that a session ends on its own, on silence or on an
 * error, without the caller asking. `listening` therefore tracks the recogniser's
 * own events rather than what we last told it to do.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type Constructor = new () => SpeechRecognitionLike;

function constructorFor(): Constructor | null {
  if (typeof window === "undefined") return null;

  const scope = window as unknown as {
    SpeechRecognition?: Constructor;
    webkitSpeechRecognition?: Constructor;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export type SpeechInput = {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
};

/** Whether the API exists never changes, so the store never notifies. */
const noop = () => () => {};

export function useSpeechInput(onTranscript: (text: string) => void): SpeechInput {
  /**
   * Read through useSyncExternalStore rather than set from an effect: the server
   * has no `window`, so the server snapshot is `false` and the client's is the
   * truth. That is exactly the hydration-safe read this hook needs, and it keeps
   * support out of state, where it would have been a render the browser did not
   * need.
   */
  const supported = useSyncExternalStore(
    noop,
    () => constructorFor() !== null,
    () => false,
  );

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Held in a ref so re-registering the callback each render does not tear down
  // and rebuild a live recognition session mid-sentence. Synced in an effect
  // rather than assigned during render, which React does not allow.
  const handler = useRef(onTranscript);
  useEffect(() => {
    handler.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = constructorFor();
    if (!Recognition) return;

    const instance = new Recognition();
    // en-IN: the vocabulary here is Indian names, places and rupee amounts.
    instance.lang = "en-IN";
    instance.continuous = false;
    instance.interimResults = false;

    instance.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) transcript += result[0]?.transcript ?? "";
      }
      const trimmed = transcript.trim();
      if (trimmed) handler.current(trimmed);
    };

    instance.onend = () => setListening(false);

    instance.onerror = (event) => {
      setListening(false);
      // "no-speech" and "aborted" are ordinary endings, not failures worth
      // putting in front of someone.
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(
        event.error === "not-allowed"
          ? "Microphone access was blocked."
          : "Dictation stopped unexpectedly.",
      );
    };

    recognition.current = instance;

    return () => {
      instance.onresult = null;
      instance.onend = null;
      instance.onerror = null;
      instance.abort();
      recognition.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!recognition.current || listening) return;
    setError(null);
    try {
      recognition.current.start();
      setListening(true);
    } catch {
      // Starting an already-started recogniser throws; nothing to recover from.
      setListening(false);
    }
  }, [listening]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, error, start, stop };
}
