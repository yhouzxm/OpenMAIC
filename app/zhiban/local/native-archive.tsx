/** Stable native exporters over one fixed course archive; no native editor/global learner store writes. */
import React, { useState, useEffect } from 'react';
import { CourseVideo } from './course-video';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { v7 } from 'uuid';
import type { AppDocument } from '@/lib/document-store/persistence-types';
import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';
import type { ClassroomExportSnapshot } from '@/lib/export/use-export-classroom';
import { mapDesignRefs } from '@/lib/zhiban/infrastructure/authoring/archive/design';
import { buildPptxBlob } from '@/lib/export/pptx-builder';
import { buildResourcePackZip } from '@/lib/export/use-export-pptx';
import { planPptxDeck } from '@/lib/export/pptx-scene-placeholders';
import { resolveVideoMediaForElement } from '@/lib/media/media-task-resolution';
import { buildStandaloneHtmlExport } from '@/lib/export/standalone-html/build-standalone-html';
import { collectSceneScripts, buildMarkdown, buildDocxBlob } from '@/lib/export/use-export-script';
import zh from '@/lib/i18n/locales/zh-CN.json';
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering');
if (![tenant, offering].every((v) => /^[a-f0-9-]{36}$/.test(v ?? '')))
  throw Error('Invalid course context');
const base = `/api/zhiban/authoring/${tenant}/offerings/${offering}`,
  source = new URLSearchParams();
if (q.has('stage')) source.set('stage', q.get('stage')!);
else if (q.has('resource') && q.has('publication')) {
  source.set('resource', q.get('resource')!);
  source.set('publication', q.get('publication')!);
}
const course = `/zhiban/content?tenant=${tenant}&offering=${offering}`;
let csrf: Promise<string> | undefined;
async function api(path: string, init: RequestInit = {}) {
  const h = new Headers(init.headers);
  h.set('x-zhiban-request', 'identity-v1');
  if (init.method === 'POST') {
    csrf ??= fetch('/api/zhiban/identity/csrf', {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw Error('请重新登录后继续');
        return (await r.json()).csrfToken as string;
      })
      .catch((e) => {
        csrf = undefined;
        throw e;
      });
    h.set('x-zhiban-csrf', await csrf);
  }
  const r = await fetch(base + path, { ...init, headers: h, cache: 'no-store' });
  if (!r.ok) {
    let code = '';
    try {
      code = (await r.json()).error?.code ?? '';
    } catch {}
    throw Error(
      (
        {
          ARCHIVE_NOT_CLEARED: '可信扫描未通过或繁忙，请保留文件稍后重试。',
          ARCHIVE_SCANNER_REQUIRED: '尚未配置可信归档扫描器。',
          ARCHIVE_MISSING_ASSET: '归档缺少引用资产，请完整重新导出。',
          ARCHIVE_CHANGED: '文件已变化，请重新核对。',
          ARCHIVE_TOO_LARGE: '文件超过受控归档限额。',
          INVALID_ARCHIVE: '归档结构、路径或格式无效。',
          FORBIDDEN: '当前任教资格已变化，请返回课程。',
          RENDER_UNAVAILABLE: '渲染服务未连接或不兼容，请检查服务后重试。',
          RENDER_BUSY: '渲染队列繁忙，请稍后重试。',
          RENDER_FAILED: '视频渲染失败，请检查服务诊断或下载工程。',
          VIDEO_EXPIRED: '任务已过期或渲染服务已重启，请重新生成。',
          VIDEO_NOT_READY: '视频尚未完成，请稍后查看进度。',
        } as Record<string, string>
      )[code] ?? `操作未完成（${code || r.status}），请核对课程资格或文件。`,
    );
  }
  return r;
}
type Loaded = {
  blob: Blob;
  document: AppDocument;
  manifest: ClassroomManifest;
  snapshot: ClassroomExportSnapshot;
};
async function loadSource(): Promise<Loaded> {
  const r = await api('/archive/export?' + source),
    blob = await r.blob(),
    zip = await JSZip.loadAsync(blob),
    document = JSON.parse(await zip.file('zhiban-document.json')!.async('text')) as AppDocument,
    manifest = JSON.parse(await zip.file('manifest.json')!.async('text')) as ClassroomManifest;
  const files = new Map<string, Blob>(),
    refs = new Map<string, string>();
  for (const [path, entry] of Object.entries(manifest.mediaIndex)) {
    const bytes = await zip.file(path)!.async('uint8array'),
      data = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: entry.mimeType });
    files.set(path, data);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    refs.set(entry.sourceRef!, `data:${entry.mimeType};base64,${btoa(binary)}`);
  }
  const inline = mapDesignRefs(structuredClone(document), refs);
  for (const scene of inline.scenes)
    if (scene.content.type === 'slide')
      for (const el of scene.content.canvas.elements)
        if (el.type === 'audio' || el.type === 'video') {
          const mime = /^data:([^;]+);base64,/.exec(el.src ?? '')?.[1];
          const ext = (
            {
              'audio/wav': 'wav',
              'audio/x-wav': 'wav',
              'audio/mpeg': 'mp3',
              'audio/mp4': 'm4a',
              'audio/ogg': 'ogg',
              'video/webm': 'webm',
              'video/mp4': 'mp4',
              'video/ogg': 'ogv',
            } as Record<string, string>
          )[mime ?? ''];
          if (ext) el.ext = ext;
        }
  return {
    blob,
    document: inline,
    manifest,
    snapshot: {
      manifest,
      files,
      videoPosters: new Map(),
      stageName: document.stage.name,
      inlineFailures: [],
      missingAudioCount: 0,
    },
  };
}
const t = (key: string, vars?: Record<string, unknown>) => {
  let v: unknown = zh;
  for (const part of key.split('.')) v = (v as Record<string, unknown>)?.[part];
  return typeof v === 'string'
    ? v.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars?.[k] ?? _m))
    : key;
};
function Root() {
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('正在核对任教资格…'),
    [loaded, setLoaded] = useState<Loaded | null>(null),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<{
      digest: string;
      title: string;
      scenes: { title: string; type: string }[];
      assets: number;
      scannerAvailable: boolean;
    } | null>(null),
    [copy, setCopy] = useState('');
  const [command, setCommand] = useState(v7());
  useEffect(() => {
    void api('')
      .then(() => {
        setReady(true);
        setNotice('恢复创建新的本人课程编辑副本；须另行核对、采用与发布。');
      })
      .catch((e) => setNotice(e.message));
  }, []);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const data = await loadSource();
    setLoaded(data);
    setNotice(
      `已读取固定课件：${data.document.scenes.length} 个场景，${data.snapshot.files.size} 份资产。`,
    );
  };
  const exportFile = async (format: string) => {
    await api('/archive/access?' + source);
    const save = async (blob: Blob, name: string) => {
      await api('/archive/access?' + source);
      saveAs(blob, name);
    };
    const data = loaded ?? (await loadSource());
    setLoaded(data);
    const { document: d } = data,
      name = d.stage.name.replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 100) || 'course';
    if (format === 'maic') {
      await save(data.blob, name + '.maic.zip');
      setNotice('已导出原生归档；包含设计、讲稿、Quiz／PBL设计与已存储资产。');
      return;
    }
    const slides = d.scenes.filter((s) => s.content.type === 'slide');
    const viewportSize =
      slides[0]?.content.type === 'slide' ? (slides[0].content.canvas.viewportSize ?? 960) : 960;
    const viewportRatio =
      slides[0]?.content.type === 'slide'
        ? (slides[0].content.canvas.viewportRatio ?? 9 / 16)
        : 9 / 16;
    const ratioPx2Inch = 96 * (viewportSize / 960),
      ratioPx2Pt = (96 / 72) * (viewportSize / 960);
    const online = source.has('publication')
      ? location.origin +
        '/zhiban/native-classroom?' +
        new URLSearchParams({
          tenant: tenant!,
          offering: offering!,
          resource: source.get('resource')!,
          publication: source.get('publication')!,
        })
      : undefined;
    const pptx = () =>
      buildPptxBlob(
        slides.map((s) => (s.content.type === 'slide' ? s.content.canvas : never())),
        slides,
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        undefined,
        planPptxDeck(d.scenes, t, {
          linkInteractivePages: format === 'resources',
          classroomUrl: online,
        }),
        false,
        {
          strict: true,
          resolve: async (ref) => ref ?? '',
          video: (el, id, elements) => resolveVideoMediaForElement({}, el, id, elements),
        },
      );
    if (format === 'pptx') await save(await pptx(), name + '.pptx');
    if (format === 'resources') {
      const pack = await buildResourcePackZip(d.scenes, {
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        fileName: name,
        getPptxBlob: pptx,
        fetcher: async () => {
          throw Error('归档导出禁止外部抓取');
        },
      });
      if (!pack.blob || pack.failedAssetUrls.length)
        throw Error('存在无法归档的外部资源，请回工作台处理。');
      await save(pack.blob, name + '-resources.zip');
    }
    if (format === 'md' || format === 'docx') {
      const scripts = collectSceneScripts(d.scenes, (n) => '第' + n + '页');
      await save(
        format === 'md'
          ? new Blob([buildMarkdown(name, scripts)], { type: 'text/markdown;charset=utf-8' })
          : await buildDocxBlob(name, scripts),
        name + '-script.' + format,
      );
    }
    if (format === 'html') {
      const result = await buildStandaloneHtmlExport(d.stage, d.scenes, {
        snapshot: data.snapshot,
        strings: zh.export.htmlPlayer,
        lang: 'zh-CN',
        includeNarration: true,
        classroomUrl: online,
        format: 'auto',
        fetchAsset: async (path) => {
          const r = await fetch(
            ('/' + path.replace(/^\//, '')).replace(
              '/vendor/standalone-player/',
              '/zhiban/export-player/',
            ),
          );
          if (!r.ok) throw Error('离线播放器文件不可用');
          return r.text();
        },
        fetchImage: async () => null,
        fetchVideo: async () => null,
      });
      if (result.unresolvedMedia.length || result.inlineFailures.length || result.missingAudioCount)
        throw Error('存在未嵌入媒体，已停止下载，请回工作台核对。');
      await save(result.blob, result.fileName);
    }
    setNotice(
      '导出完成。PPTX 使用原生占位页表示互动／PBL；离线 HTML 保留可离线播放与自测范围，在线 AI 仍需登录。',
    );
  };
  const kind = file?.name.toLowerCase().endsWith('.pptx') ? 'pptx' : 'maic';
  const inspect = async () => {
    if (!file) return;
    setCopy('');
    const result = await api('/archive/inspect?kind=' + kind, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: file,
    });
    const value = await result.json();
    setPreview(value);
    setNotice('已核对文件结构。恢复前会执行可信扫描与当前任教查证。');
  };
  const restore = async () => {
    if (!file || !preview) return;
    const r = await api('/archive/restore?kind=' + kind, {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'x-zhiban-archive-digest': preview.digest,
        'x-zhiban-command': command,
      },
      body: file,
    });
    const value = await r.json();
    setCopy(value.stageId);
    setNotice(
      value.alreadyExists
        ? '已找到同次恢复的编辑副本，请打开核对；未覆盖其他课件。'
        : '恢复完成，请在原生工作台核对，再采用为课程草稿并显式发布。',
    );
  };
  return (
    <>
      <header>
        <a href={course}>← 返回课程</a>
        <h1>完整课件 · 归档与恢复</h1>
      </header>
      <main>
        <p className="status" role="status">
          {notice}
        </p>
        {ready && (
          <>
            <section className="card">
              <h2>固定课件导出</h2>
              <p className="muted">导出课件设计和资源，不包含学生记录、成绩或私人 AI 对话。</p>
              {source.size ? (
                <>
                  <button disabled={busy} onClick={() => void act(load)}>
                    读取本次课件
                  </button>
                  {loaded && (
                    <p>
                      <strong>{loaded.document.stage.name}</strong> ·{' '}
                      {loaded.document.scenes.length} 场景
                    </p>
                  )}
                  <div className="actions">
                    {[
                      ['maic', '原生归档 .maic.zip'],
                      ['pptx', 'PowerPoint'],
                      ['resources', 'PPTX＋互动资源包'],
                      ['html', '完整离线 HTML'],
                      ['md', 'Markdown 讲稿'],
                      ['docx', 'Word 讲稿'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        disabled={busy}
                        onClick={() => void act(() => exportFile(id))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>从已发布课件或原生工作台选择「归档与恢复」，即可导出指定课件。</p>
              )}
            </section>
            {source.size > 0 && <CourseVideo api={api} source={source} load={loadSource} />}
            <section className="card">
              <h2>恢复为新的编辑副本</h2>
              <p>
                支持原生 .maic.zip 完整设计与资产；PPTX 可恢复为幻灯片，占位页无法还原在线测验、PBL
                项目或 AI 对话。
              </p>
              <input
                aria-label="选择课件归档"
                type="file"
                accept=".zip,.pptx"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setCopy('');
                  setCommand(v7());
                }}
              />
              <div className="actions">
                <button disabled={busy || !file} onClick={() => void act(inspect)}>
                  核对归档
                </button>
                <button
                  className="primary"
                  disabled={busy || !preview || !preview.scannerAvailable}
                  onClick={() => void act(restore)}
                >
                  恢复为新编辑副本
                </button>
              </div>
              {preview && (
                <>
                  <p>
                    <strong>{preview.title}</strong> · {preview.scenes.length || 'PPTX 转换后确定'}{' '}
                    场景 · {preview.assets} 资产
                  </p>
                  <ul>
                    {preview.scenes.map((s, i) => (
                      <li key={i}>
                        {s.title} · {s.type}
                      </li>
                    ))}
                  </ul>
                  {!preview.scannerAvailable && (
                    <p>可信归档扫描服务未配置；核对可用，恢复暂不可用。</p>
                  )}
                </>
              )}
              {copy && (
                <a
                  className="link"
                  href={`/zhiban/native-workbench?tenant=${tenant}&offering=${offering}&course=${copy}`}
                >
                  打开恢复课件 → 核对／采用／发布
                </a>
              )}
              <p className="muted">
                压缩文件最多 64 MiB，展开最多 128 MiB、512 项；PPTX 按原生转换器限 8 MiB／80
                页。恢复不覆盖旧发布，权限和启用策略须在目标课程重新确认。
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
function never(): never {
  throw Error('Invalid slide');
}
createRoot(document.getElementById('native-archive-root')!).render(<Root />);
