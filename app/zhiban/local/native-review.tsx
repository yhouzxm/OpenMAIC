import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering'),
  resource = q.get('resource');
const base = `/api/zhiban/authoring/${tenant}/offerings/${offering}`,
  content = `/api/zhiban/content/${tenant}/offerings/${offering}`;
async function call(url: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { 'x-zhiban-request': 'identity-v1' };
  if (body) {
    const c = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
    if (!c.ok) throw Error('请重新登录');
    headers['x-zhiban-csrf'] = (await c.json()).csrfToken;
    headers['Content-Type'] = 'application/json';
    headers['x-zhiban-command'] = key!;
  }
  const r = await fetch(url, {
    cache: 'no-store',
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error?.code ?? '操作未完成');
  return v;
}
type DraftInfo = {
  title: string;
  revision: string;
  sourceDigest: string;
  scenes: { type: string; title: string }[];
  assets: { ref: string; mime: string; size: number; digest: string }[];
  stageId: string | null;
};
type Entry = {
  id: string;
  state: string;
  quarantined: boolean;
  publication?: { id: string } | null;
};
function App() {
  const [data, setData] = useState<DraftInfo | null>(null),
    [entry, setEntry] = useState<Entry | null>(null),
    [notice, setNotice] = useState('正在读取课程草稿…'),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const d = await call(base + '/draft/' + resource),
      list = await call(content);
    setData(d);
    setEntry(list.resources.find((r: Entry) => r.id === resource));
  };
  useEffect(() => {
    void load()
      .then(() => setNotice('请核对完整场景与资产后显式发布。'))
      .catch((e) => setNotice(e.message));
  }, []);
  const publish = async (type: string) => {
    if (busy || !data || entry?.quarantined) return;
    setBusy(true);
    try {
      await call(
        base + '/review',
        { type, id: resource, revision: data.revision },
        crypto.randomUUID().replaceAll('-', ''),
      );
      await load();
      setNotice(
        type === 'PUBLISH_CONTENT' ? '发布结果已返回，请核对下方当前状态。' : '撤回结果已返回。',
      );
    } catch (e) {
      setNotice((e as Error).message + ' 结果不明时请读取最新状态，不自动重放。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="course-panel">
      <h1>完整原生课件审核与发布</h1>
      <p role="status">{notice}</p>
      <p>
        <a href={`/zhiban/content?tenant=${tenant}&offering=${offering}`}>返回课程内容</a>
      </p>
      {data && (
        <>
          <h2>{data.title}</h2>
          <p>
            草稿版本 {data.revision} · {data.scenes.length} 个场景 · {data.assets.length} 份资产
          </p>
          <p>
            当前状态：{entry?.state}
            {entry?.quarantined ? ' · 结果待核验，已隔离' : ''}
          </p>
          <p>
            <a
              className="button secondary"
              href={`/zhiban/native-published?tenant=${tenant}&offering=${offering}&resource=${resource}&source=draft&revision=${data.revision}`}
            >
              预览待发布固定草稿 →
            </a>
          </p>
          <ol>
            {data.scenes.map((s, i) => (
              <li key={i}>
                {s.type} · {s.title}
              </li>
            ))}
          </ol>
          <details>
            <summary>资产与来源</summary>
            <p>SHA256 {data.sourceDigest}</p>
            <ul>
              {data.assets.map((a) => (
                <li key={a.ref}>
                  {a.mime} · {a.size} bytes · {a.digest}
                </li>
              ))}
            </ul>
          </details>
          <p>
            {data.stageId && (
              <a
                className="button secondary"
                href={`/zhiban/native-workbench?tenant=${tenant}&offering=${offering}&course=${encodeURIComponent(data.stageId)}`}
              >
                继续编辑原生源课件
              </a>
            )}
          </p>
          <button
            className="button primary"
            disabled={busy || entry?.quarantined}
            onClick={() => publish('PUBLISH_CONTENT')}
          >
            发布当前课程草稿
          </button>{' '}
          <button
            className="button secondary"
            disabled={busy || entry?.state !== 'PUBLISHED' || entry?.quarantined}
            onClick={() => publish('WITHDRAW_CONTENT')}
          >
            撤回当前发布
          </button>{' '}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => load().catch((e) => setNotice(e.message))}
          >
            读取最新状态
          </button>
          {entry?.state === 'PUBLISHED' && entry.publication && (
            <p>
              <a
                href={`/zhiban/native-published?tenant=${tenant}&offering=${offering}&resource=${resource}&publication=${entry.publication.id}`}
              >
                打开固定发布版本 →
              </a>
            </p>
          )}
          <p>
            编辑原生源不会改变已发布内容。修订请重新采用为独立课程草稿；播放、自测与PBL展示不自动计入正式成绩。
          </p>
        </>
      )}
    </section>
  );
}
createRoot(document.getElementById('native-review-root')!).render(<App />);
