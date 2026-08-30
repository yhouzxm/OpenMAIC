'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Route, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { KNOWLEDGE_STATIONS } from '@/lib/zhiban/learning-center/registry';
import type { StationId } from '@/lib/zhiban/learning-center';

export function LearningStationHero({
  courseId,
  stationId,
  headline,
  description,
  progressPercent,
  completed = false,
  previewMode = false,
}: {
  courseId: string;
  stationId: StationId;
  headline: string;
  description: string;
  progressPercent?: number;
  completed?: boolean;
  previewMode?: boolean;
}) {
  const stationIndex = KNOWLEDGE_STATIONS.findIndex((item) => item.id === stationId);
  const station = KNOWLEDGE_STATIONS[stationIndex];
  if (!station) return null;
  const stationNumber = String(stationIndex + 1).padStart(2, '0');
  const normalizedProgress = Math.min(100, Math.max(0, progressPercent ?? 0));
  const learningCenterPath = previewMode
    ? `/zhiban/teacher/courses/${courseId}/learning-center`
    : `/zhiban/student/courses/${courseId}/learning-center`;

  return (
    <header className="relative overflow-hidden rounded-2xl border border-blue-900/20 bg-gradient-to-br from-[#071b48] via-[#123d71] to-[#0f766e] p-5 text-white shadow-lg md:p-6">
      <div className="pointer-events-none absolute -right-14 -top-20 size-56 rounded-full bg-cyan-300/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 size-48 rounded-full bg-blue-300/10 blur-3xl" />
      <span
        className="pointer-events-none absolute right-5 top-2 select-none text-[88px] font-black leading-none text-white/[0.045] md:right-8 md:text-[116px]"
        aria-hidden="true"
      >
        {stationNumber}
      </span>

      <div className="relative">
        <Link
          href={learningCenterPath}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-blue-50 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          返回学习中心
        </Link>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-white/15 bg-white/15 text-white hover:bg-white/15">
                {stationNumber} · {station.title}
              </Badge>
              {completed && (
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                  <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />
                  本站已完成
                </Badge>
              )}
              {previewMode && (
                <Badge className="border border-white/20 bg-white/10 text-white hover:bg-white/10">
                  教师预览
                </Badge>
              )}
            </div>
            <h1 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight md:text-3xl">
              {headline}
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-blue-50/90">{description}</p>
          </div>

          <div className="rounded-xl border border-white/15 bg-slate-950/20 p-3.5 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-50">
              <Timer className="size-4" aria-hidden="true" />
              本站预计 {station.estimatedMinutes} 分钟
            </div>
            {progressPercent !== undefined && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3 text-xs text-blue-100">
                  <span className="inline-flex items-center gap-1.5">
                    <Route className="size-3.5" aria-hidden="true" />
                    本站进度
                  </span>
                  <span className="font-medium tabular-nums text-white">{normalizedProgress}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-all"
                    style={{ width: `${normalizedProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
