'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Cloud } from 'lucide-react';
import { PBLRenderer } from '@/components/scene-renderers/pbl-renderer';
import { projectV2ToLegacyProjectConfig } from '@/lib/pbl/v2/compat';
import { useStageStore } from '@/lib/store/stage';
import { makeScene, type PBLContent } from '@/lib/types/stage';
import type { ZhibanPblInstance } from '@/lib/zhiban/pbl';
import { Button } from '@/components/ui/button';
import { ZhibanLogoutButton } from './logout-button';

export function PblInstanceRunner({ instance }: { instance: ZhibanPblInstance }) {
  const stageId = `zhiban-pbl-${instance.id}`; const sceneId = `${stageId}-scene`; const initialized = useRef(false);
  const content = useStageStore((state) => state.scenes.find((scene) => scene.id === sceneId)?.content);
  useEffect(() => {
    const project = instance.projectState;
    useStageStore.setState({
      stage: { id: stageId, name: instance.projectTitle, createdAt: Date.now(), updatedAt: Date.now() },
      scenes: [makeScene({ id: sceneId, stageId, title: instance.projectTitle, order: 0 }, {
        type: 'pbl', projectConfig: projectV2ToLegacyProjectConfig(project), projectV2: project,
      })], currentSceneId: sceneId, mode: 'playback',
    }); initialized.current = true;
    return () => { initialized.current = false; };
  }, [instance, sceneId, stageId]);
  useEffect(() => {
    if (!initialized.current || content?.type !== 'pbl' || !content.projectV2) return;
    const timer = window.setTimeout(() => { void fetch(`/api/zhiban/pbl/learning/${instance.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectState: content.projectV2 }),
    }); }, 800);
    return () => window.clearTimeout(timer);
  }, [content, instance.id]);
  if (!content || content.type !== 'pbl') return <div className="p-8">正在加载项目…</div>;
  return <main className="min-h-screen bg-slate-950 p-3"><header className="mb-3 flex items-center justify-between text-white"><Button variant="secondary" asChild><Link href="/zhiban/student/pbl"><ArrowLeft className="mr-2 size-4" />项目列表</Link></Button><div className="flex items-center gap-3"><div className="flex items-center gap-2 text-sm text-slate-300"><Cloud className="size-4" />进度自动保存到 PostgreSQL</div><ZhibanLogoutButton /></div></header><div className="h-[calc(100vh-76px)] overflow-hidden rounded-xl bg-background"><PBLRenderer content={content as PBLContent} mode="playback" sceneId={sceneId} /></div></main>;
}
