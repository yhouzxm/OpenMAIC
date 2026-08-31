'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStationPracticeMode } from '@/components/zhiban/learning-station-hero';
import { getStation } from '@/lib/zhiban/learning-center';
import type { LearningCenterProgress, StationId } from '@/lib/zhiban/learning-center';

const nextStations: Partial<Record<StationId, StationId>> = {
  'station-01-system': 'station-02-sensing',
  'station-02-sensing': 'station-03-control',
  'station-03-control': 'station-04-actuation',
  'station-04-actuation': 'station-05-diagnosis',
  'station-05-diagnosis': 'station-06-virtual-lab',
  'station-06-virtual-lab': 'station-07-assessment',
};

export function LearningStationCompletionGuide({
  courseId,
  stationId,
  previewMode,
}: {
  courseId: string;
  stationId: StationId;
  previewMode?: 'teacher' | 'review';
}) {
  const practiceMode = useStationPracticeMode();
  const [completedStationId, setCompletedStationId] = useState<StationId | null>(null);
  const nextStationId = nextStations[stationId];
  useEffect(() => {
    if (previewMode) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/zhiban/student/courses/${courseId}/learning-center`);
        const body = (await response.json()) as { progress?: LearningCenterProgress };
        if (active)
          setCompletedStationId(
            body.progress?.stations[stationId]?.status === 'completed' ? stationId : null,
          );
      } catch {
        // The activity itself remains usable when progress sync is offline.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [courseId, previewMode, stationId]);

  if (completedStationId !== stationId) return null;
  const next = nextStationId ? getStation(nextStationId) : undefined;
  if (practiceMode) {
    return (
      <section
        className="mt-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4"
        data-testid="station-practice-guide"
      >
        <div className="flex items-start gap-3">
          <RotateCcw className="mt-0.5 size-5 shrink-0 text-cyan-700" aria-hidden="true" />
          <div className="flex-1">
            <h2 className="font-semibold text-cyan-950">复习练习中</h2>
            <p className="mt-1 text-sm leading-6 text-cyan-900">
              本站的历史完成记录已保留。本轮请重新完成关键操作或挑战，新的提交会形成新的练习记录，不会因打开页面自动提高能力画像。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/zhiban/student/courses/${courseId}/learning-center`}>
                  结束复习并返回学习中心
                </Link>
              </Button>
              {nextStationId && (
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={`/zhiban/student/courses/${courseId}/learning-center/${nextStationId}`}
                  >
                    继续下一站
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
      data-testid="station-completion-guide"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <h2 className="font-semibold text-emerald-950">本学习站已完成</h2>
          <p className="mt-1 text-sm text-emerald-900">
            {nextStationId ? `下一站：${next?.title ?? '继续学习'}` : '已完成全部学习阶段。'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStationId && (
              <Button asChild size="sm">
                <Link href={`/zhiban/student/courses/${courseId}/learning-center/${nextStationId}`}>
                  进入下一站
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={`/zhiban/student/courses/${courseId}/learning-center`}>返回学习中心</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
