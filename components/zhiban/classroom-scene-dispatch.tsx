'use client';

import Link from 'next/link';
import { RefreshCw, Route, Wrench } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Dispatch = {
  id: string;
  version: number;
  status: 'PREPARED' | 'ACTIVE' | 'COMPLETED';
  dispatchType: 'SCENE' | 'VIRTUAL_LAB';
  activeSceneId: string | null;
  dispatchPayload: Record<string, unknown>;
  scene: { id: string; title: string; stationId: string } | null;
};

export function ClassroomSceneDispatch({ bindingId, courseId }: { bindingId: string; courseId: string }) {
  const [session, setSession] = useState<Dispatch | null>(null);
  const [warning, setWarning] = useState('');
  const versionRef = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/zhiban/classrooms/${bindingId}/current-dispatch`, { cache: 'no-store' });
      if (!response.ok) throw new Error('sync failed');
      const body = (await response.json()) as { session: Dispatch | null };
      if (!body.session || body.session.version !== versionRef.current) {
        versionRef.current = body.session?.version ?? 0;
        setSession(body.session);
      }
      setWarning('');
    } catch {
      setWarning('课堂任务暂时无法同步，可手动刷新。');
    }
  }, [bindingId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const enter = () => {
    if (!session?.activeSceneId) return;
    void fetch(`/api/zhiban/classrooms/${bindingId}/scene-events`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sceneId: session.activeSceneId,
        classroomSceneSessionId: session.id,
        eventType: session.dispatchPayload.remediation ? 'REMEDIATION_SCENE_ENTERED' : 'ENTER_SCENE',
        conceptErrors: [],
        payload: {},
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  };

  if (!session && !warning) return null;
  const query = session
    ? new URLSearchParams({
        classroomBindingId: bindingId,
        classroomSceneSessionId: session.id,
        sceneId: session.activeSceneId ?? '',
      }).toString()
    : '';
  const href = session?.dispatchType === 'VIRTUAL_LAB'
    ? `/zhiban/student/courses/${courseId}/activities/mech-lab-line-stop?${query}`
    : session?.scene
      ? `/zhiban/student/courses/${courseId}/learning-center/${session.scene.stationId}?${query}`
      : '#';

  return (
    <aside className="fixed right-4 top-4 z-[110] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-blue-300 bg-white/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-blue-600">课堂共享任务</p>
          {session?.status === 'ACTIVE' ? (
            <>
              <h2 className="mt-1 font-semibold text-slate-900">
                {session.dispatchType === 'VIRTUAL_LAB' ? '教师已发布综合实训' : `教师已发布课堂任务：${session.scene?.title ?? session.activeSceneId}`}
              </h2>
              <p className="mt-1 text-xs text-slate-500">版本 {session.version}</p>
            </>
          ) : <p className="mt-1 text-sm text-slate-600">当前暂无正在进行的课堂任务。</p>}
        </div>
        <Button size="icon" variant="ghost" aria-label="刷新课堂任务" onClick={() => void refresh()}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {warning && <p className="mt-2 text-sm text-amber-700">{warning}</p>}
      {session?.status === 'ACTIVE' && (
        <Button className="mt-3 w-full" asChild onClick={enter}>
          <Link href={href}>
            {session.dispatchType === 'VIRTUAL_LAB' ? <Wrench className="mr-2 size-4" /> : <Route className="mr-2 size-4" />}
            进入课堂任务
          </Link>
        </Button>
      )}
    </aside>
  );
}
