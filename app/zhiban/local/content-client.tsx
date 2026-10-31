import { InteractiveContentPanel } from './interactive-client';
import { publishedPlayerHref } from './published-player-link';
import { CourseMaterials } from './material-client';
import { CourseLearningCenter, learningCenterRoute } from './learning-center-client';
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SlideCanvas } from '@openmaic/renderer';
import {
  createEditorHistory,
  createEditorTransaction,
  applyEditorTransaction,
  undoEditorTransaction,
  redoEditorTransaction,
} from '@openmaic/editor/core';
const coursePage = (
  window as Window & {
    zhibanCoursePage?: {
      query: string;
      ready: Promise<boolean>;
      setDirty(key: string, dirty: boolean, root?: HTMLElement | null): void;
    };
  }
).zhibanCoursePage;
type AuthorFlow = {
  action: string;
  chapter: string;
  kind: string;
  target?: string;
  returnUrl(id: string): string;
};
const incomingAuthorFlow =
  (
    window as Window & { zhibanCurriculum?: { flow(): AuthorFlow | null } }
  ).zhibanCurriculum?.flow() ?? null;
const authorFlow = incomingAuthorFlow?.kind === 'MATERIAL' ? null : incomingAuthorFlow;
const params = new URLSearchParams(coursePage?.query ?? location.search),
  tenant = params.get('tenant'),
  offering = params.get('offering');
const base = `/api/zhiban/content/${tenant}/offerings/${offering}`;
const errors: any = {
  FORBIDDEN: '当前登录、任教或选课资格不允许此操作。',
  CONFLICT: '内容已变化，请保留输入，刷新列表后重新打开比较。',
  OUTCOME_UNKNOWN: '发布结果待核验，请勿重复发布；草稿暂时锁定。',
  INVALID_INPUT:
    '请检查内容、布局和 PNG 格式（8 位 RGB/RGBA、非交错、最多 4096 边长及 约419 万像素）。',
  TOO_LARGE: '图片最多 4 MiB；每份内容及发布版本合计最多 32 MiB。',
  UNSUPPORTED_MEDIA_TYPE: '仅支持 PNG 图片。',
  INVALID_STATE: '当前内容状态不允许此操作。',
  UNAUTHENTICATED: '请返回工作台登录。',
};
async function request(path = base, cmd?: any, key?: string) {
  const headers: any = { 'x-zhiban-request': 'identity-v1' };
  const pinned = /^#classroom-resource-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(
    location.hash,
  );
  if (!cmd && pinned && path === `${base}/resources/${pinned[1]}/preview?source=published`)
    headers['x-zhiban-publication-version'] = pinned[2];
  if (cmd) {
    const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
    if (!r.ok) throw new Error(errors.UNAUTHENTICATED);
    headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
    headers['Content-Type'] = 'application/json';
    headers['x-zhiban-command'] = key ?? crypto.randomUUID().replaceAll('-', '');
  }
  const r = await fetch(path, {
      headers,
      cache: 'no-store',
      method: cmd ? 'POST' : 'GET',
      body: cmd ? JSON.stringify(cmd) : undefined,
      signal: AbortSignal.timeout(15000),
    }),
    data = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(errors[data.error?.code] ?? '教学内容暂时不可用，请查看当前操作结果。'),
      { status: r.status },
    );
  return data;
}
const slide = (s: any) => ({
  type: 'slide',
  canvas: {
    id: s.id,
    viewportSize: 960,
    viewportRatio: 0.5625,
    elements: s.elements.map((e: any) => ({
      id: e.id,
      ...(e.assetId
        ? { type: 'image', src: `asset:${e.assetId}`, fixedRatio: true }
        : {
            type: 'text',
            content: e.text,
            defaultFontName: 'sans-serif',
            defaultColor: '#111111',
          }),
      left: e.x,
      top: e.y,
      width: e.width,
      height: e.height,
      rotate: 0,
    })),
    background: { type: 'solid', color: '#ffffff' },
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
  },
});
const dto = (h: any) => ({
  id: h.present.canvas.id,
  elements: h.present.canvas.elements.map((e: any) => ({
    id: e.id,
    ...(e.type === 'image' ? { assetId: e.src.slice(6) } : { text: e.content }),
    x: e.left,
    y: e.top,
    width: e.width,
    height: e.height,
  })),
});
function valid(s: any) {
  if (s.elements.length > 32) throw new Error(errors.INVALID_INPUT);
  for (const e of s.elements) {
    if (
      (!e.assetId &&
        (e.text.length > 2000 ||
          !e.text.isWellFormed() ||
          /[<>&\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(e.text))) ||
      ![e.x, e.y, e.width, e.height].every(Number.isSafeInteger) ||
      e.x < 0 ||
      e.y < 0 ||
      e.width < 1 ||
      e.height < 1 ||
      e.x + e.width > 960 ||
      e.y + e.height > 540
    )
      throw new Error(errors.INVALID_INPUT);
  }
}
function App() {
  const [list, setList] = useState<any>({ resources: [], canEdit: false }),
    [current, setCurrent] = useState<any>(null),
    [title, setTitle] = useState(''),
    [histories, setHistories] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [newTitle, setNewTitle] = useState(''),
    [pngFile, setPngFile] = useState<File | null>(null),
    [pngAssets, setPngAssets] = useState<any[]>([]),
    [selectedPng, setSelectedPng] = useState(''),
    [savedImages, setSavedImages] = useState<Set<string>>(new Set()),
    [pendingOpen, setPendingOpen] = useState<string | null>(null),
    [following, setFollowing] = useState(true),
    [followEpoch, setFollowEpoch] = useState(0),
    [teacherPage, setTeacherPage] = useState<number | null>(null),
    [followStatus, setFollowStatus] = useState('正在核对课堂位置');
  const pageRef = useRef(page);
  pageRef.current = page;
  const classroomContext =
    /^#classroom-resource-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(location.hash);
  const classroomResource = classroomContext?.[1],
    classroomVersion = classroomContext?.[2],
    classroomId = classroomContext?.[3];
  const inClassroom = !!classroomId && current?.id === classroomResource && current?.viewOnly;
  useEffect(() => {
    const shell = coursePage;
    shell?.setDirty(
      'content',
      dirty || (authorFlow?.action === 'compose' && newTitle.trim().length > 0),
      document.getElementById('root'),
    );
    return () => shell?.setDirty('content', false);
  }, [dirty, newTitle]);
  const refresh = async () => {
    const v = await request();
    setList(v);
    return v;
  };
  useEffect(() => {
    refresh()
      .then(async (v) => {
        const classroom =
          /^#classroom-resource-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(
            location.hash,
          );
        const draftTarget = /^#resource-([0-9a-f-]{36})-draft$/.exec(location.hash);
        const match = draftTarget ?? /^#resource-([0-9a-f-]{36})$/.exec(location.hash) ?? classroom;
        const target = authorFlow?.action === 'edit' ? authorFlow.target : match?.[1];
        if (!target) return;
        const resource = v.resources.find((r: any) => r.id === target);
        if (resource?.interactive) {
          setNotice('该资源为离线 HTML 互动，请使用互动内容区域的已发布入口。');
          return;
        }
        if (!resource) {
          setNotice('该讲义当前不可访问，请返回课程目录刷新。');
          return;
        }
        const published =
          !draftTarget && authorFlow?.action !== 'edit' && resource.state === 'PUBLISHED';
        const preview = await request(
          `${base}/resources/${resource.id}/preview?source=${published ? 'published' : 'draft'}`,
        );
        adopt({ ...resource, viewOnly: published || !resource.teacher }, preview);
      })
      .catch((e) => setNotice(e.message));
  }, []);
  // An ID is a navigation request, never an authorization capability.
  useEffect(() => {
    const handler = (event: Event) => {
      const target = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof target === 'string' && /^[0-9a-f-]{36}$/.test(target)) setPendingOpen(target);
    };
    window.addEventListener('zhiban:open-content-draft', handler);
    return () => window.removeEventListener('zhiban:open-content-draft', handler);
  }, []);
  useEffect(() => {
    if (!pendingOpen || busy) return;
    const target = pendingOpen;
    setPendingOpen(null);
    void run(async () => {
      if (dirty && !confirm('当前有未保存修改，确认放弃后打开新草稿？')) {
        setNotice('已采用为草稿；当前修改已保留，可稍后打开采用草稿。');
        return;
      }
      const latest = await refresh();
      const resource = latest.resources.find((r: any) => r.id === target);
      if (!resource?.teacher) throw new Error(errors.FORBIDDEN);
      const preview = await request(`${base}/resources/${target}/preview?source=draft`);
      adopt({ ...resource, viewOnly: false }, preview);
      history.replaceState(null, '', '#resource-' + target + '-draft');
      setNotice('已打开采用草稿，请审核、保存并显式发布。');
      document.getElementById('root')?.scrollIntoView({ block: 'start' });
    });
  }, [pendingOpen, dirty, busy]);
  useEffect(() => {
    if (!inClassroom) return;
    let closed = false,
      loading = false,
      healthy = false,
      lastRevision: string | null = null;
    const clear = (message: string) => {
      setCurrent(null);
      setHistories([]);
      setTeacherPage(null);
      setNotice(message);
    };
    const sync = async () => {
      if (closed || loading || document.hidden || !navigator.onLine) return;
      loading = true;
      try {
        const state = await request(
          `/api/zhiban/learning/${tenant}/offerings/${offering}/classrooms`,
        );
        if (closed) return;
        const session = state.sessions.find((x: any) => x.id === classroomId);
        const task = session?.tasks.find(
          (x: any) =>
            x.state === 'ACTIVE' &&
            x.kind === 'LECTURE' &&
            x.target_id === classroomResource &&
            x.target_version === classroomVersion,
        );
        if (!session || session.state !== 'PUBLISHED' || !task) {
          clearInterval(timer);
          clear('课堂已结束或任务已切换，请返回课堂重新进入。');
          return;
        }
        if (
          !task.available ||
          !Number.isInteger(task.current_page) ||
          task.current_page < 1 ||
          task.current_page > task.page_count
        ) {
          clear('课堂讲义版本已失效，请返回课堂重新进入。');
          return;
        }
        if (!healthy || lastRevision !== task.presentation_revision) {
          const preview = await request(
            `${base}/resources/${classroomResource}/preview?source=published`,
          );
          if (closed) return;
          if (
            preview.publicationId !== current.publicationId ||
            task.current_page > preview.slides.length
          ) {
            clear('发布版本已变化，请返回课堂重新进入。');
            return;
          }
          const keep = pageRef.current;
          adopt(current, preview);
          setPage(following ? task.current_page - 1 : Math.min(keep, preview.slides.length - 1));
        }
        setTeacherPage(task.current_page);
        setFollowStatus(
          following
            ? `已跟随教师：第 ${task.current_page} 页`
            : `自主浏览；教师当前第 ${task.current_page} 页`,
        );
        lastRevision = task.presentation_revision;
        healthy = true;
      } catch (e: any) {
        if (closed) return;
        healthy = false;
        if (e.status) clear('课堂授权或发布状态已变化，请返回课堂重新检查。');
        else setFollowStatus('连接暂时中断，保留最后已读取讲义；联网后重新核对授权和版本。');
      } finally {
        loading = false;
      }
    };
    const offline = () => {
      healthy = false;
      setFollowStatus('连接暂时中断，保留最后已读取讲义；联网后重新核对授权和版本。');
    };
    const visible = () => {
      if (!document.hidden) void sync();
    };
    const timer = setInterval(() => void sync(), 5000);
    void sync();
    window.addEventListener('online', visible);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      closed = true;
      clearInterval(timer);
      window.removeEventListener('online', visible);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [
    inClassroom,
    current?.id,
    current?.publicationId,
    classroomResource,
    classroomVersion,
    classroomId,
    following,
    followEpoch,
  ]);
  useEffect(() => {
    const h = () => {
      setCurrent(null);
      setHistories([]);
      setNotice('请刷新以重新检查登录和资格。');
    };
    window.addEventListener('pageshow', h);
    return () => window.removeEventListener('pageshow', h);
  }, []);
  const run = async (body: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await body();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const adopt = (r: any, d: any) => {
    if (
      d.slides?.length === 1 &&
      d.slides[0].elements?.[0]?.text?.startsWith('原生完整课件 · 来源 SHA256 ')
    ) {
      location.href = r.viewOnly
        ? `/zhiban/native-published?tenant=${tenant}&offering=${offering}&resource=${r.id}&publication=${d.publicationId}`
        : `/zhiban/native-review?tenant=${tenant}&offering=${offering}&resource=${r.id}`;
      return;
    }
    setCurrent({ ...r, publicationId: d.publicationId });
    setSavedImages(
      new Set(
        d.slides.flatMap((s: any) =>
          s.elements.filter((e: any) => e.assetId).map((e: any) => `${s.id}:${e.id}:${e.assetId}`),
        ),
      ),
    );
    setPngAssets([]);
    setSelectedPng('');
    setPngFile(null);
    if (r.pngEnabled && !r.viewOnly)
      request(`${base}/resources/${r.id}/assets`)
        .then((v) => setPngAssets(v.assets))
        .catch((e) => setNotice(e.message));
    setTitle(d.title);
    setHistories(d.slides.map((s: any) => createEditorHistory(slide(s) as any)));
    setPage(0);
    setDirty(false);
  };
  const open = (r: any, published = false) =>
    run(async () => {
      if (dirty && !confirm('当前有未保存修改，确认放弃后打开？')) return;
      const d = await request(
        `${base}/resources/${r.id}/preview?source=${published ? 'published' : 'draft'}`,
      );
      adopt({ ...r, viewOnly: published || !r.teacher }, d);
    });
  const edit = (operations: any[]) => {
    try {
      const hs = histories.slice();
      hs[page] = applyEditorTransaction(
        hs[page],
        createEditorTransaction({ origin: 'toolbar', operations }),
      );
      valid(dto(hs[page]));
      setHistories(hs);
      setDirty(true);
      setNotice('');
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const finish = async (cmd: any) => {
    await request(base, cmd);
    const v = await refresh(),
      r = v.resources.find((r: any) => r.id === current.id);
    if (r) adopt(r, r.draft);
  };
  const s = histories[page]?.present.canvas;
  return (
    <>
      <h1>教学内容</h1>
      <InteractiveContentPanel />
      <CourseMaterials tenant={tenant!} offering={offering!} />
      {authorFlow && list.canEdit && (
        <section className="content-card" aria-label="章节编辑接续">
          <p>
            {authorFlow.action === 'compose' ? '为原章节新建讲义。' : '编辑原章节讲义。'}
            保存后可返回原章节，目录仍需独立保存和发布。
          </p>
          {current?.teacher && !current.viewOnly && (
            <>
              <a
                className="button secondary"
                href={
                  !busy && !dirty && !current.quarantined
                    ? authorFlow.returnUrl(current.id)
                    : undefined
                }
                aria-disabled={busy || dirty || current.quarantined}
              >
                返回原章节并加入目录
              </a>
              {dirty && <p>请先保存讲义草稿，再返回原章节。</p>}
            </>
          )}
        </section>
      )}
      <p>编辑草稿后保存，再显式发布。预览不产生学习完成或成绩。</p>
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      <div className="content-layout">
        <aside className="content-list content-card">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await refresh();
              })
            }
          >
            刷新列表
          </button>
          {list.canEdit && (
            <>
              <label>
                新内容标题
                <input
                  aria-label="新内容标题"
                  autoFocus={authorFlow?.action === 'compose'}
                  value={newTitle}
                  maxLength={120}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <button
                disabled={busy || dirty}
                onClick={() =>
                  run(async () => {
                    const result = await request(base, {
                      type: 'CREATE_CONTENT',
                      title: newTitle.trim(),
                    });
                    const v = await refresh(),
                      r = v.resources.find((r: any) => r.id === result.id);
                    adopt(r, r.draft);
                    if (authorFlow)
                      history.replaceState(
                        null,
                        '',
                        location.pathname +
                          location.search +
                          `#edit-${authorFlow.chapter}-LECTURE-${r.id}`,
                      );
                    setNewTitle('');
                  })
                }
              >
                新建内容
              </button>
            </>
          )}
          {list.resources
            .filter((r: any) => !r.interactive)
            .map((r: any) => (
              <article key={r.id}>
                <h3>{r.title}</h3>
                <small>
                  {r.quarantined
                    ? '发布待核验 · 草稿锁定'
                    : r.state === 'PUBLISHED'
                      ? '已发布'
                      : r.state === 'WITHDRAWN'
                        ? '已撤回'
                        : '草稿'}
                </small>
                {r.teacher && (
                  <button disabled={busy} onClick={() => open(r)}>
                    {r.draft?.slides?.[0]?.elements?.[0]?.text?.startsWith(
                      '原生完整课件 · 来源 SHA256 ',
                    )
                      ? '审核完整课件'
                      : '编辑草稿'}
                  </button>
                )}
                {r.state === 'PUBLISHED' && (
                  <button disabled={busy} onClick={() => open(r, true)}>
                    查看已发布
                  </button>
                )}
              </article>
            ))}
        </aside>
        <section className="content-card content-editor">
          {current ? (
            <>
              <h2>{current.viewOnly ? '已发布预览' : '内容草稿'}</h2>
              {current.viewOnly && current.publicationId && (
                <p>
                  <a
                    href={publishedPlayerHref(
                      tenant!,
                      offering!,
                      current.id,
                      current.publicationId,
                    )}
                  >
                    使用 OpenMAIC 原生 PPT 播放器
                  </a>
                </p>
              )}
              {inClassroom && (
                <section aria-label="课堂讲义同步">
                  <p role="status">{followStatus}</p>
                  <button aria-pressed={following} onClick={() => setFollowing(!following)}>
                    {following ? '切换自主浏览' : '跟随教师翻页'}
                  </button>
                  <button onClick={() => setFollowEpoch((x) => x + 1)}>重新同步课堂讲义</button>
                  {teacherPage !== null && <span>教师位置：第 {teacherPage} 页</span>}
                  <p>翻页与跟随不产生完成率、作答或成绩。</p>
                </section>
              )}
              <p className="content-status">
                {dirty ? '未保存' : current.viewOnly ? '当前已发布版本' : '已保存'} ·{' '}
                {current.revision && `版本 ${current.revision}`}
              </p>
              {!current.viewOnly && (
                <>
                  {!current.pngEnabled && <p>此内容保留原文本版本；新建内容可使用 PNG 图片。</p>}
                  <label>
                    内容标题
                    <input
                      aria-label="内容标题"
                      value={title}
                      maxLength={120}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                  <div className="content-controls">
                    <button
                      disabled={busy || current.quarantined}
                      onClick={() =>
                        run(() =>
                          finish({
                            type: 'SAVE_CONTENT',
                            id: current.id,
                            revision: current.revision,
                            title: title.trim(),
                            slides: histories.map(dto),
                          }),
                        )
                      }
                    >
                      保存草稿
                    </button>
                    <button
                      disabled={busy || dirty || current?.quarantined}
                      onClick={() =>
                        run(() =>
                          finish({
                            type: 'PUBLISH_CONTENT',
                            id: current.id,
                            revision: current.revision,
                          }),
                        )
                      }
                    >
                      发布保存版本
                    </button>
                    {current.state === 'PUBLISHED' && (
                      <button
                        disabled={busy || dirty || current?.quarantined}
                        onClick={() =>
                          run(() =>
                            finish({
                              type: 'WITHDRAW_CONTENT',
                              id: current.id,
                              revision: current.revision,
                            }),
                          )
                        }
                      >
                        撤回发布
                      </button>
                    )}
                    <button
                      disabled={busy || histories.length >= 32}
                      onClick={() => {
                        setHistories([
                          ...histories,
                          createEditorHistory(slide({ id: uuid7(), elements: [] }) as any),
                        ]);
                        setPage(histories.length);
                        setDirty(true);
                      }}
                    >
                      添加页面
                    </button>
                  </div>
                </>
              )}
              <div className="content-controls">
                {histories.map((h: any, i: number) => (
                  <button
                    key={h.present.canvas.id}
                    onClick={() => {
                      if (inClassroom) setFollowing(false);
                      setPage(i);
                    }}
                  >
                    第 {i + 1} 页
                  </button>
                ))}
              </div>
              {!current.viewOnly && s && (
                <>
                  {current.pngEnabled && (
                    <fieldset>
                      <legend>PNG 图片资源</legend>
                      <p>
                        单张最多 4 MiB，8 位 RGB/RGBA、非交错、最多 400
                        万像素。上传后选择加入本页，保存后预览。
                      </p>
                      <input
                        aria-label="PNG 文件"
                        type="file"
                        accept="image/png,.png"
                        onChange={(e) => setPngFile(e.target.files?.[0] ?? null)}
                      />
                      <button
                        disabled={busy || !pngFile || current.quarantined}
                        onClick={() =>
                          run(async () => {
                            if (!pngFile || pngFile.size > 4194304)
                              throw new Error(errors.TOO_LARGE);
                            const csrf = await request('/api/zhiban/identity/csrf');
                            const r = await fetch(
                              `${base}/resources/${current.id}/assets?revision=${current.revision}`,
                              {
                                method: 'POST',
                                headers: {
                                  'x-zhiban-request': 'identity-v1',
                                  'x-zhiban-csrf': csrf.csrfToken,
                                  'x-zhiban-command': crypto.randomUUID().replaceAll('-', ''),
                                  'Content-Type': 'image/png',
                                },
                                body: pngFile,
                                cache: 'no-store',
                                signal: AbortSignal.timeout(15000),
                              },
                            );
                            const data = await r.json();
                            if (!r.ok)
                              throw new Error(
                                errors[data.error?.code] ?? '上传失败，请重新检查当前内容状态。',
                              );
                            const registered = await request(
                              `${base}/resources/${current.id}/assets`,
                            );
                            setPngAssets(registered.assets);
                            setSelectedPng(data.id);
                            setPngFile(null);
                            setNotice('PNG 已登记，请加入本页并保存。');
                          })
                        }
                      >
                        上传 PNG
                      </button>
                      <label>
                        已登记 PNG
                        <select
                          aria-label="已登记 PNG"
                          value={selectedPng}
                          onChange={(e) => setSelectedPng(e.target.value)}
                        >
                          <option value="">选择图片</option>
                          {pngAssets.map((a, i) => (
                            <option key={a.id} value={a.id}>
                              PNG {i + 1} · {a.width}×{a.height} · {Math.ceil(a.size / 1024)} KiB
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={busy || !selectedPng || s.elements.length >= 32}
                        onClick={() =>
                          edit([
                            {
                              type: 'element.add',
                              element: {
                                id: uuid7(),
                                type: 'image',
                                src: `asset:${selectedPng}`,
                                fixedRatio: true,
                                left: 30,
                                top: 160,
                                width: 400,
                                height: 250,
                                rotate: 0,
                              },
                            },
                          ])
                        }
                      >
                        添加 PNG 到本页
                      </button>
                    </fieldset>
                  )}
                  <div className="content-controls">
                    <button
                      onClick={() => {
                        const hs = histories.slice();
                        hs[page] = undoEditorTransaction(hs[page]);
                        setHistories(hs);
                        setDirty(true);
                      }}
                    >
                      撤销
                    </button>
                    <button
                      onClick={() => {
                        const hs = histories.slice();
                        hs[page] = redoEditorTransaction(hs[page]);
                        setHistories(hs);
                        setDirty(true);
                      }}
                    >
                      重做
                    </button>
                    <button
                      disabled={s.elements.length >= 32}
                      onClick={() =>
                        edit([
                          {
                            type: 'element.add',
                            element: {
                              id: uuid7(),
                              type: 'text',
                              left: 30,
                              top: 30,
                              width: 800,
                              height: 100,
                              rotate: 0,
                              content: '新文本',
                              defaultFontName: 'sans-serif',
                              defaultColor: '#111111',
                            },
                          },
                        ])
                      }
                    >
                      添加文本框
                    </button>
                    <button
                      disabled={histories.length <= 1}
                      onClick={() => {
                        setHistories(histories.filter((_, i) => i !== page));
                        setPage(Math.max(0, page - 1));
                        setDirty(true);
                      }}
                    >
                      删除当前页
                    </button>
                    <button
                      disabled={page === 0}
                      onClick={() => {
                        const hs = histories.slice();
                        [hs[page - 1], hs[page]] = [hs[page], hs[page - 1]];
                        setHistories(hs);
                        setPage(page - 1);
                        setDirty(true);
                      }}
                    >
                      页面上移
                    </button>
                    <button
                      disabled={page === histories.length - 1}
                      onClick={() => {
                        const hs = histories.slice();
                        [hs[page + 1], hs[page]] = [hs[page], hs[page + 1]];
                        setHistories(hs);
                        setPage(page + 1);
                        setDirty(true);
                      }}
                    >
                      页面下移
                    </button>
                  </div>
                  {s.elements.map((e: any, i: number) => (
                    <fieldset key={e.id}>
                      <legend>
                        {e.type === 'image' ? 'PNG 图片' : '文本框'} {i + 1}
                      </legend>
                      {e.type === 'text' && (
                        <label>
                          正文
                          <textarea
                            aria-label={`正文 ${i + 1}`}
                            value={e.content}
                            maxLength={2000}
                            onChange={(v) =>
                              edit([
                                {
                                  type: 'text.updateContent',
                                  elementId: e.id,
                                  content: v.target.value,
                                },
                              ])
                            }
                          />
                        </label>
                      )}
                      <div className="geometry">
                        {['left', 'top', 'width', 'height'].map((k: string) => (
                          <label key={k}>
                            {
                              (
                                {
                                  left: '横坐标',
                                  top: '纵坐标',
                                  width: '宽度',
                                  height: '高度',
                                } as any
                              )[k]
                            }
                            <input
                              type="number"
                              aria-label={`${k} ${i + 1}`}
                              value={e[k]}
                              onChange={(v) =>
                                edit([
                                  {
                                    type: 'element.update',
                                    elementId: e.id,
                                    patch: { [k]: Number(v.target.value) },
                                  },
                                ])
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <button onClick={() => edit([{ type: 'element.delete', elementId: e.id }])}>
                        {e.type === 'image' ? '删除图片' : '删除文本框'}
                      </button>
                      <button
                        disabled={i === 0}
                        onClick={() =>
                          edit([{ type: 'element.reorder', elementId: e.id, index: i - 1 }])
                        }
                      >
                        层级上移
                      </button>
                      <button
                        disabled={i === s.elements.length - 1}
                        onClick={() =>
                          edit([{ type: 'element.reorder', elementId: e.id, index: i + 1 }])
                        }
                      >
                        层级下移
                      </button>
                    </fieldset>
                  ))}
                </>
              )}
              <h3>页面预览</h3>
              {s && (
                <div className="content-preview">
                  <SlideCanvas
                    slide={s}
                    renderImage={(e) => {
                      const assetId = e.src.slice(6);
                      if (!savedImages.has(`${s.id}:${e.id}:${assetId}`))
                        return <span>保存草稿后显示 PNG</span>;
                      const src = `${base}/resources/${current.id}/assets/${assetId}?source=${current.viewOnly ? 'published' : 'draft'}&version=${current.viewOnly ? current.publicationId : current.revision}&slide=${s.id}`;
                      return <img src={src} alt="课件 PNG" referrerPolicy="same-origin" />;
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <p>选择教学内容以查看或编辑。</p>
          )}
        </section>
      </div>
    </>
  );
}
function uuid7() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let t = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & BigInt(255));
    t >>= BigInt(8);
  }
  b[6] = (b[6] & 15) | 112;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
void (async () => {
  const shell = coursePage;
  if (shell && !(await shell.ready)) return;
  createRoot(document.getElementById('root')!).render(
    learningCenterRoute(location.pathname) ? <CourseLearningCenter /> : <App />,
  );
})();
