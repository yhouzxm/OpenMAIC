/** Published-course adapter only. ClassroomSurface/Stage/PlaybackEngine/ChatArea are native. */
import React, { useEffect, useState } from 'react';
import { ClassroomSharing } from './classroom-sharing';
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { createRoot } from 'react-dom/client';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  SearchParamsContext,
  PathnameContext,
  PathParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { ModelSettingsInit } from '@/components/model-settings-init';
import { AgentRegistryInit } from '@/components/agent-registry-init';
import { Toaster } from '@/components/ui/sonner';
import { suppressGlobalLegacyImport } from '@/lib/persistence/browser-host-policy';
import { publishedPblRequest } from '@/lib/classroom/published-pbl-host';
import {
  configurePublishedClassroomHost,
  configurePublishedPbl,
} from '@/lib/classroom/published-host';
import { useStageStore } from '@/lib/store/stage';
import zh from '@/lib/i18n/locales/zh-CN.json';
suppressGlobalLegacyImport();
configurePublishedClassroomHost();
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering'),
  resource = q.get('resource'),
  publication = q.get('publication');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (![tenant, offering, resource, publication].every((v) => uuid.test(v ?? '')))
  throw Error('Invalid fixed classroom context');
const base = `/api/zhiban/classroom-ai/${tenant}/offerings/${offering}/resources/${resource}/publications/${publication}`;
const originalFetch = window.fetch.bind(window);
// CSRF is derived from this Session, not one-use. Deduplicate parallel native
// autosave/visibility calls; racing fresh Identity touches can reject a revision.
let csrf: Promise<string> | undefined;
const csrfToken = () =>
  (csrf ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      const response = await originalFetch('/api/zhiban/identity/csrf', {
        headers: { 'x-zhiban-request': 'identity-v1' },
        cache: 'no-store',
      });
      if (response.ok) return (await response.json()).csrfToken as string;
      // Only a safe token GET is retried. Never replay a model request or business write.
      if (response.status !== 503 || attempt >= 3)
        throw Error(
          response.status === 503
            ? '认证服务暂时繁忙，请稍后再试。'
            : '登录已失效，请返回课程重新登录',
        );
      await new Promise((resolve) => setTimeout(resolve, [50, 150, 350][attempt]));
    }
  })().catch((error) => {
    csrf = undefined;
    throw error;
  }));
const scopedFetch: typeof fetch = async (input, init) => {
  const req = new Request(input instanceof Request ? input : new URL(input, location.origin), init),
    u = new URL(req.url),
    headers = new Headers(req.headers);
  const piRequest =
    u.origin === location.origin && u.pathname === '/api/chat/pi' && req.method === 'POST';
  let requestBody: ArrayBuffer | string | undefined;
  if (piRequest) {
    const value = await req.json();
    // The server reads the full immutable source itself. Send only the native UI anchors,
    // so deeply nested courseware/grouped elements never travel as client authority.
    const state = value.storeState;
    value.storeState = {
      stage: { id: state?.stage?.id },
      currentSceneId: state?.currentSceneId,
      whiteboardOpen: state?.whiteboardOpen,
      whiteboardManualVisibilityRevision: state?.whiteboardManualVisibilityRevision,
    };
    requestBody = JSON.stringify(value);
  }
  if (
    u.origin === location.origin &&
    u.pathname.startsWith('/api/') &&
    !u.pathname.startsWith('/api/zhiban/')
  )
    u.pathname = base + '/native' + u.pathname;
  if (u.origin === location.origin && u.pathname.startsWith('/api/zhiban/')) {
    headers.set('x-zhiban-request', 'identity-v1');
    if (!['GET', 'HEAD'].includes(req.method)) {
      headers.set('x-zhiban-csrf', await csrfToken());
    }
  }
  const response = await originalFetch(u, {
    method: req.method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: req.signal,
    ...(!['GET', 'HEAD'].includes(req.method)
      ? { body: requestBody ?? (await req.arrayBuffer()) }
      : {}),
  });
  if ([401, 403].includes(response.status)) csrf = undefined;
  return response;
};
window.fetch = async (input, init) => {
  const request = new Request(
    input instanceof Request ? input : new URL(input, location.origin),
    init,
  );
  const url = new URL(request.url);
  if (
    url.origin === location.origin &&
    url.pathname.startsWith('/api/pbl/v2/') &&
    url.pathname !== '/api/pbl/v2/state' &&
    request.method === 'POST'
  )
    return publishedPblRequest(request, (r) => scopedFetch(r));
  return scopedFetch(request);
};
const course = `/zhiban/content?tenant=${tenant}&offering=${offering}`;
const navigate = () => location.assign(course);
const router = {
  bfcacheId: crypto.randomUUID(),
  back: navigate,
  forward: () => history.forward(),
  refresh: () => location.reload(),
  push: navigate,
  replace: navigate,
  prefetch: async () => {},
};
type Boot = {
  teacher: boolean;
  hasPbl: boolean;
  pblEnabled: boolean;
  pblRevision: string;
  enabled: boolean;
  revision: string;
  stageId: string;
  title: string;
  sourceDigest: string;
};
async function load() {
  const r = await fetch(base);
  if (!r.ok) throw Error('当前课件已撤回、版本已变化或课程资格不可用，请返回课程。');
  const value = (await r.json()) as Boot;
  // Establish the Session proof before native history hydration starts parallel autosaves.
  if (value.enabled) await csrfToken();
  return value;
}
function Root() {
  const [data, setData] = useState<Boot | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      void load()
        .then((v) => {
          if (live) {
            if (!v.enabled) useStageStore.getState().clearStore();
            setData(v);
            setError('');
          }
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setData(null);
            useStageStore.getState().clearStore();
          }
        });
    read();
    const t = setInterval(read, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  useEffect(()=>{
    const target=q.get('scene');if(!target)return;let applied=false;
    const apply=()=>{const state=useStageStore.getState();if(!applied&&state.scenes.some(s=>s.id===target)){applied=true;state.setCurrentSceneId(target);}};
    const stop=useStageStore.subscribe(apply);apply();return stop;
  },[]);
  configurePublishedPbl(data?.pblEnabled === true);
  const change = async (pbl = false) => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const r = await fetch(base + (pbl ? '/pbl-policy' : '/policy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: pbl ? !data.pblEnabled : !data.enabled,
          revision: pbl ? data.pblRevision : data.revision,
        }),
      });
      if (!r.ok)
        throw Error(r.status === 409 ? '设置已变化，请刷新后核对' : '当前任教或发布资格已变化');
      setData(await load());
      setNotice(
        pbl
          ? data.pblEnabled
            ? '自主 PBL 已停用，本人进度保留。'
            : '已开启本发布版本的原生自主 PBL。'
          : data.enabled
            ? '该发布版本的 AI 课堂已停用。'
            : '已启用该发布版本的 AI 课堂；换版后须重新启用。',
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppRouterContext.Provider value={router}>
      <SearchParamsContext.Provider value={q}>
        <PathnameContext.Provider value="/zhiban/native-classroom">
          <PathParamsContext.Provider value={{}}>
            <ImageConfigContext.Provider value={{ ...imageConfigDefault, unoptimized: true }}>
              <ThemeProvider>
                <I18nProvider initialLocale="zh-CN" initialResources={zh}>
                  <div className="native-classroom-shell">
                    <header className="native-classroom-bar">
                      <a href={course}>← 返回课程</a>
                      <a href={`/zhiban/course-results?tenant=${tenant}&offering=${offering}${q.get('resultAttempt')?'&attempt='+encodeURIComponent(q.get('resultAttempt')!):''}`}>课堂成果与共享结果</a>
                      <strong>原生 AI 课堂{data ? ' · ' + data.title : ''}</strong>
                      {data?.teacher && (
                        <button disabled={busy} onClick={() => void change()}>
                          {data.enabled ? '停用该版本 AI 课堂' : '启用该版本 AI 课堂'}
                        </button>
                      )}
                      {data?.teacher && data.hasPbl && (
                        <button disabled={busy} onClick={() => void change(true)}>
                          {data.pblEnabled ? '停用自主 PBL' : '开启自主 PBL'}
                        </button>
                      )}
                      <small>
                        固定发布版本 · 本人问答／圆桌／白板／自测与自主 PBL · 不自动计正式完成或成绩
                      </small>
                      {notice && <span role="status">{notice}</span>}
                    </header>
                    {data?.enabled&&<ClassroomSharing key={data.stageId} base={base} teacher={data.teacher}/>}
                    {error ? (
                      <section className="native-classroom-notice" role="alert">
                        {error}
                      </section>
                    ) : !data ? (
                      <p role="status">正在核对课程资格与发布版本…</p>
                    ) : !data.enabled ? (
                      <section className="native-classroom-notice">
                        <h1>该发布版本的 AI 课堂尚未启用</h1>
                        <p>
                          任教教师可在上方启用。普通课件阅读仍可使用；新发布版本默认关闭 AI 课堂。
                        </p>
                        <a href={`/zhiban/native-published?${q}`}>查看固定发布课件 →</a>
                      </section>
                    ) : (
                      <div className="native-classroom-body">
                        <ModelSettingsInit />
                        <AgentRegistryInit />
                        <ClassroomSurface
                          key={String(data.pblEnabled)}
                          classroomId={data.stageId}
                        />
                      </div>
                    )}
                  </div>
                  <Toaster />
                </I18nProvider>
              </ThemeProvider>
            </ImageConfigContext.Provider>
          </PathParamsContext.Provider>
        </PathnameContext.Provider>
      </SearchParamsContext.Provider>
    </AppRouterContext.Provider>
  );
}
createRoot(document.getElementById('native-classroom-root')!).render(<Root />);
