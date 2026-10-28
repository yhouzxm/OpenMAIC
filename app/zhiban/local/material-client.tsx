import { fileAccept, fileMime } from '../../../lib/zhiban/domain/learning/file-policy';
/** Course ownership/publishing adapter; extraction stays in official server providers. */
import React, { useState, useEffect, useRef } from 'react';
type Material = {
  id: string;
  title: string;
  name: string;
  mime: string;
  size: number;
  digest: string;
  revision: string | null;
  sourceRevision: string | null;
  publishedRevision: string | null;
  publicationNo: number;
  owned: boolean;
  status: string;
};
type Preview = {
  id: string;
  title: string;
  text: string;
  name: string;
  parser: string;
  publicationNo: number | null;
  digest: string;
};
async function request(path: string, command?: unknown, key?: string) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 110000);
  try {
    const headers: Record<string, string> = { 'x-zhiban-request': 'identity-v1' };
    if (command) {
      const csrf = await fetch('/api/zhiban/identity/csrf', {
        headers,
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!csrf.ok)
        throw Object.assign(Error('登录或安全令牌不可用'), {
          definitive: csrf.status >= 400 && csrf.status < 500,
        });
      headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
      headers['Content-Type'] = 'application/json';
      if (key) headers['x-zhiban-command'] = key;
    }
    const r = await fetch(path, {
      method: command ? 'POST' : 'GET',
      body: command ? JSON.stringify(command) : undefined,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const v = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          (
            {
              FORBIDDEN: '当前没有课程资源权限',
              NOT_FOUND: '资源不存在或未发布',
              CONFLICT: '资源已变化，请读取最新状态',
              INVALID_STATE: '请核对资源状态、发布条件或容量上限',
              INVALID_INPUT: '文件不支持、损坏或解析超限',
              UNAVAILABLE: '扫描／解析服务暂不可用，请稍后重试',
              SERVICE_UNAVAILABLE: '资源服务暂不可用',
            } as Record<string, string>
          )[v.error?.code] ?? '请求未完成',
        ),
        { definitive: r.status >= 400 && r.status < 500, status: r.status },
      );
    return v;
  } finally {
    clearTimeout(timer);
  }
}
async function downloadMaterial(path: string, name: string) {
  const r = await fetch(path, {
    headers: { 'x-zhiban-request': 'identity-v1' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error('下载被拒绝或会话已失效，请读取最新状态。');
  if (r.headers.get('content-type') !== 'application/octet-stream')
    throw Error('原文件响应格式不符');
  const blob = await r.blob();
  if (blob.size > 1048576) throw Error('原文件超过限制');
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function MaterialPreview({
  tenant,
  offering,
  id,
  version,
}: {
  tenant: string;
  offering: string;
  id: string;
  version?: number;
}) {
  const [value, setValue] = useState<Preview | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    request(
      `/api/zhiban/materials/${tenant}/offerings/${offering}/${id}${version ? '?version=' + version : ''}`,
    )
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [tenant, offering, id, version]);
  if (error) return <p role="alert">{error}</p>;
  if (!value) return <p role="status">正在读取已发布资源…</p>;
  return (
    <section aria-label="已发布教学资源">
      <h3>{value.title}</h3>
      <p>
        发布版本 {value.publicationNo} · {value.name}
      </p>
      <p>以下为解析文本，不保留原排版或图片；扫描件未识别出文字时请下载原件。</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {value.text || '未提取到可读文字；可下载原文件。'}
      </pre>
      <a
        className="button secondary"
        onClick={(e) => {
          e.preventDefault();
          void downloadMaterial(
            `/api/zhiban/materials/${tenant}/offerings/${offering}/${id}/download?version=${value.publicationNo}`,
            value.name,
          ).catch((e) => setError(e.message));
        }}
        href={`/api/zhiban/materials/${tenant}/offerings/${offering}/${id}/download?version=${value.publicationNo}`}
      >
        下载该发布版本原文件
      </a>
    </section>
  );
}
export function CourseMaterials({ tenant, offering }: { tenant: string; offering: string }) {
  const base = `/api/zhiban/materials/${tenant}/offerings/${offering}`;
  const active = useRef(true);
  const root = useRef<HTMLElement | null>(null);
  const flow = (
    window as Window & {
      zhibanCurriculum?: { flow(): { kind: string; returnUrl(id: string): string } | null };
    }
  ).zhibanCurriculum?.flow();
  const [lastId, setLastId] = useState<string | null>(null);
  const [list, setList] = useState<{
      rows: Material[];
      canUpload: boolean;
      upload?: {
        scannerReady: boolean;
        accept: string;
        formats: { mime: string; configured: boolean }[];
      };
    } | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [dead, setDead] = useState(false),
    [target, setTarget] = useState<Material | null>(null),
    [title, setTitle] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [inputKey, setInputKey] = useState(0),
    [preview, setPreview] = useState<Preview | null>(null),
    [pending, setPending] = useState<{ command: unknown; key: string } | null>(null);
  const dirty = !!file || title !== (target?.title ?? '');
  useEffect(() => {
    const host = (
      window as Window & {
        zhibanCoursePage?: { setDirty(k: string, d: boolean, root?: HTMLElement | null): void };
      }
    ).zhibanCoursePage;
    host?.setDirty('materials', dirty || !!pending || busy, root.current);
    return () => host?.setDirty('materials', false);
  }, [dirty, pending, busy]);
  useEffect(() => {
    let live = true;
    active.current = true;
    request(base)
      .then((v) => {
        if (live) {
          setList(v);
          const target = /^#material-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
          if (target) {
            const row = v.rows.find((r: Material) => r.id === target);
            if (row)
              void request(
                `${base}/${target}${row.status !== 'PUBLISHED' && row.owned ? '?source=draft' : ''}`,
              )
                .then((value) => {
                  if (active.current) setPreview(value);
                })
                .catch((e) => {
                  if (active.current) setNotice(e.message);
                });
            else setNotice('此资源不属于当前可访问的课程资源。');
          }
        }
      })
      .catch((e) => {
        if (live) setNotice(e.message);
      });
    const channel = new BroadcastChannel('zhiban-session');
    channel.onmessage = () => {
      live = false;
      active.current = false;
      setDead(true);
      setList(null);
      setPreview(null);
      setFile(null);
      setPending(null);
    };
    return () => {
      live = false;
      active.current = false;
      channel.close();
    };
  }, [base]);
  const clearRejected = (e: unknown) => {
    if ([401, 403].includes((e as { status?: number }).status ?? 0)) {
      active.current = false;
      setDead(true);
      setList(null);
      setPreview(null);
      setFile(null);
      setPending(null);
      setTitle('');
    }
  };
  const refresh = async () => {
    try {
      const v = await request(base);
      if (active.current) setList(v);
    } catch (e) {
      clearRejected(e);
      setNotice((e as Error).message);
    }
  };
  const execute = async (command: unknown, retry = false) => {
    if (busy || dead || (pending && !retry)) return;
    const work = retry ? pending! : { command, key: crypto.randomUUID() };
    setPending(work);
    setBusy(true);
    setNotice('正在扫描、解析或确认操作…');
    try {
      const result = await request(base, work.command, work.key);
      if (active.current) setLastId(result.id);
      if (!active.current) return;
      setPending(null);
      setFile(null);
      setTitle('');
      setTarget(null);
      setInputKey((k) => k + 1);
      await refresh();
      setNotice('资源操作已确认；目录编排仍需独立保存和发布。');
    } catch (e) {
      if (!active.current) return;
      clearRejected(e);
      const error = e as Error & { definitive?: boolean };
      if (error.definitive) setPending(null);
      setNotice(
        error.message + (error.definitive ? '；输入已保留。' : '；结果未知，请按原命令重试。'),
      );
    } finally {
      setBusy(false);
    }
  };
  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy || pending) return;
    const mime = fileMime(file.name, file.type);
    if (!mime || !list?.upload?.formats.some((f) => f.mime === mime && f.configured)) {
      setNotice('此格式尚未配置解析服务，请使用TXT／Markdown／CSV／文本PDF。');
      return;
    }
    if (!list.upload.scannerReady) {
      setNotice('扫描器暂不可用，未上传文件。');
      return;
    }
    if (file.size < 1 || file.size > 1048576) {
      setNotice('文件须为1字节至1MiB。');
      return;
    }
    setBusy(true);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      let raw = '';
      for (let i = 0; i < data.length; i += 8192)
        raw += String.fromCharCode(...data.subarray(i, i + 8192));
      setBusy(false);
      await execute({
        type: 'UPLOAD_MATERIAL',
        id: target?.id ?? null,
        revision: target?.revision ?? null,
        title,
        file: { name: file.name, mime: file.type || 'application/octet-stream', base64: btoa(raw) },
      });
    } catch {
      setBusy(false);
      setNotice('读取文件失败，输入保留。');
    }
  };
  const show = async (r: Material, draft: boolean) => {
    try {
      const value = await request(`${base}/${r.id}${draft ? '?source=draft' : ''}`);
      if (active.current) setPreview(value);
    } catch (e) {
      clearRejected(e);
      setNotice((e as Error).message);
    }
  };
  if (dead) return <p>会话已变化，请返回工作台重新登录。</p>;
  return (
    <section ref={root} className="content-card" aria-label="课程上传资源">
      <h2>上传与发布教学资源</h2>
      <p>
        每文件≤1MiB。TXT／Markdown／CSV及文本PDF可直接解析；Office／图片OCR／音视频需配置相应解析服务。只展示提取正文并提供原件下载，阅读不计完成率或成绩。
      </p>
      {list?.upload && (
        <p role="status">
          {list.upload.scannerReady ? '可信扫描已配置。' : '扫描器不可用，新上传暂时关闭。'}{' '}
          Office／OCR／音视频未配置解析服务时拒绝上传；已有发布资源仍可查看下载。
        </p>
      )}
      {flow?.kind === 'MATERIAL' && lastId && !dirty && !pending && !busy && (
        <a className="button secondary" href={flow.returnUrl(lastId)}>
          返回原章节并加入资源
        </a>
      )}
      <p role="status">{notice}</p>
      <button disabled={busy || !!pending} onClick={() => void refresh()}>
        读取最新上传资源
      </button>
      {pending && (
        <button disabled={busy} onClick={() => void execute(pending.command, true)}>
          按原资源命令重试
        </button>
      )}
      {list?.canUpload && (
        <form onSubmit={upload}>
          <h3>{target ? '替换资源草稿文件' : '新增课程资源'}</h3>
          <label>
            资源标题
            <input
              aria-label="上传资源标题"
              required
              maxLength={120}
              value={title}
              disabled={busy || !!pending}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            选择教学资源文件
            <input
              key={inputKey}
              aria-label="选择教学资源文件"
              type="file"
              accept={list?.upload?.accept ?? fileAccept}
              required
              disabled={busy || !!pending}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={busy || !!pending}>
            扫描并解析为资源草稿
          </button>
          {(target || dirty) && (
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() => {
                if (dirty && !confirm('放弃未保存的资源文件及标题？')) return;
                setTarget(null);
                setTitle('');
                setFile(null);
                setInputKey((k) => k + 1);
              }}
            >
              取消资源编辑
            </button>
          )}
        </form>
      )}
      {!list && !notice && <p>正在读取课程上传资源…</p>}
      {list?.rows.length === 0 && <p>暂无可查看的上传资源。</p>}
      <div aria-label="课程上传资源列表">
        {list?.rows.map((r) => (
          <article key={r.id} id={'material-' + r.id} className="content-card">
            <h3>{r.title}</h3>
            <p>
              {r.name} · {r.size}字节 · {r.status} · 已发布 {r.publicationNo} 次
            </p>
            {r.owned && (
              <p>
                草稿来源版本 {r.sourceRevision}；发布来源版本 {r.publishedRevision ?? '无'}
                。替换草稿不会改变已发布文件。
              </p>
            )}
            {r.owned && (
              <button disabled={busy || !!pending} onClick={() => void show(r, true)}>
                查看解析草稿 {r.title}
              </button>
            )}
            {r.status === 'PUBLISHED' && (
              <button disabled={busy || !!pending} onClick={() => void show(r, false)}>
                查看已发布资源 {r.title}
              </button>
            )}
            {r.owned && list.canUpload && r.status !== 'ARCHIVED' && (
              <>
                <button
                  disabled={busy || !!pending}
                  onClick={() => {
                    if (dirty && !confirm('放弃当前资源输入并替换此资源？')) return;
                    setTarget(r);
                    setTitle(r.title);
                    setFile(null);
                    setInputKey((k) => k + 1);
                  }}
                >
                  替换草稿 {r.title}
                </button>
                <button
                  disabled={busy || !!pending || r.sourceRevision === r.publishedRevision}
                  onClick={() => {
                    if (confirm('发布当前解析结果及原文件？学生将读取此固定版本。'))
                      void execute({ type: 'PUBLISH_MATERIAL', id: r.id, revision: r.revision });
                  }}
                >
                  发布资源 {r.title}
                </button>
                <button
                  disabled={busy || !!pending}
                  onClick={() => {
                    if (confirm('归档后学生不能再读取该资源，目录引用也将停止展示。确认归档？'))
                      void execute({ type: 'ARCHIVE_MATERIAL', id: r.id, revision: r.revision });
                  }}
                >
                  归档资源 {r.title}
                </button>
              </>
            )}
          </article>
        ))}
      </div>
      {preview && (
        <section aria-label="资源解析预览">
          <h3>{preview.title}</h3>
          <p>
            {preview.parser} ·{' '}
            {preview.publicationNo ? '发布版本 ' + preview.publicationNo : '教师草稿'}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {preview.text || '未提取到可读文字，请下载原件核对；请核对解析服务及扫描件文字质量。'}
          </pre>
          <a
            className="button secondary"
            onClick={(e) => {
              e.preventDefault();
              void downloadMaterial(
                `${base}/${preview.id}/download${preview.publicationNo ? '?version=' + preview.publicationNo : '?source=draft'}`,
                preview.name,
              ).catch((e) => setNotice(e.message));
            }}
            href={`${base}/${preview.id}/download${preview.publicationNo ? '?version=' + preview.publicationNo : '?source=draft'}`}
          >
            下载当前预览原文件
          </a>
        </section>
      )}
    </section>
  );
}
