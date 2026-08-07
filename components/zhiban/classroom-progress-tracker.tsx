'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store/stage';
import { evaluateSceneAccess } from '@/lib/zhiban/classroom/scene-access';
import type { ClassroomEventType } from '@/lib/zhiban/classroom/types';
import { useClassroomAccessStore } from '@/lib/zhiban/classroom/client-access-store';
import type { SceneRuleSetting } from '@/lib/zhiban/teacher-courses';

interface SessionState {
  currentSceneId: string | null;
  visitedSceneIds: string[];
  sceneRules: SceneRuleSetting[];
  maxScore: number | null;
}
export function ClassroomProgressTracker({ bindingId }: { bindingId: string }) {
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const scenes = useStageStore((state) => state.scenes);
  const [session, setSession] = useState<SessionState | null>(null);
  const sceneCount = useRef(0);
  const sent = useRef(new Set<string>());
  const visited = useRef(new Set<string>());
  const lastAllowed = useRef<string | null>(null);
  const restored = useRef(false);
  const setLockedScenes = useClassroomAccessStore((state) => state.setLockedScenes);
  useEffect(() => {
    sceneCount.current = scenes.length;
  }, [scenes.length]);
  const post = useCallback(
    async (
      eventType: ClassroomEventType,
      sceneId?: string,
      payload: Record<string, unknown> = {},
    ) => {
      const dedupe =
        eventType === 'classroom_opened' ||
        eventType === 'scene_viewed' ||
        eventType === 'classroom_completed';
      const key = `${eventType}:${sceneId ?? ''}`;
      if (dedupe && sent.current.has(key)) return true;
      if (dedupe) sent.current.add(key);
      const progressPercent =
        eventType === 'classroom_completed'
          ? 100
          : sceneCount.current
            ? Math.min(99, Math.round((visited.current.size / sceneCount.current) * 100))
            : 0;
      const response = await fetch(`/api/zhiban/classrooms/${bindingId}/session`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          eventType,
          sceneId,
          progressPercent,
          payload,
          occurredAt: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        if (dedupe) sent.current.delete(key);
        const body = await response.json().catch(() => ({}));
        if (response.status === 400 && sceneId) toast.error(body.error ?? '该场景尚未开放');
        return false;
      }
      return true;
    },
    [bindingId],
  );
  useEffect(() => {
    void fetch(`/api/zhiban/classrooms/${bindingId}/session`, { method: 'POST' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        visited.current = new Set(body.visitedSceneIds ?? []);
        setSession(body);
        await post('classroom_opened');
      })
      .catch((error) => toast.error(error.message));
  }, [bindingId, post]);
  useEffect(() => {
    if (!session || !scenes.length || restored.current) return;
    restored.current = true;
    const target =
      session.currentSceneId && scenes.some((scene) => scene.id === session.currentSceneId)
        ? session.currentSceneId
        : scenes[0]?.id;
    if (target) {
      lastAllowed.current = target;
      useStageStore.getState().setCurrentSceneId(target);
    }
  }, [scenes, session]);
  useEffect(() => {
    if (!session || !currentSceneId) return;
    const decision = evaluateSceneAccess(session.sceneRules, currentSceneId, {
      visitedSceneIds: [...visited.current],
      maxScore: session.maxScore,
      now: new Date(),
    });
    if (!decision.allowed) {
      toast.error(decision.reason ?? '该场景尚未开放');
      useStageStore.getState().setCurrentSceneId(lastAllowed.current ?? scenes[0]?.id ?? null);
      return;
    }
    lastAllowed.current = currentSceneId;
    visited.current.add(currentSceneId);
    void post('scene_viewed', currentSceneId).then((ok) => {
      if (!ok)
        useStageStore.getState().setCurrentSceneId(lastAllowed.current ?? scenes[0]?.id ?? null);
    });
  }, [currentSceneId, post, scenes, session]);
  useEffect(() => {
    if (!session) return;
    const locked: Record<string, string> = {};
    for (const scene of scenes) {
      const decision = evaluateSceneAccess(session.sceneRules, scene.id, {
        visitedSceneIds: [...visited.current],
        maxScore: session.maxScore,
        now: new Date(),
      });
      if (!decision.allowed) locked[scene.id] = decision.reason ?? '该场景尚未开放';
    }
    setLockedScenes(locked);
  }, [currentSceneId, scenes, session, setLockedScenes]);
  useEffect(() => () => useClassroomAccessStore.getState().clear(), []);
  useEffect(() => {
    if (session && scenes.length > 0 && visited.current.size >= scenes.length)
      void post('classroom_completed', currentSceneId ?? undefined);
  }, [currentSceneId, post, scenes.length, session]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type: ClassroomEventType;
          sceneId?: string;
          payload?: Record<string, unknown>;
        }>
      ).detail;
      if (typeof detail?.payload?.score === 'number')
        setSession((current) =>
          current
            ? {
                ...current,
                maxScore: Math.max(current.maxScore ?? 0, detail.payload!.score as number),
              }
            : current,
        );
      if (detail?.type)
        void post(detail.type, detail.sceneId ?? currentSceneId ?? undefined, detail.payload ?? {});
    };
    window.addEventListener('zhiban:classroom-interaction', handler);
    return () => window.removeEventListener('zhiban:classroom-interaction', handler);
  }, [currentSceneId, post]);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const scene = scenes.find((item) => item.id === currentSceneId);
      if (!scene) return;
      if ((event.target as Element | null)?.closest?.('a[href]')) {
        void post('resource_opened', scene.id);
        return;
      }
      const type: ClassroomEventType =
        scene.type === 'quiz'
          ? 'quiz_answered'
          : scene.type === 'interactive'
            ? 'simulation_interacted'
            : scene.type === 'pbl'
              ? 'pbl_activity'
              : 'slide_action';
      void post(type, scene.id);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [currentSceneId, post, scenes]);
  return null;
}
