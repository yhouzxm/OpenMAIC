'use client';
/** Native PBL surface over the current member's course-bound server state. */
import { useCallback, useEffect, useState, useRef } from 'react';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import {
  changePublishedPbl,
  disconnectPublishedPbl,
  hasPendingPublishedPbl,
  loadPublishedPbl,
} from '@/lib/classroom/published-pbl-host';
import { PBLV2Container } from './pbl-renderer';
export function PublishedPblRenderer({ sceneId }: { sceneId: string }) {
  const [project, setProject] = useState<PBLProjectV2 | null>(null),
    [message, setMessage] = useState('正在读取本人项目…'),
    [error, setError] = useState('');
  const liveProject = useRef<PBLProjectV2 | null>(null);
  const getLiveProject = useCallback(() => liveProject.current, []);
  useEffect(() => {
    let live = true;
    void loadPublishedPbl(sceneId, (m) => {
      if (live) {
        setMessage(m);
        if (m.startsWith('本次执行或保存未完成')) setError(m);
      }
    })
      .then((p) => {
        if (live) {
          liveProject.current = p;
          setProject(p);
          setMessage('本人独立练习 · AI 评价不写正式成绩');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const protect = (event: BeforeUnloadEvent) => {
      if (hasPendingPublishedPbl()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    addEventListener('beforeunload', protect);
    return () => {
      live = false;
      disconnectPublishedPbl(sceneId);
      removeEventListener('beforeunload', protect);
    };
  }, [sceneId]);
  const change = useCallback((next: PBLProjectV2) => {
    try {
      changePublishedPbl(next);
      liveProject.current = next;
      setProject(next);
      setMessage('正在保存本人练习…');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  if (error)
    return (
      <div className="p-6" role="alert">
        {error} <button onClick={() => location.reload()}>重新打开项目</button>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2 text-xs" role="status">
        {message} · 成果支持文字／安全链接及本地文本文件；正式小组成果请回课程 PBL 提交。
      </div>
      <div className="min-h-0 flex-1">
        {project && (
          <PBLV2Container
            sceneId={sceneId}
            projectV2={project}
            onProjectV2Change={change}
            getLiveProject={getLiveProject}
          />
        )}
      </div>
    </div>
  );
}
