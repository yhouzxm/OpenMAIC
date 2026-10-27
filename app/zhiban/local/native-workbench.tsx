/** Course navigation/authorization adapter. The three-pane workspace and all editors are upstream. */
import { suppressGlobalLegacyImport } from '@/lib/persistence/browser-host-policy';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  SearchParamsContext,
  PathnameContext,
  PathParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { WorkspaceShell } from '@/components/workbench/workspace/WorkspaceShell';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { Toaster } from '@/components/ui/sonner';
import { AgentRegistryInit } from '@/components/agent-registry-init';
import { ModelSettingsInit } from '@/components/model-settings-init';
import { useStageStore, flushStageSave, hasPendingStageDocumentChanges } from '@/lib/store/stage';
import zh from '@/lib/i18n/locales/zh-CN.json';
suppressGlobalLegacyImport();
window.addEventListener('beforeunload', (event) => {
  const stage = useStageStore.getState().stage;
  if (stage && hasPendingStageDocumentChanges(stage.id)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
const initial = new URLSearchParams(location.search),
  tenant = initial.get('tenant'),
  offering = initial.get('offering'),
  returnCourse = initial.get('returnCourse');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!uuid.test(tenant ?? '') || !uuid.test(offering ?? '')) throw Error('Invalid course context');
const base = `/api/zhiban/authoring/${tenant}/offerings/${offering}`;
const originalFetch = window.fetch.bind(window);
const nativeUrl = (input: string | URL) => {
  const u = new URL(input, location.origin);
  if (
    u.origin === location.origin &&
    u.pathname.startsWith('/api/') &&
    !u.pathname.startsWith('/api/zhiban/')
  )
    u.pathname = base + '/native' + u.pathname;
  return u;
};
// This isolated document owns the upstream network adapter; no portal/global fetch is changed.
window.fetch = async (input, init) => {
  const req = new Request(input instanceof Request ? input : nativeUrl(input), init);
  const u = nativeUrl(req.url),
    headers = new Headers(req.headers);
  if (u.origin === location.origin && u.pathname.startsWith('/api/zhiban/')) {
    headers.set('x-zhiban-request', 'identity-v1');
    if (!['GET', 'HEAD'].includes(req.method)) {
      const csrf = await originalFetch('/api/zhiban/identity/csrf', {
        headers: { 'x-zhiban-request': 'identity-v1' },
        cache: 'no-store',
      });
      if (!csrf.ok) throw Error('登录已失效');
      headers.set('x-zhiban-csrf', (await csrf.json()).csrfToken);
    }
  }
  return originalFetch(u, {
    method: req.method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: req.signal,
    ...(!['GET', 'HEAD'].includes(req.method) ? { body: await req.arrayBuffer() } : {}),
  });
};
const NativeEventSource = window.EventSource;
window.EventSource = class extends NativeEventSource {
  constructor(url: string | URL, options?: EventSourceInit) {
    super(nativeUrl(url), options);
  }
};
const savedPush = history.pushState.bind(history),
  savedReplace = history.replaceState.bind(history);
function scopedUrl(raw: string | URL | null | undefined) {
  const u = new URL(raw ?? location.href, location.origin);
  if (
    u.origin === location.origin &&
    (u.pathname === '/workspace' || u.pathname.startsWith('/classroom/'))
  ) {
    if (u.pathname.startsWith('/classroom/'))
      u.searchParams.set('course', u.pathname.split('/').pop()!);
    u.pathname = '/zhiban/native-workbench';
  }
  if (u.pathname === '/zhiban/native-workbench') {
    u.searchParams.set('tenant', tenant!);
    u.searchParams.set('offering', offering!);
    if (returnCourse) u.searchParams.set('returnCourse', returnCourse);
  }
  return u;
}
history.pushState = (state, unused, url) => {
  savedPush(state, unused, scopedUrl(url));
  window.dispatchEvent(new PopStateEvent('popstate'));
};
history.replaceState = (state, unused, url) => {
  savedReplace(state, unused, scopedUrl(url));
};
const router = {
  bfcacheId: crypto.randomUUID(),
  back: () => history.back(),
  forward: () => history.forward(),
  refresh: () => window.dispatchEvent(new PopStateEvent('popstate')),
  push: (url: string) => history.pushState(null, '', url),
  replace: (url: string) => {
    history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  prefetch: async () => {},
};
async function command(type: string, stageId: string, sourceDigest?: string) {
  const r = await fetch(base + '/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, stageId, ...(sourceDigest ? { sourceDigest } : {}) }),
  });
  const v = await r.json();
  if (!r.ok)
    throw Error(
      v.error?.code === 'CONFLICT'
        ? '课件或资产已变化，请重新预览后采用。'
        : v.error?.code === 'FORBIDDEN'
          ? '当前课程备课权限已变化。'
          : (v.error?.code ?? '操作未完成'),
    );
  return v;
}
function Adoption() {
  const stage = useStageStore((s) => s.stage);
  return <AdoptionControls key={stage?.id ?? 'empty'} />;
}
function AdoptionControls() {
  const stage = useStageStore((s) => s.stage),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      sourceDigest: string;
      scenes: unknown[];
      assets: unknown[];
    } | null>(null),
    [resource, setResource] = useState<string | null>(null);
  const run = async (adopt = false) => {
    if (!stage || busy) return;
    setBusy(true);
    try {
      await flushStageSave();
      if (hasPendingStageDocumentChanges(stage.id))
        throw Error('课件仍有未保存修改，请保留当前页面并重试保存后核对。');
      if (adopt) {
        if (!preview) throw Error('请先核对完整课件预览');
        const v = await command('ADOPT', stage.id, preview.sourceDigest);
        setResource(v.id);
        setNotice('已采用为课程草稿。请核对后显式发布；编辑源仍保留，后续采用会创建独立草稿。');
      } else {
        const v = await command('PREVIEW', stage.id);
        setPreview(v);
        setNotice(
          `已核对 ${v.scenes.length} 个场景、${v.assets.length} 份资产，完整保留，未发布。`,
        );
      }
    } catch (e) {
      if (adopt) setPreview(null);
      setNotice(e instanceof Error ? e.message : '操作未完成');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="native-adoption" aria-label="课程采用与发布">
      <a
        onClick={async (e) => {
          e.preventDefault();
          const href = e.currentTarget.href;
          try {
            await flushStageSave();
            if (stage && hasPendingStageDocumentChanges(stage.id))
              throw Error('尚有未保存修改，请保留当前页面重试。');
            location.assign(href);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : '保存未完成');
          }
        }}
        href={
          returnCourse
            ? `/zhiban/teacher/courses/${returnCourse}/resources?space=${tenant}&offering=${offering}`
            : `/zhiban?space=${tenant}`
        }
      >
        ← 返回课程
      </a>
      <strong>原生备课工作台</strong>
      <a
        href={`/zhiban/native-services?tenant=${tenant}&offering=${offering}`}
        onClick={async (e) => {
          e.preventDefault();
          const href = e.currentTarget.href;
          try {
            await flushStageSave();
            if (stage && hasPendingStageDocumentChanges(stage.id))
              throw Error('尚有未保存修改，请稍后重试。');
            location.assign(href);
          } catch (error) {
            setNotice((error as Error).message);
          }
        }}
      >
        资料与多模态服务
      </a>
      <a
        href={`/zhiban/native-archive?tenant=${tenant}&offering=${offering}${stage ? '&stage=' + encodeURIComponent(stage.id) : ''}`}
        onClick={async (e) => {
          e.preventDefault();
          const href = e.currentTarget.href;
          try {
            await flushStageSave();
            if (stage && hasPendingStageDocumentChanges(stage.id))
              throw Error('尚有未保存修改，请稍后重试。');
            location.assign(href);
          } catch (error) {
            setNotice((error as Error).message);
          }
        }}
      >
        课件归档与恢复
      </a>
      <span>编辑／生成不会自动发布</span>
      <button disabled={!stage || busy} onClick={() => run()}>
        核对完整课件
      </button>
      <button disabled={!stage || !preview || busy} onClick={() => run(true)}>
        采用为课程草稿
      </button>
      {resource && (
        <a
          href={`/zhiban/native-review?tenant=${tenant}&offering=${offering}&resource=${resource}`}
        >
          审核并发布草稿 →
        </a>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
function Root() {
  const [search, setSearch] = useState(new URLSearchParams(location.search)),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const f = () => setSearch(new URLSearchParams(location.search));
    addEventListener('popstate', f);
    fetch(base)
      .then((r) => {
        if (!r.ok) throw Error('当前课程不可备课，请确认登录及任教关系。');
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => removeEventListener('popstate', f);
  }, []);
  if (error)
    return (
      <p role="alert">
        {error} <a href={`/zhiban?space=${tenant}`}>返回工作台</a>
      </p>
    );
  if (!ready) return <p>正在核对课程备课权限…</p>;
  return (
    <AppRouterContext.Provider value={router}>
      <SearchParamsContext.Provider value={search}>
        <PathnameContext.Provider value="/workspace">
          <PathParamsContext.Provider value={{}}>
            <ThemeProvider>
              <I18nProvider initialLocale="zh-CN" initialResources={zh}>
                <ModelSettingsInit />
                <AgentRegistryInit />
                <Adoption />
                <WorkspaceShell />
                <Toaster />
              </I18nProvider>
            </ThemeProvider>
          </PathParamsContext.Provider>
        </PathnameContext.Provider>
      </SearchParamsContext.Provider>
    </AppRouterContext.Provider>
  );
}
createRoot(document.getElementById('native-workbench-root')!).render(<Root />);
