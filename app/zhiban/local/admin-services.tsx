import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { Toaster } from '@/components/ui/sonner';
import zh from '@/lib/i18n/locales/zh-CN.json';
import { ServerSettingsGate } from '@/components/settings/server-settings';
import { ModelServicesPanel, type ServiceTab } from '@/components/settings/model-services';
import { CourseModelMap } from '@/components/settings/models';
import { UsageDashboard } from '@/components/settings/usage-dashboard';
import { createModelSettingsClient } from '@/lib/model-settings/client';
import type { ModelSettingsView } from '@/lib/server/model-config/settings';
const tenant = new URLSearchParams(location.search).get('tenant');
if (!/^[a-f0-9-]{36}$/.test(tenant ?? '')) throw Error('请选择管理空间');
const base = `/api/zhiban/service-center/${tenant}`,
  rawFetch = window.fetch.bind(window);
let token: Promise<string> | undefined,
  revision: number | null = null;
const pendingCommands = new Map<string, string>();
async function wire(path: string, init: RequestInit = {}) {
  const h = new Headers(init.headers);
  h.set('x-zhiban-request', 'identity-v1');
  if (!['GET', 'HEAD'].includes(init.method ?? 'GET')) {
    token ??= rawFetch('/api/zhiban/identity/csrf', {
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
    h.set('x-zhiban-csrf', await token!);
    h.set('Content-Type', 'application/json');
    const key = path + ':' + init.body;
    if (!pendingCommands.has(key)) {
      if (pendingCommands.size >= 40) pendingCommands.delete(pendingCommands.keys().next().value!);
      pendingCommands.set(key, crypto.randomUUID());
    }
    h.set('x-zhiban-command', pendingCommands.get(key)!);
  }
  return rawFetch(base + path, { ...init, headers: h, cache: 'no-store' });
}
const client = createModelSettingsClient(async (_url, init = {}) => {
  const r = await wire('/config', init);
  if (r.ok) {
    const data = (await r.clone().json()) as ModelSettingsView;
    revision = data.revision;
  }
  return r;
});
// Native settings panels retain their saved-provider transport. No arbitrary proxy or browser key forwarding.
window.fetch = async (input, init = {}) => {
  const path =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : new URL(input.url).pathname;
  if (path === '/api/model-config') return wire('/config', init);
  const kind: Record<string, string> = {
    '/api/verify-model': 'llm',
    '/api/verify-image-provider': 'image',
    '/api/verify-video-provider': 'video',
    '/api/verify-pdf-provider': 'document',
    '/api/provider/probe-models': 'catalogue',
  };
  if (kind[path]) {
    const data = JSON.parse(String(init.body ?? '{}'));
    if (Object.keys(data).some((k) => !['provider', 'model'].includes(k)))
      return new Response(JSON.stringify({ success: false, error: '只允许检查已保存的服务' }), {
        status: 400,
      });
    const r = await wire('/check', {
      method: 'POST',
      body: JSON.stringify({
        kind: kind[path],
        provider: data.provider,
        model: data.model,
        revision,
      }),
    });
    const result = await r.json();
    return new Response(
      JSON.stringify({
        success: r.ok && result.state === 'PASS',
        ...(result.models ? { models: result.models } : {}),
        message: result.state === 'PASS' ? '连接检查通过' : '连接检查未通过；请核对配置和变更记录',
        error: result.state === 'PASS' ? undefined : '连接检查未完成',
      }),
      {
        status: r.ok && result.state === 'PASS' ? 200 : r.status === 200 ? 503 : r.status,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
  if (path.startsWith('/api/'))
    return new Response(JSON.stringify({ success: false, error: '请在教师页面使用此服务' }), {
      status: 501,
      headers: { 'content-type': 'application/json' },
    });
  return rawFetch(input, init);
};
type EventRow = {
  id: string;
  actor_id: string;
  event_kind: string;
  revision: number | null;
  summary: Record<string, unknown>;
  created_at: string;
};
const names: Record<string, string> = {
  llm: '语言模型',
  image: '图像生成',
  video: '视频生成',
  tts: '语音合成',
  asr: '语音识别',
  document: '文档解析',
};
function Center() {
  const [section, setSection] = useState('status'),
    [tab, setTab] = useState<ServiceTab>('providers'),
    [view, setView] = useState<ModelSettingsView | null>(null),
    [notice, setNotice] = useState('正在核对管理员权限…'),
    [events, setEvents] = useState<EventRow[]>([]),
    [next, setNext] = useState<string | null>(null),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [probeKind, setProbeKind] = useState('llm'),
    [probeProvider, setProbeProvider] = useState(''),
    [probeModel, setProbeModel] = useState(''),
    [checking, setChecking] = useState(false);
  const reload = useCallback(async () => {
    const state = await client.load({ fresh: true });
    setView(state.view);
    if (state.view) setNotice('当前空间配置；部署级配置和锁定项保持只读。');
    else setNotice(state.phase === 'error' ? (state.error ?? '无访问权限') : '服务中心不可用');
  }, []);
  useEffect(() => {
    void Promise.resolve().then(reload);
    return client.subscribe(() => setView(client.getState().view));
  }, [reload]);
  async function history(cursor?: string) {
    const r = await wire('/events' + (cursor ? '?cursor=' + cursor : ''));
    if (!r.ok) {
      setNotice('读取记录失败，权限可能已变化');
      return;
    }
    const d = await r.json();
    setEvents(d.items);
    setNext(d.next);
  }
  useEffect(() => {
    if (section === 'history') void Promise.resolve().then(() => history());
  }, [section]);
  async function check() {
    setChecking(true);
    try {
      const r = await wire('/check', {
        method: 'POST',
        body: JSON.stringify({
          kind: probeKind,
          provider: probeProvider,
          ...(probeModel ? { model: probeModel } : {}),
          revision,
        }),
      });
      const d = await r.json();
      setNotice(
        r.ok
          ? '连接检查：' +
              ({
                PASS: '通过',
                FAILED: '失败，请核对服务配置',
                UNKNOWN: '结果不确定，请查证原请求',
                RUNNING_OR_UNKNOWN: '原检查仍在运行或待查证',
              }[d.state as string] ?? d.state)
          : (d.error?.message ?? '检查未完成'),
      );
    } catch {
      setNotice('检查结果未收到。原请求标识已保留，重试先查证原记录。');
    } finally {
      setChecking(false);
    }
  }
  const usage = useCallback(() => wire('/usage?month=' + month), [month]);
  return (
    <>
      <header className="service-top">
        <strong>智伴·创学管理后台</strong>
        <a href={`/zhiban/management?tenant=${tenant}`}>返回教务管理</a>
      </header>
      <main className="service-main">
        <h1>服务与运行中心</h1>
        <p className="service-notice" role="status">
          {notice}
        </p>
        <nav className="service-tabs" aria-label="服务中心导航">
          {Object.entries({
            status: '服务状态',
            providers: '服务配置',
            models: '教学模型分配',
            usage: 'AI 用量',
            history: '变更记录',
          }).map(([id, title]) => (
            <button key={id} aria-pressed={id === section} onClick={() => setSection(id)}>
              {title}
            </button>
          ))}
        </nav>
        <div className="service-panel">
          {view && (
            <div className="service-note">
              设置仅作用于当前空间的原生备课、课堂与多模态宿主。已有个人选择保留；部署锁定优先。保存后请检查连接。密钥仅写入服务端。语言模型连接检查会发送一条短测试请求，可能产生少量用量。
            </div>
          )}
          {!view ? (
            <button onClick={() => void reload()}>重新核对</button>
          ) : (
            <>
              {section === 'status' && (
                <>
                  <h2>配置状态</h2>
                  <p>
                    配置版本：{view.revision ?? '尚未保存空间设置'}
                    。此处只检查配置，未自动访问服务商。
                  </p>
                  <div className="service-status">
                    {Object.entries(names).map(([id, name]) => {
                      const slot = view.slots.find((s) => s.slot === id);
                      const state = slot?.effective.status;
                      return (
                        <article className="service-card" key={id}>
                          <h3>{name}</h3>
                          <p>
                            {state === 'assigned'
                              ? '已配置 · 待检查'
                              : state === 'disabled'
                                ? '已关闭'
                                : '未配置或配置无效'}
                          </p>
                          <p>{slot?.locked ? '主机锁定' : '可按原生策略配置'}</p>
                          <button
                            onClick={() => {
                              setTab(
                                id === 'llm'
                                  ? 'providers'
                                  : id === 'document'
                                    ? 'pdf'
                                    : (id as ServiceTab),
                              );
                              setSection('providers');
                            }}
                          >
                            查看配置
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  <h2>连接检查</h2>
                  <p>
                    只检查已保存的提供者。语言模型发送短请求；TTS 合成固定短句；ASR
                    发送一秒静音样本，可能产生少量用量。通过只证明该次连接，实际效果以生成或识别结果为准。
                  </p>
                  <div className="service-tabs">
                    <label>
                      服务类型{' '}
                      <select
                        aria-label="检查服务类型"
                        value={probeKind}
                        onChange={(e) => {
                          setProbeKind(e.target.value);
                          setProbeProvider('');
                          setProbeModel('');
                        }}
                      >
                        {Object.entries(names).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      已保存提供者{' '}
                      <select
                        aria-label="检查提供者"
                        value={probeProvider}
                        onChange={(e) => {
                          setProbeProvider(e.target.value);
                          setProbeModel('');
                        }}
                      >
                        <option value="">请选择</option>
                        {view.providers
                          .filter(
                            (p) =>
                              p.capabilities[
                                (probeKind === 'llm'
                                  ? 'chat'
                                  : probeKind) as keyof typeof p.capabilities
                              ],
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.presetName} · {p.id}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      模型{' '}
                      <input
                        aria-label="检查模型"
                        placeholder="语言模型必填；其他可留空"
                        value={probeModel}
                        onChange={(e) => setProbeModel(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={checking || !probeProvider || (probeKind === 'llm' && !probeModel)}
                      onClick={() => void check()}
                    >
                      {checking ? '检查中…' : '检查已保存服务'}
                    </button>
                  </div>
                  <p>
                    私有网络和需密钥对的服务由主机配置；完整音频试听／录音识别请在教师多模态页面使用。
                  </p>
                </>
              )}
              {(section === 'providers' || section === 'models') && (
                <ServerSettingsGate client={client}>
                  {(v, apply) =>
                    section === 'providers' ? (
                      <ModelServicesPanel view={v} apply={apply} tab={tab} onTabChange={setTab} />
                    ) : (
                      <CourseModelMap
                        view={v}
                        apply={apply}
                        onManageProviders={() => setSection('providers')}
                      />
                    )
                  }
                </ServerSettingsGate>
              )}
              {section === 'usage' && (
                <>
                  <h2>本空间 AI 用量</h2>
                  <label>
                    月份{' '}
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                  </label>
                  <p>
                    只统计带可信空间归属的记录；历史未归属记录及其他空间记录不展示。次数与消耗量不等于费用或正式学习结果。
                  </p>
                  <UsageDashboard key={month} fetchUsage={usage} />
                </>
              )}
              {section === 'history' && (
                <>
                  <h2>配置与连接检查记录</h2>
                  <button onClick={() => void history()}>刷新最新记录</button>
                  <div className="service-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>操作</th>
                          <th>操作者（成员标识）</th>
                          <th>版本</th>
                          <th>内容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((e) => (
                          <tr key={e.id}>
                            <td>{new Date(e.created_at).toLocaleString('zh-CN')}</td>
                            <td>
                              {e.event_kind === 'CONFIG_CHANGED'
                                ? '配置变更'
                                : e.event_kind === 'CHECK_FINISHED'
                                  ? '连接检查结果'
                                  : '检查中／结果待查证'}
                            </td>
                            <td>{e.actor_id}</td>
                            <td>{e.revision ?? '部署默认'}</td>
                            <td>
                              <pre>{JSON.stringify(e.summary, null, 2)}</pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!events.length && <p>当前空间暂无记录。</p>}
                  {next && <button onClick={() => void history(next)}>更早记录</button>}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById('admin-services-root')!).render(
  <ThemeProvider>
    <I18nProvider initialLocale="zh-CN" initialResources={zh}>
      <Center />
      <Toaster />
    </I18nProvider>
  </ThemeProvider>,
);
