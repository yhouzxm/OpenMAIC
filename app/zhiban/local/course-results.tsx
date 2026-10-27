/* eslint-disable @typescript-eslint/no-explicit-any -- course-bound native/academic DTO */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering');
if (![tenant, offering].every((v) => /^[a-f0-9-]{36}$/.test(v ?? ''))) throw Error('请选择课程');
const base = `/api/zhiban/course-results/${tenant}/offerings/${offering}`;
let token: Promise<string> | undefined;
const commands = new Map<string, string>();
const sourceLabel = (v: string) =>
  (
    ({
      NATIVE_QUIZ_SERVER_RECOMPUTED: '原生自测 · 服务端核验',
      NATIVE_PBL_SERVER_TERMINAL: '自主 PBL · 服务端终态',
      LEARNER_REFLECTION_FIXED_PUBLICATION: '学习者反思 · 固定课件来源',
    }) as Record<string, string>
  )[v] ?? v;
const points = (v: unknown) => (Number(v) / 100).toFixed(2).replace(/\.?0+$/, '');
const attemptLabel = (v: string) =>
  (({ IN_PROGRESS: '作答中', SUBMITTED: '已提交', ABANDONED: '已结束' }) as Record<string, string>)[
    v
  ] ?? '待核对';
async function api(body?: unknown, before?: string) {
  const h = new Headers({ 'x-zhiban-request': 'identity-v1' });
  if (body) {
    token ??= fetch('/api/zhiban/identity/csrf', {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw Error('请重新登录');
        return (await r.json()).csrfToken;
      })
      .catch((e) => {
        token = undefined;
        throw e;
      });
    h.set('content-type', 'application/json');
    h.set('x-zhiban-csrf', await token!);
    const key = JSON.stringify(body);
    if (!commands.has(key)) {
      if (commands.size >= 80) commands.delete(commands.keys().next().value!);
      commands.set(key, crypto.randomUUID());
    }
    h.set('x-zhiban-command', commands.get(key)!);
  }
  const r = await fetch(base + (before ? '?before=' + before : ''), {
    method: body ? 'POST' : 'GET',
    headers: h,
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const v = await r.json();
  if (!r.ok)
    throw Error(
      (
        {
          INVALID_STATE: '当前成果尚未就绪、课堂未启用，或作答状态已变化，请刷新核对。',
          CONFLICT: '版本已变化，请刷新后重新选择。',
          FORBIDDEN: '当前课程资格已失效。',
          DEADLINE_PASSED: '已到截止时间。',
          NOT_FOUND: '未找到本人可用的成果。',
          COURSE_RESULT_REQUIRED: '须核验本次尝试的课堂成果后提交。',
        } as Record<string, string>
      )[v.error?.code ?? v.errorCode] ?? `操作未完成（${r.status}）`,
    );
  return v;
}
function Root() {
  const [data, setData] = useState<any>(),
    [notice, setNotice] = useState('正在核对课程权限…'),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(''),
    [source, setSource] = useState(''),
    [scene, setScene] = useState(''),
    [reflection, setReflection] = useState(''),
    [current, setCurrent] = useState(q.get('attempt') ?? ''),
    [proof, setProof] = useState<any>(),
    [confirm, setConfirm] = useState(false),
    [shareTitle, setShareTitle] = useState('课堂小结'),
    [shareText, setShareText] = useState(''),
    [board, setBoard] = useState(false);
  useEffect(() => {
    if (!reflection.trim() || proof) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const leave = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (
        a &&
        a.href !== location.href &&
        !window.confirm('本人反思尚未保存，离开将丢失本页输入。确定离开？')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', leave, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', leave, true);
    };
  }, [reflection, proof]);
  const refresh = async () => {
    try {
      setData(await api());
      setNotice('来源由服务端核验；正式完成仍按教师已发布的提交／成绩规则计算。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, []);
  const act = data?.activities.find((a: any) => a.id === activity),
    src = data?.choices.find((c: any) => c.resourceId === source),
    selected = src?.scenes.find((s: any) => s.id === scene),
    attempt = data?.attempts.find((a: any) => a.id === current),
    anchorTask = data?.tasks.find(
      (t: any) =>
        t.activity_id === attempt?.activity_id && t.activity_version === attempt?.activity_version,
    );
  async function run(body: any, done?: (v: any) => void) {
    setBusy(true);
    setNotice('正在处理…');
    try {
      const v = await api(body);
      done?.(v);
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const classUrl = (s: any, id?: string) =>
    `/zhiban/native-classroom?tenant=${tenant}&offering=${offering}&resource=${s.resourceId}&publication=${s.publicationId}&scene=${encodeURIComponent(s.sceneId ?? '')}${id ? '&resultAttempt=' + id : ''}`;
  return (
    <>
      <header>
        <strong>智伴·创学</strong>
        <a
          href={
            data?.courseId
              ? `/zhiban/${data.teacher ? 'teacher' : 'student'}/courses/${data.courseId}?space=${tenant}&offering=${offering}`
              : `/zhiban?space=${tenant}`
          }
        >
          返回课程
        </a>
        <a href={`/zhiban/learning?tenant=${tenant}&offering=${offering}`}>活动与作答</a>
      </header>
      <main>
        <h1>课堂成果与共享结果</h1>
        <p role="status">{notice}</p>
        {data && (
          <>
            {data.teacher ? (
              <section>
                <h2>配置正式成果任务</h2>
                <p className="note">
                  选择已发布文字活动与固定原生场景。配置仅约束之后的新尝试；已有作答保留。同一活动发布版本的成果来源固定，换来源须先发布新活动版本。启用课堂后，学生开始尝试、完成练习、核验成果并确认提交，沿原评分流程发布成绩。PBL
                  须在本次尝试开始后由服务端进入完成终态；Quiz 会重新计算客观题，简答留给教师。
                </p>
                <div className="grid">
                  <label>
                    已发布文字活动
                    <select
                      aria-label="成果活动"
                      value={activity}
                      onChange={(e) => setActivity(e.target.value)}
                    >
                      <option value="">请选择活动</option>
                      {data.activities.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.title} · v{a.published_version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    原生课件
                    <select
                      aria-label="成果课件"
                      value={source}
                      onChange={(e) => {
                        setSource(e.target.value);
                        setScene('');
                      }}
                    >
                      <option value="">请选择已发布课件</option>
                      {data.choices.map((c: any) => (
                        <option key={c.resourceId} value={c.resourceId}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    成果场景
                    <select
                      aria-label="成果场景"
                      value={scene}
                      onChange={(e) => setScene(e.target.value)}
                    >
                      <option value="">请选择场景</option>
                      {src?.scenes.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ·{' '}
                          {s.kind === 'PBL'
                            ? '自主PBL'
                            : s.kind === 'QUIZ'
                              ? '原生测验'
                              : '学习反思'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !act || !selected}
                    onClick={() => {
                      const t = data.tasks.find(
                        (t: any) =>
                          t.activity_id === activity &&
                          t.activity_version === act.published_version,
                      );
                      void run({
                        type: 'SET_TASK',
                        activityId: activity,
                        activityVersion: act.published_version,
                        revision: t?.revision ?? '0',
                        enabled: true,
                        spec: {
                          resourceId: source,
                          publicationId: src.publicationId,
                          sceneId: scene,
                          kind: selected.kind,
                          sourceDigest: src.sourceDigest,
                        },
                      });
                    }}
                  >
                    发布成果要求
                  </button>
                  {src && (
                    <a className="button" href={classUrl({ ...src, sceneId: scene })}>
                      进入原生课堂／启停
                    </a>
                  )}
                </div>
                <h3>已发布要求</h3>
                {data.tasks.map((t: any) => (
                  <article key={t.activity_id + ':' + t.activity_version}>
                    <strong>
                      {data.activities.find((a: any) => a.id === t.activity_id)?.title ??
                        t.activity_id}
                    </strong>{' '}
                    · v{t.activity_version} · {t.spec.kind} · {t.enabled ? '启用' : '停止新加入'}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run({
                          type: 'SET_TASK',
                          activityId: t.activity_id,
                          activityVersion: t.activity_version,
                          revision: t.revision,
                          enabled: !t.enabled,
                          spec: t.spec,
                        })
                      }
                    >
                      {t.enabled ? '停止新尝试要求' : '重新启用'}
                    </button>
                  </article>
                ))}
              </section>
            ) : (
              <section>
                <h2>我的课堂成果任务</h2>
                {data.tasks
                  .filter((t: any) => t.enabled)
                  .map((t: any) => (
                    <article key={t.activity_id + ':' + t.activity_version}>
                      <h3>
                        {data.activities.find((a: any) => a.id === t.activity_id)?.title ??
                          '课堂成果任务'}
                      </h3>
                      <p>
                        {t.spec.kind === 'PBL'
                          ? '自主PBL：开始本次尝试后，在原生场景完成任务。'
                          : t.spec.kind === 'QUIZ'
                            ? '原生测验：开始本次尝试后作答并提交自测。'
                            : '固定课件学习反思：本人说明将明确标记为学习者报告。'}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            {
                              type: 'START',
                              activityId: t.activity_id,
                              activityVersion: t.activity_version,
                            },
                            (v) => {
                              setCurrent(v.id);
                              setProof(undefined);
                              setConfirm(false);
                            },
                          )
                        }
                      >
                        开始／续接成果尝试
                      </button>
                    </article>
                  ))}
                {!data.tasks.some((t: any) => t.enabled) && <p>教师尚未配置成果任务。</p>}
                <label>
                  本人尝试
                  <select
                    aria-label="本人成果尝试"
                    value={current}
                    onChange={(e) => {
                      setCurrent(e.target.value);
                      setProof(undefined);
                      setConfirm(false);
                    }}
                  >
                    <option value="">请选择</option>
                    {data.attempts.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {data.activities.find((v: any) => v.id === a.activity_id)?.title ??
                          a.activity_id}{' '}
                        · {attemptLabel(a.status)} · {a.id.slice(-6)}
                      </option>
                    ))}
                  </select>
                </label>
                {attempt && (
                  <>
                    <p>
                      当前尝试：{attemptLabel(attempt.status)} · 修订 {attempt.revision}
                    </p>
                    {anchorTask && (
                      <a className="button" href={classUrl(anchorTask.spec, current)}>
                        进入原生场景作答
                      </a>
                    )}
                    <label>
                      本人反思
                      <textarea
                        aria-label="本人反思"
                        maxLength={4000}
                        value={reflection}
                        onChange={(e) => {
                          setReflection(e.target.value);
                          setProof(undefined);
                          setConfirm(false);
                        }}
                      />
                    </label>
                    <button
                      disabled={
                        busy ||
                        !reflection.trim() ||
                        (attempt.status === 'SUBMITTED' && !attempt.allow_resubmit)
                      }
                      onClick={() =>
                        void run({ type: 'CAPTURE', attemptId: current, reflection }, (v) => {
                          setProof(v);
                          setConfirm(false);
                        })
                      }
                    >
                      从服务端核验并保存成果
                    </button>
                    {proof && (
                      <article>
                        <h3>提交预览</h3>
                        <p>成果来源：{sourceLabel(proof.payload.execution.source)}</p>
                        <p>本人反思：{proof.payload.reflection}</p>
                        <details>
                          <summary>查看固定成果与来源证据</summary>
                          <pre>{JSON.stringify(proof.payload, null, 2)}</pre>
                        </details>
                        <p>练习分／AI评价不会直接成为正式成绩。</p>
                        <label>
                          <input
                            style={{ width: 'auto' }}
                            type="checkbox"
                            checked={confirm}
                            onChange={(e) => setConfirm(e.target.checked)}
                          />{' '}
                          我已核对成果及本人反思，确认提交到正式活动
                        </label>
                        <button
                          className="primary"
                          disabled={busy || !confirm}
                          onClick={() =>
                            void run(
                              {
                                type: 'SUBMIT',
                                attemptId: current,
                                revision: attempt.revision,
                                proofId: proof.id,
                              },
                              () => {
                                setConfirm(false);
                                setProof(undefined);
                              },
                            )
                          }
                        >
                          确认提交成果
                        </button>
                      </article>
                    )}
                  </>
                )}
                <h3>本人已核验成果</h3>
                {data.proofs.map((p: any) => (
                  <article key={p.id}>
                    <span>
                      {sourceLabel(p.payload.execution.source)} ·{' '}
                      {new Date(p.created_at).toLocaleString()}
                    </span>
                    <button
                      onClick={() => {
                        setCurrent(p.attempt_id);
                        setProof(p);
                        setConfirm(false);
                      }}
                    >
                      查看／继续提交
                    </button>
                  </article>
                ))}
              </section>
            )}
            <section>
              <h2>{data.teacher ? '正式成果与原成绩' : '本人提交与成绩回看'}</h2>
              <p>仅列出已正式提交的成果。教师继续使用待评分入口发布或更正成绩。</p>
              {data.submissions.map((s: any) => (
                <article key={s.id}>
                  <h3>{s.title}</h3>
                  <p>
                    {data.teacher
                      ? `学生：${s.display_name ?? '历史成员 · ' + s.membership_id.slice(-6)}`
                      : '本人正式提交'}
                  </p>
                  <p>来源：{sourceLabel(s.result.classroomEvidence.source)}</p>
                  <p>
                    {s.score_points === null
                      ? '成绩尚未发布'
                      : `已发布成绩 ${points(s.score_points)}/${points(s.max_points)} · ${s.feedback}`}
                  </p>
                  {!data.teacher && (
                    <p>
                      {data.progress?.rows.find((r: any) => r.activityId === s.activity_id)
                        ?.complete
                        ? '此活动当前已满足教师发布的完成规则'
                        : data.progress?.rows.some((r: any) => r.activityId === s.activity_id)
                          ? '此活动当前尚未满足教师发布的完成规则'
                          : '此活动未配置完成规则，不自动判定课程完成'}
                    </p>
                  )}
                  <details>
                    <summary>来源证据</summary>
                    <pre>
                      {JSON.stringify(
                        data.proofs.find((p: any) => p.id === s.result.classroomEvidence.proofId)
                          ?.payload ?? s.result.classroomEvidence,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  {data.teacher && (
                    <a
                      className="button"
                      href={`/zhiban/grading?tenant=${tenant}&offering=${offering}#queue`}
                    >
                      前往原评分与发布
                    </a>
                  )}
                </article>
              ))}
              {!data.submissions.length && <p>尚无正式成果提交。</p>}
              {data.next && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api(undefined, data.next)
                      .then(setData)
                      .catch((e) => setNotice(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  更早提交
                </button>
              )}
            </section>
            <section>
              <h2>实验报告与计算来源</h2>
              <p>
                汇总既有实验正式提交与原成绩。服务端模型计算与学习者报告分别标记；没有仪器实测来源就不称为实测。
              </p>
              {data.labReports?.map((r: any) => (
                <article key={r.submission_id}>
                  <h3>{r.title}</h3>
                  <p>{r.runs.length ? '含服务端模拟计算（非仪器实测）' : '学习者填写报告'}</p>
                  <p>{r.conclusion}</p>
                  <p>
                    {r.score_points === null
                      ? '成绩尚未发布'
                      : `已发布成绩 ${points(r.score_points)}/${points(r.max_points)}`}
                  </p>
                  <details>
                    <summary>计算与来源摘要</summary>
                    <pre>{JSON.stringify(r.runs, null, 2)}</pre>
                  </details>
                  <a
                    className="button"
                    href={`/zhiban/flow?tenant=${tenant}&offering=${offering}&mode=${data.teacher ? 'TEACHER' : 'STUDENT'}#notebook-${r.notebook_id}`}
                  >
                    查看原实验报告
                  </a>
                </article>
              ))}
              {!data.labReports?.length && <p>尚无本课程实验正式报告。</p>}
            </section>
            <section>
              <h2>全班共享课堂小结</h2>
              <p>
                只共享教师明确发布的版本、小结及本人板书文字；不公开学生私人对话／自测／PBL状态，不直接生成完成或成绩。
              </p>
              {data.teacher && (
                <>
                  <label>
                    来源课件
                    <select
                      aria-label="共享课件"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">请选择</option>
                      {data.choices.map((c: any) => (
                        <option key={c.resourceId} value={c.resourceId}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    标题
                    <input
                      value={shareTitle}
                      onChange={(e) => setShareTitle(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    教师课堂小结
                    <textarea
                      aria-label="教师课堂小结"
                      value={shareText}
                      onChange={(e) => setShareText(e.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <label>
                    <input
                      style={{ width: 'auto' }}
                      type="checkbox"
                      checked={board}
                      onChange={(e) => setBoard(e.target.checked)}
                    />{' '}
                    同时发布本人原生课堂板书文字（不含脚本、媒体或私人聊天）
                  </label>
                  <button
                    disabled={busy || !src || !shareText.trim()}
                    onClick={() =>
                      void run({
                        type: 'SHARE',
                        resourceId: source,
                        publicationId: src.publicationId,
                        title: shareTitle,
                        summary: shareText,
                        includeWhiteboard: board,
                      })
                    }
                  >
                    发布全班共享小结
                  </button>
                </>
              )}
              {data.shared.map((s: any) => (
                <article key={s.id}>
                  <h3>{s.title}</h3>
                  <p>{s.summary}</p>
                  {data.teacher && (
                    <button
                      disabled={busy}
                      onClick={() => void run({ type: 'RETRACT_SHARED', sharedId: s.id })}
                    >
                      撤回此共享小结
                    </button>
                  )}
                  {s.whiteboard?.length > 0 && <pre>{s.whiteboard.join('\n\n')}</pre>}
                  <small>
                    固定来源 {s.source_digest} · {new Date(s.created_at).toLocaleString()}
                  </small>
                </article>
              ))}
              <button disabled={busy} onClick={() => void refresh()}>
                刷新共享结果／重连
              </button>
            </section>
          </>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById('course-results-root')!).render(<Root />);
