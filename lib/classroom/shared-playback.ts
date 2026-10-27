/** Optional course host bridge; never contains chat, answers, or private board state. */
export type SharedCursor = { sceneId: string; actionIndex: number; mode: 'playing' | 'paused' };
type Bridge = {
  read: () => SharedCursor | null;
  apply: (v: SharedCursor) => Promise<boolean>;
  pause: () => void;
};
let bridge: Bridge | null = null;
export function bindSharedPlayback(value: Bridge) {
  bridge = value;
  return () => {
    if (bridge === value) bridge = null;
  };
}
export function sharedPlaybackCursor() {
  return bridge?.read() ?? null;
}
export function applySharedPlayback(v: SharedCursor) {
  return bridge?.apply(v) ?? Promise.resolve(false);
}
export function pauseSharedPlayback() {
  bridge?.pause();
}
