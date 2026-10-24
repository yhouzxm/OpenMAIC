import React, { useCallback, useEffect, useState } from 'react';
export type JointEntry = {
  attemptId: string;
  activityId: string;
  activityVersion: string;
  sessionId: string;
  dispatchId: string;
  bindingId: string;
};
type Evidence = {
  binding: {
    id: string;
    title: string;
    attemptNumber: number;
    activityVersion: number;
    publicationNo: number;
  };
  attemptStatus: string;
  events: { id: string; type: string; at: number; submissionVersion?: number }[];
  moreEvents: boolean;
};
/** Exact server-resolved classroom entry. No activity picker or implicit retake. */
export function JointAttemptPanel({
  base,
  publicationId,
  joint,
}: {
  base: string;
  publicationId: string;
  joint: JointEntry;
}) {
  const [, tenant, offering, resource] =
    /\/content\/([^/]+)\/offerings\/([^/]+)\/resources\/([^/]+)$/.exec(base)!;
  const [evidence, setEvidence] = useState<Evidence | null>(null),
    [notice, setNotice] = useState('正在核对本次课堂作答…'),
    [course, setCourse] = useState('');
  const read = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(base + '/runtime?attempt=' + joint.attemptId, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        cache: 'no-store',
        signal,
      });
      if (!r.ok) throw Error('当前登录或课程资格已变化，请返回课堂重新进入。');
      const data = await r.json();
      if (data.binding?.id !== joint.bindingId || data.binding?.publicationId !== publicationId)
        throw Error('本次课堂绑定不一致，请返回课堂重新进入。');
      setEvidence(data);
      setNotice('本次课堂已固定关联作答，无需再选择活动。');
    },
    [base, joint.attemptId, joint.bindingId, publicationId],
  );
  useEffect(() => {
    const c = new AbortController();
    const poll = () => {
      if (!document.hidden)
        void read(c.signal).catch((e) => {
          if (!c.signal.aborted) {
            setEvidence(null);
            setNotice(e.message);
          }
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    void fetch(`/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=20`, {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
      signal: c.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) =>
        setCourse(p?.rows.find((x: { id: string }) => x.id === offering)?.course_id ?? ''),
      )
      .catch(() => {});
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [read, tenant, offering]);
  const activityUrl = `/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${offering}&classroomTask=${joint.dispatchId}&classroomAttempt=${joint.attemptId}&jointResource=${resource}&jointPublication=${publicationId}&jointDispatch=${joint.dispatchId}#classroom-activity-${joint.activityId}-${joint.activityVersion}-${joint.sessionId}`;
  return (
    <details className="attempt-runtime-panel" open>
      <summary>本次课堂：互动＋作答</summary>
      <p role="status">{notice}</p>
      {evidence && (
        <section aria-label="本次课堂可信记录">
          <h2>{evidence.binding.title}</h2>
          <p>
            第 {evidence.binding.attemptNumber} 次作答 · 活动 v{evidence.binding.activityVersion} ·
            互动 v{evidence.binding.publicationNo}
          </p>
          <p>
            {evidence.attemptStatus === 'SUBMITTED' ? '作答已提交' : '作答进行中'}
            。互动操作不自动完成或计分；成绩由教师确认发布。
          </p>
          {course && <a href={activityUrl}>前往本次课堂作答</a>}
          <button
            onClick={() =>
              void read().catch((e) => {
                setEvidence(null);
                setNotice(e.message);
              })
            }
          >
            刷新本次可信记录
          </button>
          <ol>
            {evidence.events.map((e) => (
              <li key={e.id}>
                {e.type === 'ATTEMPT_STARTED'
                  ? '作答开始'
                  : `提交已记录 · 第 ${e.submissionVersion} 版`}{' '}
                · {new Date(Number(e.at)).toLocaleString()}
              </li>
            ))}
          </ol>
          {evidence.moreEvents && <p>仅显示最近 50 条学习事实。</p>}
        </section>
      )}
    </details>
  );
}
