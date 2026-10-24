import { isUnanswered } from '@/lib/zhiban/domain/quiz/ordering';
import { addJudgment, copyQuestion } from '@/lib/zhiban/domain/quiz/reuse';
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { FillSurface as QuizSurface, FillAuthoring as QuizAuthoringSurface } from './quiz-fill';
import type {
  Content as QuizContent,
  Question as QuizQuestion,
  Answers as QuizAnswers,
} from '@/lib/zhiban/domain/quiz/model';
import type { QuestionResult } from '@openmaic/dsl/quiz';
import messages from '../../../lib/i18n/locales/zh-CN.json';
// Bounded JSON view varies across authoring/attempt/submission; server constructs separate allowlists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
declare global {
  interface Window {
    zhibanQuiz: {
      render: (
        tenant: string,
        offering: string,
        node: HTMLElement,
        options?: {
          activity?: string;
          submission?: string;
          attempt?: string;
          onChanged?: () => void;
        },
      ) => () => void;
    };
  }
}
type HostWindow = Window & {
  zhibanCoursePage?: { setDirty: (key: string, value: boolean, root?: HTMLElement | null) => void };
  zhibanCurriculum?: { flow?: () => { returnUrl: (id: string) => string } | null };
};
const t = (key: string) => {
  if (key === 'edit.quiz.shortAnswerGradingNote')
    return '简答题按课程规则由教师评分，或由教师显式启用的 AI 服务评分；正式发布后可查看成绩并申诉。';
  let value: unknown = messages;
  for (const part of key.split('.')) value = (value as Record<string, unknown>)?.[part];
  return typeof value === 'string' ? value : key;
};
const empty: QuizContent = { type: 'quiz', questions: [] };
async function request(url: string, command?: unknown, key?: string) {
  const abort = new AbortController(),
    timer = setTimeout(
      () => abort.abort(),
      (command as { type?: string })?.type === 'SUGGEST_QUIZ_GRADE' ? 150000 : 15000,
    );
  try {
    let headers: Record<string, string> = { 'x-zhiban-request': 'identity-v1' };
    if (command) {
      const csrf = await fetch('/api/zhiban/identity/csrf', {
        credentials: 'same-origin',
        headers,
        signal: abort.signal,
      });
      if (!csrf.ok) throw Object.assign(Error('登录已失效，请重新登录。'), { confirmed: true });
      const token = await csrf.json();
      headers = {
        ...headers,
        'Content-Type': 'application/json',
        'x-zhiban-csrf': token.csrfToken,
        'x-zhiban-command': key!,
      };
    }
    const r = await fetch(url, {
      method: command ? 'POST' : 'GET',
      headers,
      body: command ? JSON.stringify(command) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: abort.signal,
    });
    const value = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          value.error?.code === 'PROGRESS_BLOCKED'
            ? '先修未满足或规则绑定版本已过期。请查看课程目录中的学习进度；已有作答可继续。'
            : '操作未完成：' + (value.error?.code ?? r.status),
        ),
        {
          confirmed: r.status >= 400 && r.status < 500,
          status: r.status,
        },
      );
    return value;
  } finally {
    clearTimeout(timer);
  }
}
function Product({
  tenant,
  offering,
  activity,
  submission,
  attempt,
  onChanged = () => {},
}: {
  tenant: string;
  offering: string;
  activity?: string;
  submission?: string;
  attempt?: string;
  onChanged?: () => void;
}) {
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`;
  const [data, setData] = useState<Data | null>(null),
    [draft, setDraft] = useState<QuizContent>(empty),
    [answer, setAnswer] = useState<QuizAnswers>({}),
    [title, setTitle] = useState(''),
    [mode, setMode] = useState('ASSESSED'),
    [deadline, setDeadline] = useState(''),
    [resubmit, setResubmit] = useState(false),
    [maximum, setMaximum] = useState('1'),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [marks, setMarks] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [feedback, setFeedback] = useState(''),
    [override, setOverride] = useState<Record<string, string>>({}),
    [submitConfirm, setSubmitConfirm] = useState(false);
  const [conflict, setConflict] = useState<Data | null>(null);
  const [currentId, setCurrentId] = useState(activity),
    [attemptId, setAttemptId] = useState<string | undefined>(attempt),
    [submissionId, setSubmissionId] = useState(submission);
  const hostRoot = useRef<HTMLElement | null>(null);
  const pending = useRef<{ url: string; command: Data; key: string } | null>(null),
    baseline = useRef(''),
    dirtyKey = useRef('quiz-' + crypto.randomUUID()),
    dataRef = useRef<Data | null>(null);
  const formState = () =>
    JSON.stringify(
      data?.mode === 'TEACHER'
        ? submissionId
          ? { marks, feedback, reason, override }
          : { draft, title, deadline, resubmit, maximum }
        : answer,
    );
  const dirty = !!baseline.current && baseline.current !== formState();
  async function load(select?: { attempt?: string; submission?: string; activity?: string }) {
    const q =
      select ??
      (submissionId
        ? { submission: submissionId }
        : attemptId
          ? { attempt: attemptId }
          : currentId
            ? { activity: currentId }
            : null);
    if (!q) {
      setData({ mode: 'TEACHER' });
      baseline.current = JSON.stringify({
        draft: empty,
        title: '',
        deadline: '',
        resubmit: false,
        maximum: '1',
      });
      return;
    }
    const isSubmission = 'submission' in q;
    const value: Data = await request(
      base +
        (isSubmission ? '/quiz-submissions?' : '/quizzes?') +
        new URLSearchParams(
          Object.entries(q).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
    );
    dataRef.current = value;
    setData(value);
    const nextAnswer = value.answers ?? {};
    setAnswer(nextAnswer);
    setDraft(value.content ?? empty);
    setTitle(value.title ?? '');
    setResubmit(!!value.allowResubmit);
    setMaximum(value.maxAttempts === null ? '' : String(value.maxAttempts ?? 1));
    const date = value.deadlineAt ? new Date(Number(value.deadlineAt)) : null;
    const dateText = date
      ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '';
    setDeadline(dateText);
    baseline.current = JSON.stringify(
      value.mode === 'TEACHER' && !isSubmission
        ? {
            draft: value.content ?? empty,
            title: value.title ?? '',
            deadline: dateText,
            resubmit: !!value.allowResubmit,
            maximum: value.maxAttempts === null ? '' : String(value.maxAttempts ?? 1),
          }
        : nextAnswer,
    );
    if (value.content?.questions) {
      const initial: Record<string, string> = {};
      for (const q of value.content.questions as QuizQuestion[]) {
        const evaluated = value.evaluation?.results?.find(
          (r: QuestionResult) => r.questionId === q.id,
        );
        initial[q.id] =
          value.gradeMarks?.[q.id] !== undefined
            ? String(value.gradeMarks[q.id] / 100)
            : q.type === 'short_answer'
              ? ''
              : String(evaluated?.earned ?? 0);
      }
      setMarks(initial);
      if (isSubmission && value.mode === 'TEACHER')
        baseline.current = JSON.stringify({
          marks: initial,
          feedback: value.grade?.feedback ?? '',
          reason: '',
          override: {},
        });
    }
    setReason('');
    setOverride({});
    setFeedback(value.grade?.feedback ?? '');
  }
  const initialLoad = useRef(load);
  useEffect(() => {
    void initialLoad.current().catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => {
    const key = dirtyKey.current;
    const w = window as HostWindow;
    w.zhibanCoursePage?.setDirty(key, dirty || !!pending.current, hostRoot.current);
    const handler = (e: BeforeUnloadEvent) => {
      if (!w.zhibanCoursePage && (dirty || pending.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    const click = (e: MouseEvent) => {
      if (!(dirty || pending.current) || (e.target as Element).closest('a[href]') === null) return;
      if (!pending.current && w.zhibanCoursePage) return;
      if (pending.current || !window.confirm('测验有未保存答案或编辑内容，确定离开？')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('click', click, true);
      w.zhibanCoursePage?.setDirty(key, false);
    };
  }, [dirty, busy]);
  async function act(command: Data, url = base + '/quizzes') {
    if (busy) return;
    setBusy(true);
    setNotice('正在确认操作…');
    const work = pending.current ?? { command, url, key: crypto.randomUUID() };
    pending.current = work;
    try {
      const result = await request(work.url, work.command, work.key);
      pending.current = null;
      setConflict(null);
      if (work.command.type === 'CREATE_QUIZ' || work.command.type === 'COPY_QUIZ') {
        setCurrentId(result.id);
        await load({ activity: result.id });
      } else if (work.command.type === 'START_QUIZ_ATTEMPT') {
        setAttemptId(result.id);
        setSubmissionId(undefined);
        await load({ attempt: result.id });
      } else if (work.command.type === 'SUBMIT_QUIZ') {
        setSubmissionId(result.submissionId);
        await load({ submission: result.submissionId });
      } else await load();
      setNotice(
        work.command.type === 'SUBMIT_QUIZ'
          ? '提交成功，收据：' + result.submissionId
          : '操作已确认',
      );
      onChanged();
      return result;
    } catch (e) {
      if ((e as { confirmed?: boolean }).confirmed) pending.current = null;
      if ((e as { status?: number }).status === 409) setConflict({});
      setNotice((e as Error).message + (pending.current ? '；结果未知，请按原命令重试。' : ''));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{notice || '正在读取测验…'}</p>;
  const teacher = data.mode === 'TEACHER',
    author = teacher && !submissionId,
    closed = data.reviewClosed;
  const locked = busy || !!pending.current;
  const expired =
    data.deadlineAt !== null &&
    data.deadlineAt !== undefined &&
    Date.now() >= Number(data.deadlineAt);
  const exhausted =
    data.latestAttempt?.status !== 'IN_PROGRESS' &&
    data.maxAttempts !== null &&
    Number(data.latestAttempt?.attempt_no ?? 0) >= Number(data.maxAttempts);
  const grade = data.grade,
    published = grade?.published_version > 0;
  const renderQuiz = (readOnly = false) => (
    <QuizSurface
      questions={data.questions ?? draft.questions}
      answers={answer}
      phase={submissionId || readOnly ? 'reviewing' : 'answering'}
      readOnly={
        readOnly ||
        !!submissionId ||
        closed ||
        expired ||
        data.status !== 'PUBLISHED' ||
        (!!data.attempt && data.latestAttempt?.id !== data.attempt.id) ||
        (data.attempt?.status === 'SUBMITTED' && !data.allowResubmit)
      }
      busy={locked}
      onChange={setAnswer}
      review={data.review}
      onSave={() =>
        void act({
          type: 'SAVE_QUIZ_DRAFT',
          attemptId,
          revision: data.attempt.revision,
          answers: answer,
        })
      }
      onSubmit={() => setSubmitConfirm(true)}
    />
  );
  return (
    <section ref={hostRoot} className="quiz-product" data-quiz-root="true">
      <p role="status">
        {notice ? notice + (dirty ? '；尚未保存' : '') : dirty ? '尚未保存' : '已保存'}
      </p>
      {pending.current && (
        <button disabled={busy} onClick={() => void act(pending.current!.command)}>
          按原命令重试
        </button>
      )}
      {conflict && (
        <section>
          <button
            disabled={locked}
            onClick={() =>
              void (async () => {
                const q = submissionId
                  ? { submission: submissionId }
                  : attemptId
                    ? { attempt: attemptId }
                    : { activity: currentId! };
                const value = await request(
                  base +
                    ('submission' in q ? '/quiz-submissions?' : '/quizzes?') +
                    new URLSearchParams(
                      Object.entries(q).filter(
                        (entry): entry is [string, string] => typeof entry[1] === 'string',
                      ),
                    ),
                );
                setData(value);
                setConflict(value);
                setNotice('已读取服务器版本；本地输入仍保留，请比较后再保存。');
              })().catch((e) => setNotice(e.message))
            }
          >
            读取服务器版本并保留本地输入
          </button>
          <details>
            <summary>服务器草稿或答案</summary>
            <pre>{JSON.stringify(conflict.content ?? conflict.answers ?? {}, null, 2)}</pre>
          </details>
        </section>
      )}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {author ? (
          <>
            <h3>{currentId ? '编辑课程测验' : '新建课程测验'}</h3>
            <label>
              测验标题
              <input
                aria-label="测验标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy || closed}
              />
            </label>
            <label>
              测验模式
              <select
                value={currentId ? data.quizMode : mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={!!currentId || busy}
              >
                <option value="ASSESSED">正式测验</option>
                <option value="PRACTICE">自主练习</option>
              </select>
            </label>
            <label>
              截止时间
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={busy || closed}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={resubmit}
                onChange={(e) => setResubmit(e.target.checked)}
                disabled={busy || closed}
              />
              允许同次尝试重交
            </label>
            <label>
              最多尝试次数（空白不限）
              <input
                type="number"
                min="1"
                max="1000"
                value={maximum}
                onChange={(e) => setMaximum(e.target.value)}
                disabled={busy || closed}
              />
            </label>
            <button
              disabled={locked || closed || draft.questions.length >= 100}
              onClick={() => setDraft(addJudgment(draft, crypto.randomUUID()))}
            >
              添加判断题
            </button>
            <p>判断题使用两选项单选；添加后填写题干，并明确选择正确答案。</p>
            <details>
              <summary>复制当前草稿中的题目</summary>
              {draft.questions.map((q, index) => (
                <button
                  key={q.id}
                  disabled={locked || closed || draft.questions.length >= 100}
                  onClick={() => setDraft(copyQuestion(draft, q.id, crypto.randomUUID()))}
                >
                  复制第{index + 1}题：{q.question.slice(0, 24) || '未填写题干'}
                </button>
              ))}
            </details>
            <QuizAuthoringSurface
              value={draft}
              onChange={setDraft}
              readOnly={locked || closed}
              t={t}
            />
            <button
              disabled={busy || closed || !!pending.current}
              onClick={() =>
                void act({
                  type: currentId ? 'EDIT_QUIZ' : 'CREATE_QUIZ',
                  ...(currentId ? { id: currentId, revision: data.revision } : { mode }),
                  title,
                  content: draft,
                  deadlineAt: deadline ? new Date(deadline).getTime() : null,
                  allowResubmit: resubmit,
                  maxAttempts: maximum ? Number(maximum) : null,
                })
              }
            >
              保存测验草稿
            </button>
            <button onClick={() => setPreview(!preview)}>教师预览（不记作答）</button>
            {preview && renderQuiz(true)}
            {currentId && (
              <>
                <p>复制只取已保存内容，生成独立草稿；不带截止时间、尝试限制、学生作答或成绩。</p>
                <button
                  disabled={locked || dirty}
                  onClick={() =>
                    void act({
                      type: 'COPY_QUIZ',
                      sourceId: currentId,
                      sourceRevision: data.revision,
                      sourceVersion: null,
                    })
                  }
                >
                  复制已保存草稿为新测验
                </button>
                <button
                  disabled={locked || dirty || !data.version}
                  onClick={() =>
                    void act({
                      type: 'COPY_QUIZ',
                      sourceId: currentId,
                      sourceRevision: data.revision,
                      sourceVersion: String(data.version),
                    })
                  }
                >
                  复制已发布版本为新测验
                </button>
                <p>
                  已发布版本 {data.version}；修改后先保存草稿，再发布新版本。
                  {closed ? '已封卷，不能重新开放。' : ''}
                </p>
                <button
                  disabled={busy || dirty || closed}
                  onClick={() =>
                    void act({ type: 'PUBLISH_QUIZ', id: currentId, revision: data.revision })
                  }
                >
                  发布测验
                </button>
                {data.status === 'PUBLISHED' && (
                  <button
                    disabled={busy || closed}
                    onClick={() =>
                      void act({ type: 'WITHDRAW_QUIZ', id: currentId, revision: data.revision })
                    }
                  >
                    撤回测验
                  </button>
                )}
                <button
                  disabled={busy || closed || !data.version}
                  onClick={() => {
                    if (
                      window.confirm(
                        '封卷后所有版本永久停止作答，已发布成绩的学生可查看正确答案。确认封卷？',
                      )
                    )
                      void act({
                        type: 'CLOSE_QUIZ_REVIEW',
                        id: currentId,
                        revision: data.revision,
                      });
                  }}
                >
                  封卷并允许成绩回看答案
                </button>
                <a
                  href={
                    (window as HostWindow).zhibanCurriculum?.flow?.()?.returnUrl(currentId) ??
                    `${location.pathname.replace(/\/learning-center(?:\/[^/]+)?$/, '/classrooms')}?space=${tenant}&offering=${offering}#activity-${currentId}`
                  }
                >
                  返回原章节或活动目录
                </a>
              </>
            )}
          </>
        ) : teacher && submissionId ? (
          <>
            <h3>测验评分 · {data.title}</h3>
            {renderQuiz(true)}
            <p>
              客观题自动得分：{(data.evaluation.objectivePoints / 100).toFixed(2)}
              ；简答按课程固定评分规则处理。
            </p>
            {!published &&
              (data.content.questions as QuizQuestion[]).some((q) => q.type === 'short_answer') && (
                <section aria-label="AI 简答评分建议">
                  <p>
                    仅发送本次简答题、参考要点和作答给配置的模型。建议可能有误，请核对依据。采用只保存评分草稿，仍需单独发布。
                  </p>
                  <button
                    disabled={busy || dirty || !!pending.current}
                    onClick={() =>
                      void act(
                        { type: 'SUGGEST_QUIZ_GRADE', submissionId },
                        `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
                      )
                    }
                  >
                    生成简答评分建议
                  </button>
                  {dirty && <p>请先保存或处理当前评分输入，再生成或处理建议。</p>}
                  {(data.aiAdvice ?? []).map((item: Data) => (
                    <article key={item.id}>
                      <p>
                        模型：{item.result.model} ·{' '}
                        {item.status === 'ACCEPTED'
                          ? '已采用'
                          : item.status === 'REJECTED'
                            ? '已拒绝'
                            : '待教师审阅'}
                      </p>
                      {(data.content.questions as QuizQuestion[])
                        .filter((q) => q.type === 'short_answer')
                        .map((q) => (
                          <p key={q.id}>
                            {q.question}：建议 {item.result.marks[q.id]} / {q.points ?? 1} 分
                          </p>
                        ))}
                      <p>{item.result.feedback}</p>
                      {item.status === 'PENDING' && (
                        <>
                          <button
                            disabled={busy || dirty || !!pending.current}
                            onClick={() =>
                              void act(
                                { type: 'ACCEPT_QUIZ_ADVICE', submissionId, suggestionId: item.id },
                                `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
                              )
                            }
                          >
                            采用建议并保存评分草稿
                          </button>
                          <button
                            disabled={busy || dirty || !!pending.current}
                            onClick={() =>
                              void act(
                                { type: 'REJECT_QUIZ_ADVICE', submissionId, suggestionId: item.id },
                                `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
                              )
                            }
                          >
                            拒绝评分建议
                          </button>
                        </>
                      )}
                    </article>
                  ))}
                </section>
              )}
            {(data.content.questions as QuizQuestion[]).map((q) => (
              <label key={q.id}>
                {q.question}（满分 {q.points}）
                <input
                  aria-label={'评分-' + q.id}
                  type="number"
                  min="0"
                  max={q.points}
                  step="0.01"
                  value={marks[q.id] ?? ''}
                  disabled={busy || (!published && q.type !== 'short_answer')}
                  onChange={(e) => setMarks({ ...marks, [q.id]: e.target.value })}
                />
                {published && q.type !== 'short_answer' && (
                  <input
                    placeholder="覆盖客观分的公开原因"
                    value={override[q.id] ?? ''}
                    onChange={(e) => setOverride({ ...override, [q.id]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <label>
              评语
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            {published && (
              <label>
                公开更正理由
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            )}
            <button
              disabled={busy || !!pending.current}
              onClick={() =>
                void act(
                  published
                    ? {
                        type: 'CORRECT_QUIZ_GRADE',
                        submissionId,
                        revision: grade.revision,
                        marks,
                        overrides: override,
                        feedback,
                        reason,
                      }
                    : {
                        type: 'SAVE_QUIZ_GRADE',
                        submissionId,
                        gradeRevision: grade?.revision ?? null,
                        manualMarks: Object.fromEntries(
                          (data.content.questions as QuizQuestion[])
                            .filter((q) => q.type === 'short_answer')
                            .map((q) => [q.id, marks[q.id]]),
                        ),
                        feedback,
                      },
                  `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
                )
              }
            >
              {published ? '更正并发布测验成绩' : '确认分项并保存评分'}
            </button>
            {grade && !published && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    { type: 'PUBLISH_GRADE', submissionId, revision: grade.revision },
                    `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
                  )
                }
              >
                发布成绩
              </button>
            )}
          </>
        ) : (
          <>
            <h3>
              {data.title} · {data.quizMode === 'PRACTICE' ? '练习' : '正式测验'}
            </h3>
            <p>
              题目版本 {data.version}；最多 {data.maxAttempts ?? '不限'} 次尝试；
              {data.allowResubmit ? '允许重交' : '不允许重交'}；
              {closed
                ? '已封卷'
                : data.deadlineAt
                  ? new Date(Number(data.deadlineAt)).toLocaleString()
                  : '无截止时间'}
            </p>
            {exhausted && <p>已达到此测验的尝试次数上限。</p>}
            {expired && <p>此版本已截止，不能再保存或提交；可查看已有记录。</p>}
            {!data.attempt && !closed && data.status === 'PUBLISHED' && (
              <button
                disabled={
                  busy || (data.latestAttempt?.status !== 'IN_PROGRESS' && (expired || exhausted))
                }
                onClick={() => {
                  const previous = data.latestAttempt;
                  if (previous?.status === 'IN_PROGRESS') {
                    setAttemptId(previous.id);
                    void load({ attempt: previous.id });
                    return;
                  }
                  if (window.confirm('开始会占用一次尝试次数，确定开始？'))
                    void act({
                      type: 'START_QUIZ_ATTEMPT',
                      activityId: currentId,
                      expectedVersion: String(data.version),
                    });
                }}
              >
                {data.latestAttempt?.status === 'IN_PROGRESS' ? '继续未完成作答' : '开始新一次尝试'}
              </button>
            )}
            {data.attempt && renderQuiz()}
            {submitConfirm && (
              <section role="dialog" aria-label="确认提交测验">
                <p>
                  提交固定版本 {data.version}，共 {data.questions.length} 题，未答{' '}
                  {data.questions.filter((q: QuizQuestion) => isUnanswered(q, answer[q.id])).length}{' '}
                  题；{data.allowResubmit ? '允许重交' : '提交后不能重交'}。
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    setSubmitConfirm(false);
                    void act({
                      type: 'SUBMIT_QUIZ',
                      attemptId,
                      revision: data.attempt.revision,
                      answers: answer,
                    });
                  }}
                >
                  确认提交测验
                </button>
                <button onClick={() => setSubmitConfirm(false)}>继续检查答案</button>
              </section>
            )}
            {submissionId && (
              <p>
                已提交；
                {data.quizMode === 'PRACTICE'
                  ? '练习反馈不计入成绩。'
                  : '正式成绩按课程固定规则发布，支持本人申诉与教师更正。'}
              </p>
            )}
            {data.latestSubmission && !submissionId && (
              <button
                onClick={() => {
                  setSubmissionId(data.latestSubmission.id);
                  void load({ submission: data.latestSubmission.id });
                }}
              >
                查看本次提交与成绩
              </button>
            )}
            {data.latestAttempt && data.latestAttempt.status === 'SUBMITTED' && !data.attempt && (
              <button
                onClick={() => {
                  setAttemptId(data.latestAttempt.id);
                  void load({ attempt: data.latestAttempt.id });
                }}
              >
                查看已提交尝试
              </button>
            )}
            {submissionId && data.allowResubmit && !closed && (
              <button
                onClick={() => {
                  setSubmissionId(undefined);
                  void load({ attempt: attemptId ?? data.attempt.id });
                }}
              >
                在原尝试中重交
              </button>
            )}
          </>
        )}
      </fieldset>
      {data.review?.publications?.[0] && (
        <p>
          本次已发布分项：
          {Object.entries(data.review.publications[0].marks)
            .map(([id, v]) => id + ' ' + (Number(v) / 100).toFixed(2) + '分')
            .join('；')}
        </p>
      )}
      {data.publications?.map((p: Data) => (
        <p key={p.id}>
          {p.published_by === null ? 'AI 服务正式评分 · ' : '教师正式评分 · '}成绩版本 {p.version}：
          {(p.score_points / 100).toFixed(2)} / {(p.max_points / 100).toFixed(2)} · {p.feedback}
          {p.reason ? ' · 更正理由：' + p.reason : ''}
        </p>
      ))}
    </section>
  );
}
window.zhibanQuiz = {
  render(
    tenant: string,
    offering: string,
    node: HTMLElement,
    options: {
      activity?: string;
      submission?: string;
      attempt?: string;
      onChanged?: () => void;
    } = {},
  ) {
    const root = createRoot(node);
    root.render(<Product tenant={tenant} offering={offering} {...options} />);
    return () => root.unmount();
  },
};
