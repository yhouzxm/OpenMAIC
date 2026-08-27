import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStation } from '@/lib/zhiban/learning-center';
import type { StationId } from '@/lib/zhiban/learning-center';

export function LearningStationLocked({
  courseId,
  stationId,
  prerequisiteStationId,
  reason,
  basePath,
}: {
  courseId: string;
  stationId: StationId;
  prerequisiteStationId: StationId | null;
  reason: string | null;
  basePath?: string;
}) {
  const station = getStation(stationId);
  const prerequisite = prerequisiteStationId ? getStation(prerequisiteStationId) : null;
  const centerPath = basePath ?? `/zhiban/student/courses/${courseId}/learning-center`;
  const prerequisitePath = prerequisiteStationId ? `${centerPath}/${prerequisiteStationId}` : centerPath;
  return (
    <main className="mx-auto max-w-2xl rounded-xl border bg-white p-8 text-center shadow-sm">
      <LockKeyhole className="mx-auto size-10 text-slate-400" />
      <h1 className="mt-4 text-xl font-semibold">{station?.title ?? '学习站'}暂未解锁</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {reason ?? '请先完成前置学习任务。'}
        {prerequisite ? ` 请先完成“${prerequisite.title}”。` : ''}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {prerequisite && (
          <Button asChild>
            <Link href={prerequisitePath}>前往上一站</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={centerPath}>返回学习中心</Link>
        </Button>
      </div>
    </main>
  );
}
