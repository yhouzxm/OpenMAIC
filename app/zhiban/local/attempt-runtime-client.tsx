/** Parent-host controls only. The sandbox child has no event-ingestion API. */
import React, { useCallback, useEffect, useState } from 'react';
type Row = {
  id: string;
  title?: string;
  published_version?: number;
  activity_type?: string;
  attempt_no?: number;
  display_name?: string;
  status?: string;
};
type Evidence = {
  binding: null | {
    id: string;
    title: string;
    attemptId: string;
    activityId: string;
    activityVersion: number;
    attemptNumber: number;
    publicationNo: number;
    boundAt: number;
  };
  attemptStatus?: string;
  currentPublication?: boolean;
  moreEvents?: boolean;
  events: { id: string; type: string; at: number; source: string; submissionVersion?: number }[];
};
export function AttemptRuntimePanel({
  base,
  publicationId,
}: {
  base: string;
  publicationId: string;
}) {
  const match = /\/content\/([^/]+)\/offerings\/([^/]+)\/resources\//.exec(base)!;
  const [, tenant, offering] = match,
    learning = `/api/zhiban/learning/${tenant}/offerings/${offering}`;
  const [activities, setActivities] = useState<Row[]>([]),
    [activity, setActivity] = useState(''),
    [attempts, setAttempts] = useState<Row[]>([]),
    [attempt, setAttempt] = useState(''),
    [mode, setMode] = useState(''),
    [cursor, setCursor] = useState<string | null>(null),
    [attemptCursor, setAttemptCursor] = useState<string | null>(null),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [course, setCourse] = useState('');
  const request = useCallback(async (url: string, command?: unknown) => {
    const headers: Record<string, string> = { 'x-zhiban-request': 'identity-v1' };
    if (command) {
      const csrf = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
      if (!csrf.ok) throw Error('登录已失效，请返回课程重新进入。');
      headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
      headers['content-type'] = 'application/json';
      headers['x-zhiban-command'] = crypto.randomUUID().replaceAll('-', '');
    }
    const r = await fetch(url, {
      headers,
      method: command ? 'POST' : 'GET',
      body: command ? JSON.stringify(command) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const value = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 409
          ? '尝试、截止时间或固定发布版本已变化；请保留原记录并返回课程核对。'
          : '当前登录或课程资格不允许此操作，请返回课程核对。',
      );
    return value;
  }, []);
  const loadActivities = useCallback(
    async (next?: string) => {
      const p = await request(
        learning + '/activities?limit=20' + (next ? '&cursor=' + encodeURIComponent(next) : ''),
      );
      setActivities((old) => (next ? [...old, ...p.rows] : p.rows));
      setCursor(p.nextCursor);
      setMode(p.mode);
    },
    [learning, request],
  );
  const loadAttempts = useCallback(
    async (selected: string, next?: string) => {
      const p = await request(
        learning +
          '/attempts?activity=' +
          selected +
          '&limit=20' +
          (next ? '&cursor=' + encodeURIComponent(next) : ''),
      );
      setAttempts((old) => (next ? [...old, ...p.rows] : p.rows));
      setAttemptCursor(p.nextCursor);
    },
    [learning, request],
  );
  useEffect(() => {
    void loadActivities().catch((e) => setNotice(e.message));
    void request(`/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=20`)
      .then((p) =>
        setCourse(p.rows.find((r: { id: string }) => r.id === offering)?.course_id ?? ''),
      )
      .catch(() => {});
  }, [loadActivities, request, tenant, offering]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await work();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const read = async (id: string) => {
    const result = await request(base + '/runtime?attempt=' + id);
    setEvidence(result);
    if (!result.binding) setNotice('此尝试尚未关联该互动资源。');
  };
  const selected = activities.find((a) => a.id === activity);
  return (
    <details className="attempt-runtime-panel" open={publicationId ? undefined : true}>
      <summary>作答关联与可信记录</summary>
      <p>
        可将本互动固定版本关联课程作答。仅记录服务端的绑定、开始和提交事实；互动内分数不作为完成或成绩。
      </p>
      <p role="status">{notice}</p>
      <fieldset disabled={busy}>
        <legend>{mode === 'TEACHER' ? '查证学生作答' : '关联课程作答'}</legend>
        <label>
          课程活动
          <select
            aria-label="关联课程活动"
            value={activity}
            onChange={(e) => {
              const id = e.target.value;
              setActivity(id);
              setAttempt('');
              setEvidence(null);
              setAttempts([]);
              setAttemptCursor(null);
              if (id) void act(() => loadAttempts(id));
            }}
          >
            <option value="">选择活动</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · {a.status === 'PUBLISHED' ? '已发布' : a.status}
              </option>
            ))}
          </select>
        </label>
        {cursor && (
          <button onClick={() => void act(() => loadActivities(cursor))}>更多课程活动</button>
        )}
        {publicationId && mode === 'STUDENT' && selected?.status === 'PUBLISHED' && (
          <button
            onClick={() =>
              void act(async () => {
                const quiz = selected.activity_type === 'QUIZ';
                const r = await request(
                  learning + (quiz ? '/quizzes' : ''),
                  quiz
                    ? {
                        type: 'START_QUIZ_ATTEMPT',
                        activityId: activity,
                        expectedVersion: String(selected.published_version),
                      }
                    : {
                        type: 'START_ATTEMPT',
                        id: activity,
                        expectedVersion: String(selected.published_version),
                      },
                );
                setAttempt(r.id);
                await loadAttempts(activity);
                setEvidence(
                  await request(base + '/runtime', {
                    type: 'BIND_ATTEMPT',
                    attemptId: r.id,
                    publicationId,
                  }),
                );
                setNotice(
                  '已关联真实作答；若已有进行中尝试则续接，不额外消耗次数。请到活动页填写并提交。',
                );
              })
            }
          >
            开始／续接作答并关联
          </button>
        )}
        <label>
          作答尝试
          <select
            aria-label="关联作答尝试"
            value={attempt}
            onChange={(e) => {
              setAttempt(e.target.value);
              setEvidence(null);
            }}
          >
            <option value="">选择尝试</option>
            {attempts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name ? a.display_name + ' · ' : ''}第 {a.attempt_no} 次 ·{' '}
                {a.status === 'SUBMITTED' ? '已提交' : '进行中'} · {a.id.slice(-8)}
              </option>
            ))}
          </select>
        </label>
        {attemptCursor && (
          <button onClick={() => void act(() => loadAttempts(activity, attemptCursor))}>
            更多作答尝试
          </button>
        )}
        <button disabled={!attempt} onClick={() => void act(() => read(attempt))}>
          读取可信记录
        </button>
        {publicationId && mode === 'STUDENT' && (
          <button
            disabled={!attempt}
            onClick={() =>
              void act(async () => {
                setEvidence(
                  await request(base + '/runtime', {
                    type: 'BIND_ATTEMPT',
                    attemptId: attempt,
                    publicationId,
                  }),
                );
                setNotice('关联已确认；相同尝试与资源不会重复创建绑定。');
              })
            }
          >
            关联所选尝试
          </button>
        )}
        {course && activity && (
          <a
            href={`/zhiban/${mode === 'TEACHER' ? 'teacher' : 'student'}/courses/${course}/${mode === 'TEACHER' ? 'classrooms' : 'coursework'}?space=${tenant}&offering=${offering}#activity-${activity}`}
          >
            前往作答活动
          </a>
        )}
      </fieldset>
      {evidence?.binding && (
        <section aria-label="可信运行记录">
          <h2>服务端可信记录</h2>
          <p>
            {evidence.binding.title} · 第 {evidence.binding.attemptNumber} 次尝试 · 活动版本{' '}
            {evidence.binding.activityVersion} · 互动发布版本 {evidence.binding.publicationNo}
          </p>
          <p>
            作答状态：{evidence.attemptStatus === 'SUBMITTED' ? '已提交' : '进行中'}；
            {evidence.currentPublication ? '当前发布版本' : '历史发布版本，不能据此继续播放'}
            。提交不等于完成或评分。
          </p>
          <ol>
            <li>关联已建立 · {new Date(evidence.binding.boundAt).toLocaleString()}</li>
            {evidence.events.map((e) => (
              <li key={e.id}>
                {e.type === 'ATTEMPT_STARTED'
                  ? '作答开始'
                  : `提交已记录 · 第 ${e.submissionVersion} 版`}{' '}
                · {new Date(Number(e.at)).toLocaleString()} · {e.source}
              </li>
            ))}
          </ol>
          {evidence.moreEvents && <p>仅展示最近 50 条学习事实；未展示全部历史。</p>}
        </section>
      )}
    </details>
  );
}
