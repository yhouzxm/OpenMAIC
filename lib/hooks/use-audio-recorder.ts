import { GLM_RECORDING_SECONDS, isGlmAsr } from '@/lib/audio/asr-input-policy';
import { useState, useRef, useCallback, useEffect } from 'react';
import type { ASRProviderId } from '@/lib/audio/types';
import { normalizeASRUploadAudio } from '@/lib/audio/wav-utils';
import { loadModelCapabilities } from '@/lib/model-settings/capabilities';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioRecorder');

/** Shown when the workspace's asr slot resolves to nothing. */
export const ASR_NOT_CONFIGURED_MESSAGE = 'Speech recognition is not set up';

/**
 * The provider the workspace's asr slot resolves to (its registry id), and the
 * user's language for it. The provider, model and key are the server's.
 */
async function asrSetup(): Promise<{
  providerId: ASRProviderId;
  modelId?: string;
  language: string;
} | null> {
  const [{ asr }, { useSettingsStore, getValidASRLanguage }] = await Promise.all([
    loadModelCapabilities(),
    import('@/lib/store/settings'),
  ]);
  if (!asr) return null;
  const providerId = asr.registryId as ASRProviderId;
  return {
    providerId,
    modelId: asr.modelId,
    language: getValidASRLanguage(providerId, useSettingsStore.getState().asrLanguage),
  };
}

// Window.SpeechRecognition / webkitSpeechRecognition have minimal constructor
// declarations in types/web-speech.d.ts; this hook casts the richer instance.

export interface UseAudioRecorderOptions {
  onTranscription?: (text: string) => void;
  onError?: (error: string) => void;
  /** When true and using browser-native ASR, recognition stays active until explicitly stopped. */
  continuous?: boolean;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const { onTranscription, onError, continuous = false } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [maxRecordingSeconds, setMaxRecordingSeconds] = useState<number | undefined>();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Speech API not typed
  const speechRecognitionRef = useRef<any>(null);
  // Synchronous lock to prevent rapid re-entry (React state updates are async)
  const busyRef = useRef(false);
  const recordingGenerationRef = useRef(0);
  const transcriptionRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      recordingGenerationRef.current++;
      transcriptionRef.current?.abort();
      transcriptionRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        if (recorder.state === 'recording') recorder.stop();
        recorder.stream?.getTracks().forEach((track) => track.stop());
      }
      const recognition = speechRecognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.abort();
      }
    },
    [],
  );

  // Send audio to server for transcription
  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsProcessing(true);
      const abort = new AbortController();
      transcriptionRef.current = abort;

      try {
        const formData = new FormData();

        // The asr slot names the provider and model on the server; the
        // upload format and the language follow the provider it resolves to.
        const setup = typeof window !== 'undefined' ? await asrSetup() : null;
        if (setup) {
          const uploadAudio = await normalizeASRUploadAudio(
            setup.providerId,
            audioBlob,
            setup.modelId,
          );
          formData.append('audio', uploadAudio.blob, uploadAudio.fileName);
          formData.append('language', setup.language);
        } else {
          formData.append('audio', audioBlob, 'recording.webm');
        }

        if (abort.signal.aborted) return;
        const response = await fetch('/api/transcription', {
          method: 'POST',
          body: formData,
          signal: abort.signal,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(typeof error.error === 'string' ? error.error : '语音识别失败，请重试');
        }

        const result = await response.json();
        if (!abort.signal.aborted) onTranscription?.(result.text);
      } catch (error) {
        if (abort.signal.aborted) return;
        log.error('Transcription error:', error);
        onError?.(error instanceof Error ? error.message : '语音识别失败，请重试');
      } finally {
        if (transcriptionRef.current === abort) {
          transcriptionRef.current = null;
          busyRef.current = false;
          setIsProcessing(false);
          setRecordingTime(0);
        }
      }
    },
    [onTranscription, onError],
  );

  // Start recording
  const startRecording = useCallback(async () => {
    // Synchronous lock — React state is async so isRecording may be stale
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = ++recordingGenerationRef.current;
    try {
      let limit = Infinity;
      // Get current ASR configuration
      if (typeof window !== 'undefined') {
        // Nothing to record with when the asr slot is off or unassigned.
        const setup = await asrSetup();
        if (generation !== recordingGenerationRef.current) return;
        if (!setup) {
          // Release the lock: a later click (once speech input is set up) must work.
          busyRef.current = false;
          onError?.(ASR_NOT_CONFIGURED_MESSAGE);
          return;
        }
        const asrLanguage = setup.language;
        if (isGlmAsr(setup.providerId, setup.modelId)) limit = GLM_RECORDING_SECONDS;

        // Use browser native ASR if configured
        if (setup.providerId === 'browser-native') {
          // Check if Speech Recognition is supported
          if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
            busyRef.current = false;
            onError?.('您的浏览器不支持语音识别功能');
            return;
          }

          const SpeechRecognitionCtor = (window.SpeechRecognition ||
            window.webkitSpeechRecognition)!;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Speech API instance shape isn't in lib.dom
          const recognition: any = new SpeechRecognitionCtor();

          recognition.lang = asrLanguage || 'zh-CN';
          recognition.continuous = continuous;
          recognition.interimResults = false;

          recognition.onstart = () => {
            setIsRecording(true);
            setRecordingTime(0);

            // Start timer
            timerRef.current = setInterval(() => {
              setRecordingTime((prev) => prev + 1);
            }, 1000);
          };

          recognition.onresult = (event: {
            resultIndex: number;
            results: {
              [index: number]: {
                isFinal: boolean;
                [index: number]: { transcript: string };
              };
              length: number;
            };
          }) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (result.isFinal && result[0]?.transcript) {
                transcript += result[0].transcript;
              }
            }
            if (transcript) {
              onTranscription?.(transcript);
            }
          };

          recognition.onerror = (event: { error: string }) => {
            log.error('Speech recognition error:', event.error);
            let errorMessage = '语音识别失败';

            switch (event.error) {
              case 'aborted':
                // Non-fatal: caused by our own cancel/stop logic or rapid toggle
                busyRef.current = false;
                setIsRecording(false);
                setRecordingTime(0);
                if (timerRef.current) {
                  clearInterval(timerRef.current);
                  timerRef.current = null;
                }
                return;
              case 'no-speech':
                errorMessage = '未检测到语音输入';
                break;
              case 'audio-capture':
                errorMessage = '无法访问麦克风';
                break;
              case 'not-allowed':
                errorMessage = '麦克风权限被拒绝';
                break;
              case 'network':
                errorMessage = '网络错误';
                break;
              default:
                errorMessage = `语音识别错误: ${event.error}`;
            }

            onError?.(errorMessage);
            busyRef.current = false;
            setIsRecording(false);
            setRecordingTime(0);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          };

          recognition.onend = () => {
            busyRef.current = false;
            setIsRecording(false);
            setRecordingTime(0);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          };

          recognition.start();
          speechRecognitionRef.current = recognition;
          return;
        }
      }

      setMaxRecordingSeconds(Number.isFinite(limit) ? limit : undefined);
      // Use MediaRecorder for server-side ASR
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      // Create MediaRecorder
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());

        // Merge audio chunks
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });

        // Send to server for transcription
        await transcribeAudio(audioBlob);
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Stop outside the React state updater, which can be replayed.
      const started = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setRecordingTime(elapsed);
        if (elapsed >= limit && mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 1000);
    } catch (error) {
      if (generation !== recordingGenerationRef.current) return;
      busyRef.current = false;
      log.error('Failed to start recording:', error);
      onError?.('无法访问麦克风，请检查权限设置');
    }
  }, [onTranscription, onError, transcribeAudio, continuous]);

  // Stop recording
  const stopRecording = useCallback(() => {
    // Stop Speech Recognition if active
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      busyRef.current = false;
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Stop MediaRecorder if active
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      // Keep the lock until transcription completes.
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    recordingGenerationRef.current++;
    transcriptionRef.current?.abort();
    transcriptionRef.current = null;
    setIsProcessing(false);
    busyRef.current = false;
    // Cancel Speech Recognition if active
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.onresult = null; // Prevent transcription callback
      speechRecognitionRef.current.onerror = null; // Suppress browser abort error events
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      busyRef.current = false;
      setIsRecording(false);
      setRecordingTime(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Cancel MediaRecorder if active
    if (mediaRecorderRef.current && isRecording) {
      // Stop recording without transcription
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();

      // Stop all audio tracks
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }

      busyRef.current = false;
      setIsRecording(false);
      setRecordingTime(0);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      audioChunksRef.current = [];
    }
  }, [isRecording]);

  return {
    isRecording,
    isProcessing,
    recordingTime,
    maxRecordingSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
