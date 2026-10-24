/** Course authoring adapter; execution is the existing OpenMAIC interactive iframe, never this editor. */
import React, { useEffect, useState, useCallback } from 'react';
import { publishedPlayerHref } from './published-player-link';
type Resource = {
  id: string;
  title: string;
  revision?: string;
  state: string;
  quarantined: boolean;
  teacher: boolean;
  interactive: boolean;
  runtimeHistory?: boolean;
  draft?: { html: string };
  publication?: { id: string; publication_no: number };
};
export const interactiveExample = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font:24px sans-serif;padding:40px;color:#172554}input{width:70%}output{font-weight:bold;color:#4338ca}</style></head><body><h1>欧姆定律：调节电压</h1><p>电阻固定为 6Ω，拖动滑块观察电流。</p><label>电压 U：<input id="voltage" aria-label="电压" type="range" min="0" max="24" value="12"></label><p id="result">电流 I = 2 A</p><p>这是交互演示，不记录作答或成绩。</p><script>const input=document.getElementById('voltage');const result=document.getElementById('result');input.addEventListener('input',()=>{result.textContent='电流 I = '+(Number(input.value)/6).toFixed(2)+' A'});</script></body></html>`;
export function InteractiveContentPanel() {
  const shell = (
    window as Window & {
      zhibanCoursePage?: {
        query: string;
        setDirty(key: string, dirty: boolean, root?: HTMLElement | null): void;
      };
    }
  ).zhibanCoursePage;
  const q = new URLSearchParams(shell?.query ?? location.search),
    tenant = q.get('tenant')!,
    offering = q.get('offering')!;
  const base = `/api/zhiban/content/${tenant}/offerings/${offering}`;
  const [resources, setResources] = useState<Resource[]>([]),
    [canEdit, setCanEdit] = useState(false),
    [enabled, setEnabled] = useState(false),
    [current, setCurrent] = useState<Resource | null>(null),
    [title, setTitle] = useState(''),
    [html, setHtml] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const request = useCallback(
    async (cmd?: unknown) => {
      const headers: Record<string, string> = { 'x-zhiban-request': 'identity-v1' };
      if (cmd) {
        const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
        if (!r.ok) throw Error('请返回工作台登录。');
        headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
        headers['Content-Type'] = 'application/json';
        headers['x-zhiban-command'] = crypto.randomUUID().replaceAll('-', '');
      }
      const r = await fetch(base, {
        headers,
        cache: 'no-store',
        method: cmd ? 'POST' : 'GET',
        body: cmd ? JSON.stringify(cmd) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          data.error?.code === 'OUTCOME_UNKNOWN'
            ? '发布结果待核验；请勿重复发布，当前内容保持隔离。'
            : data.error?.code === 'CONFLICT'
              ? '版本已变化，请保留输入并重新读取比较。'
              : '当前操作不可用，请检查课程权限、HTML限制或发布状态。',
        );
      return data;
    },
    [base],
  );
  const refresh = useCallback(async () => {
    const data = await request();
    setResources(data.resources.filter((r: Resource) => r.interactive));
    setCanEdit(data.canEdit);
    setEnabled(data.interactiveEnabled);
    return data.resources as Resource[];
  }, [request]);
  const open = (r: Resource) => {
    if (dirty && !confirm('放弃未保存的互动 HTML 修改？')) return;
    setCurrent(r);
    setTitle(r.title);
    setHtml(r.draft?.html ?? '');
    setDirty(false);
  };
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
  useEffect(() => {
    void refresh().catch((e) => setNotice(e.message));
  }, [refresh]);
  useEffect(() => {
    shell?.setDirty('interactive', dirty, document.getElementById('interactive-content'));
    return () => shell?.setDirty('interactive', false);
  }, [dirty, shell]);
  const selectFresh = async (id: string) => {
    const rows = await refresh();
    const r = rows.find((r) => r.id === id);
    if (!r) {
      setCurrent(null);
      setHtml('');
      throw Error('当前互动内容已不可访问。');
    }
    setCurrent(r);
    setTitle(r.title);
    setHtml(r.draft?.html ?? '');
    setDirty(false);
  };
  if (!enabled) return null;
  return (
    <section id="interactive-content" aria-label="互动内容" className="content-card">
      <h2>离线 HTML 互动</h2>
      <p>
        自包含 HTML，最多 64 KiB。支持内联样式及 addEventListener
        脚本；不支持外链、属性事件、图片、音视频、嵌套
        iframe、表单和弹窗。代码只在隔离的原生互动宿主执行；不计完成或成绩。
      </p>
      <p role="status">{notice}</p>
      <button
        disabled={busy || dirty}
        onClick={() =>
          void act(async () => {
            await refresh();
          })
        }
      >
        读取互动内容
      </button>
      {canEdit && (
        <button
          disabled={busy || dirty}
          onClick={() =>
            void act(async () => {
              const r = await request({
                type: 'CREATE_INTERACTIVE',
                title: '新互动演示',
                html: interactiveExample,
              });
              await selectFresh(r.id);
              setNotice('已创建互动草稿；请编辑、保存并显式发布。');
            })
          }
        >
          新建互动草稿
        </button>
      )}
      {resources.map((r) => (
        <article key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {r.state === 'PUBLISHED' ? '已发布' : r.state === 'WITHDRAWN' ? '已撤回' : '草稿'}{' '}
            {r.publication && `· 发布版本 ${r.publication.publication_no}`}{' '}
            {r.quarantined && '· 结果待核验，保持隔离'}
          </p>
          {r.teacher && (
            <button disabled={busy || r.quarantined} onClick={() => open(r)}>
              编辑互动草稿
            </button>
          )}
          {r.state === 'PUBLISHED' && !r.quarantined && r.publication && (
            <a href={publishedPlayerHref(tenant, offering, r.id, r.publication.id)}>
              打开已发布互动
            </a>
          )}
          {r.runtimeHistory && <a href={`${base}/resources/${r.id}/records`}>查看作答关联记录</a>}
        </article>
      ))}
      {current?.teacher && (
        <fieldset disabled={busy || current.quarantined}>
          <legend>互动草稿编辑</legend>
          <label>
            互动标题
            <input
              aria-label="互动标题"
              value={title}
              maxLength={120}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            互动 HTML
            <textarea
              aria-label="互动 HTML"
              rows={16}
              value={html}
              onChange={(e) => {
                setHtml(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <p>{dirty ? '互动草稿未保存' : '互动草稿已保存'}</p>
          <button
            onClick={() =>
              void act(async () => {
                await request({
                  type: 'SAVE_INTERACTIVE',
                  id: current.id,
                  revision: current.revision,
                  title,
                  html,
                });
                await selectFresh(current.id);
                setNotice('互动草稿已保存；旧发布版本保持原样。');
              })
            }
          >
            保存互动草稿
          </button>
          <button
            disabled={dirty}
            onClick={() =>
              void act(async () => {
                await request({
                  type: 'PUBLISH_CONTENT',
                  id: current.id,
                  revision: current.revision,
                });
                await selectFresh(current.id);
                setNotice('互动版本已发布，可在课程目录编排并由学生打开。');
              })
            }
          >
            发布互动版本
          </button>
          {current.state === 'PUBLISHED' && (
            <button
              disabled={dirty}
              onClick={() =>
                void act(async () => {
                  await request({
                    type: 'WITHDRAW_CONTENT',
                    id: current.id,
                    revision: current.revision,
                  });
                  await selectFresh(current.id);
                  setNotice('互动发布已撤回。');
                })
              }
            >
              撤回互动发布
            </button>
          )}
        </fieldset>
      )}
    </section>
  );
}
