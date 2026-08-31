'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Factory,
  LockKeyhole,
  Map,
  Route,
  Target,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KNOWLEDGE_STATIONS } from '@/lib/zhiban/learning-center/registry';
import type { LearningCenterAccessState } from '@/lib/zhiban/learning-center/access';
import {
  emptyLearningCenterProgress,
  type LearningCenterProgress,
} from '@/lib/zhiban/learning-center';
import {
  createMechatronicsPblDefinition,
  MECHATRONICS_PROJECT_STAGES,
} from '@/lib/zhiban/scene-orchestration';

const localKey = (courseId: string) => `zhiban-learning-center:${courseId}`;

export function LearningCenter({
  courseId,
  previewMode,
  publicMode = false,
}: {
  courseId: string;
  previewMode?: 'teacher';
  publicMode?: boolean;
}) {
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [loading, setLoading] = useState(!publicMode);
  const [access, setAccess] = useState<LearningCenterAccessState>();
  const basePath = previewMode
    ? `/zhiban/teacher/courses/${courseId}/learning-center`
    : `/zhiban/student/courses/${courseId}/learning-center`;
  const project = createMechatronicsPblDefinition(courseId);

  useEffect(() => {
    if (publicMode) return;
    let active = true;
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as {
          progress?: LearningCenterProgress;
          access?: LearningCenterAccessState;
        };
        if (active && body.progress) setProgress(body.progress);
        if (active && body.access) setAccess(body.access);
      })
      .catch(() => {
        try {
          const cached = localStorage.getItem(localKey(courseId));
          if (active && cached) setProgress(JSON.parse(cached) as LearningCenterProgress);
        } catch {
          /* local fallback is optional */
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, publicMode]);

  const completedStations = KNOWLEDGE_STATIONS.filter(
    (station) => progress.stations[station.id]?.status === 'completed',
  ).length;
  // Teacher preview is an unrestricted catalogue view. It must not inherit a
  // student's current-learning pointer; every station is directly enterable.
  const currentStationId = previewMode
    ? undefined
    : publicMode
      ? KNOWLEDGE_STATIONS[0]?.id
      : access?.currentStationId;
  const currentStation = KNOWLEDGE_STATIONS.find((station) => station.id === currentStationId);
  const overallProgress = Math.round((completedStations / KNOWLEDGE_STATIONS.length) * 100);
  return (
    <main
      className="mx-auto max-w-[1580px] space-y-5 px-3 py-4 sm:px-4 md:px-6 md:py-6 lg:px-8"
      data-testid="learning-center"
    >
      <header className="relative overflow-hidden rounded-2xl border border-blue-900/20 bg-gradient-to-br from-[#061a42] via-[#123d71] to-[#08736d] p-6 text-white shadow-lg md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-64 rounded-full bg-blue-300/10 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-cyan-50 backdrop-blur-sm">
              <Map className="size-4" aria-hidden="true" />
              智伴·创学 · 机电一体化智能诊断学习中心
            </div>
            <h1 className="mt-4 max-w-4xl text-2xl font-semibold tracking-tight md:text-3xl">
              AI驱动的机电一体化智能诊断与虚拟实训交互课件
            </h1>
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-cyan-100 md:text-base">
              <Target className="size-4 shrink-0" aria-hidden="true" />
              沿信号链学机理，循证据链做诊断
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-slate-950/20 p-4 backdrop-blur-sm">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-blue-100">总体学习进度</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">
                  {completedStations}
                  <span className="ml-1 text-base font-normal text-blue-100">
                    / {KNOWLEDGE_STATIONS.length} 站
                  </span>
                </p>
              </div>
              <span className="text-sm font-medium text-cyan-100">{overallProgress}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-all"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-blue-100">
              {previewMode
                ? '教师可预览任意学习站'
                : currentStation
                  ? `继续学习：${currentStation.title}`
                  : '按七阶段路径逐步完成工程任务'}
            </p>
            {previewMode && (
              <Button
                asChild
                size="sm"
                className="mt-3 w-full bg-white text-blue-800 hover:bg-cyan-50"
              >
                <Link href={`${basePath}/analytics`}>
                  <BarChart3 className="mr-1.5 size-4" aria-hidden="true" />
                  课程学情分析
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="relative mt-6 rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-sm md:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-100">
              <Factory className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-100">
                核心工程任务
              </p>
              <h2 className="mt-1 text-lg font-semibold md:text-xl">{project.title}</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-blue-50/90">
                {project.description}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {MECHATRONICS_PROJECT_STAGES.map((stage, index) => (
              <div
                key={stage.stationId}
                className="group relative flex min-h-14 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/15 px-3 py-2.5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-cyan-50">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm font-medium text-white">{stage.label}</span>
                {index < MECHATRONICS_PROJECT_STAGES.length - 1 && (
                  <ArrowRight
                    className="absolute -right-3 z-10 hidden size-4 text-cyan-200/70 xl:block"
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>
      {previewMode && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          教师预览：可查看任意学习站；预览操作不会写入学生学习记录、画像或班级统计。
        </p>
      )}
      {access?.mode === 'review_demo' && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          评审演示：已授权快速预览学习路径；所有实训与评价数据仍按真实流程记录。
        </p>
      )}
      <section className="rounded-xl border bg-white p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Route className="size-5 text-blue-600" />
              <h2 className="font-semibold">学习路径</h2>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              按顺序完成学习站；已完成内容可随时复习，出现明确认知误区时系统会推荐针对性补练。
            </p>
          </div>
          {loading && <span className="text-xs text-slate-500">正在恢复学习进度…</span>}
        </div>
        <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KNOWLEDGE_STATIONS.map((station, index) => {
            const item = progress.stations[station.id];
            const decision = access?.stations[station.id];
            const enabled = previewMode
              ? true
              : (decision?.allowed ?? station.id === 'station-01-system');
            const locked = !enabled;
            const targetPath = publicMode ? '/zhiban/login' : `${basePath}/${station.id}`;
            const prerequisite = decision?.prerequisiteStationId;
            return (
              <article
                key={station.id}
                className={`relative rounded-xl border p-4 transition ${enabled ? 'border-blue-200 bg-blue-50/50 hover:-translate-y-0.5 hover:shadow-md' : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={enabled ? 'default' : 'outline'}>
                    {String(index + 1).padStart(2, '0')}
                  </Badge>
                  {previewMode ? (
                    <span className="text-xs text-slate-500">可进入</span>
                  ) : item?.status === 'completed' ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : locked ? (
                    <LockKeyhole className="size-4 text-slate-400" />
                  ) : (
                    <span className="text-xs text-slate-500">
                      {station.id === currentStationId
                        ? '当前学习'
                        : item?.status === 'in_progress'
                          ? '学习中'
                          : '可进入'}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 font-semibold">{station.title}</h3>
                <p className="mt-2 min-h-10 text-sm leading-5 text-slate-600">
                  {station.objective}
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded bg-slate-200">
                  <div
                    className="h-full rounded bg-blue-600 transition-all"
                    style={{ width: `${item?.progressPercent ?? 0}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>进度 {item?.progressPercent ?? 0}%</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3.5" aria-hidden="true" />
                    预计 {station.estimatedMinutes} 分钟
                  </span>
                </div>
                {enabled ? (
                  <Button asChild size="sm" className="mt-4 w-full">
                    <Link href={targetPath}>
                      {previewMode
                        ? '进入学习'
                        : item?.status === 'completed'
                          ? '再次进入'
                          : station.id === currentStationId || item?.status === 'in_progress'
                          ? '继续学习'
                          : '进入学习'}
                      <ArrowRight className="ml-1 size-4" />
                    </Link>
                  </Button>
                ) : (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-slate-500">
                      {decision?.reason ?? '完成上一学习站后解锁'}
                    </p>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link
                        href={
                          publicMode
                            ? '/zhiban/login'
                            : prerequisite
                              ? `${basePath}/${prerequisite}`
                              : basePath
                        }
                      >
                        前往上一站
                      </Link>
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {!publicMode && !progress.persistenceAvailable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          学习记录服务暂时不可用，当前进度会先保存在本机，恢复后可继续同步。
        </p>
      )}
    </main>
  );
}
