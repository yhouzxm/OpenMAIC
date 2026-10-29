// @vitest-environment jsdom
/**
 * A refused start (speech input off while the settings were loading) must
 * release the recorder's lock, so a later click works once speech input is on.
 */
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASR_NOT_CONFIGURED_MESSAGE, useAudioRecorder } from '@/lib/hooks/use-audio-recorder';
import { modelSettingsClient } from '@/lib/model-settings/client';

import { modelSettingsViewFor } from '../helpers/model-settings-view';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ locale: 'en-US' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  modelSettingsClient.adopt(null);
  vi.unstubAllGlobals();
});

describe('useAudioRecorder lock', () => {
  it('lets a click after a refused start record', async () => {
    const onError = vi.fn();
    const handle: { current?: ReturnType<typeof useAudioRecorder> } = {};
    const expose = (recorder: ReturnType<typeof useAudioRecorder>) => {
      handle.current = recorder;
    };
    function Probe({ onReady }: { onReady: typeof expose }) {
      const recorder = useAudioRecorder({ onError });
      useEffect(() => onReady(recorder));
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(createElement(Probe, { onReady: expose })));

    // Speech input turned off in the workspace.
    const off = modelSettingsViewFor({});
    off.slots.find((slot) => slot.slot === 'asr')!.effective = {
      status: 'disabled',
      resolvedAt: 'asr',
      source: 'workspace',
    };
    modelSettingsClient.adopt(off);
    await act(async () => handle.current!.startRecording());
    expect(onError).toHaveBeenCalledWith(ASR_NOT_CONFIGURED_MESSAGE);

    // Turned on (browser recognition): the next click starts recognition.
    const start = vi.fn();
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      start = start;
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    modelSettingsClient.adopt(modelSettingsViewFor({ asr: { registryId: 'browser-native' } }));
    await act(async () => handle.current!.startRecording());
    expect(start).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});

it('releases a microphone permission result arriving after cancellation', async () => {
  const handle: { current?: ReturnType<typeof useAudioRecorder> } = {};
  function Probe() {
    const recorder = useAudioRecorder();
    useEffect(() => {
      handle.current = recorder;
    });
    return null;
  }
  const stop = vi.fn();
  let grant!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
  );
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  modelSettingsClient.adopt(
    modelSettingsViewFor({ asr: { registryId: 'openai-whisper', modelId: 'glm-asr-2512' } }),
  );
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  let started!: Promise<void>;
  await act(async () => {
    started = handle.current!.startRecording();
    await Promise.resolve();
  });
  expect(getUserMedia).toHaveBeenCalledOnce();
  await act(async () => handle.current!.cancelRecording());
  await act(async () => {
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await started;
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(handle.current!.isRecording).toBe(false);
  await act(async () => root.unmount());
});
