'use client';
import { create } from 'zustand';
interface ClassroomAccessState {
  lockedScenes: Record<string, string>;
  setLockedScenes: (value: Record<string, string>) => void;
  clear: () => void;
}
export const useClassroomAccessStore = create<ClassroomAccessState>((set) => ({
  lockedScenes: {},
  setLockedScenes: (lockedScenes) => set({ lockedScenes }),
  clear: () => set({ lockedScenes: {} }),
}));
