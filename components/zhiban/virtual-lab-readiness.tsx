'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SmartRemediationCard } from '@/components/zhiban/smart-remediation-card';
import type { ConceptErrorCode } from '@/lib/zhiban/learning-center';
import { resolveRemediationScene } from '@/lib/zhiban/scene-orchestration';

type ErrorState = { code: ConceptErrorCode; status: 'ACTIVE' | 'IMPROVING' | 'RESOLVED' | 'REOPENED'; occurrences: number };

export function VirtualLabReadiness({ courseId }: { courseId: string }) {
  const [states, setStates] = useState<ErrorState[]>([]);
  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => setStates(Array.isArray(body?.conceptErrorStates) ? body.conceptErrorStates : []))
      .catch(() => undefined);
  }, [courseId]);
  const recommendation = useMemo(() => {
    const active = states.filter((item) => item.status === 'ACTIVE' || item.status === 'REOPENED');
    return resolveRemediationScene({
      conceptErrors: active.flatMap((item) => Array(item.occurrences).fill(item.code)),
      currentSceneId: 'S06-01',
      stationId: 'station-06-virtual-lab',
      attemptHistory: active.map((item) => ({ code: item.code, count: item.occurrences })),
      currentCheckpoint: 'virtual-lab-readiness',
      contextMode: 'SELF_LEARNING',
    });
  }, [states]);
  return (
    <div className="mt-6 space-y-4">
      {recommendation && (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            你仍有一个关键知识点建议补强。可先完成智能补练，也可自主继续综合实训。
          </p>
          <SmartRemediationCard courseId={courseId} recommendation={recommendation} />
        </>
      )}
      <Button asChild>
        <Link href={`/zhiban/student/courses/${courseId}/learning-center/station-06-virtual-lab`}>
          {recommendation ? '继续实训' : '开始综合实训'}
        </Link>
      </Button>
    </div>
  );
}
