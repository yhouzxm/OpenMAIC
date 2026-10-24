/** Data-only adapter over native PPTX and standalone-player exporters. */
import React, { useState, useEffect, useRef } from 'react';
import type { Slide } from '@openmaic/dsl';
import { buildPptxBlob } from '@/lib/export/pptx-builder';
import { assembleStandaloneHtml } from '@/lib/export/standalone-html/assemble';
import { prepareStandaloneManifest } from '@/lib/export/standalone-html/prepare-manifest';
import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';
import zh from '@/lib/i18n/locales/zh-CN.json';
export type ExportUnit = {
  id: string;
  title: string;
  target: string;
  kind: 'LECTURE' | 'MATERIAL';
};
type Page = {
  id: string;
  elements: {
    id: string;
    text?: string;
    assetId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
};
type Lecture = { publicationId: string; slides: Page[] };
type Material = { publicationNo: number; digest: string; text: string };
type Outline = {
  mode: string;
  publicationNo: number;
  chapters: { units: ExportUnit[] }[];
  published?: { units: ExportUnit[] }[];
};
const LIMIT = 32 * 1024 * 1024;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function slide(id: string, elements: Slide['elements']): Slide {
  return {
    id,
    viewportSize: 960,
    viewportRatio: 0.5625,
    elements,
    background: { type: 'solid', color: '#ffffff' },
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
  };
}
/** Reflow plain resource text deterministically; never drop overflowing paragraphs. */
export function textSlides(text: string): Slide[] {
  if (!text.trim()) throw Error('没有可导出的解析正文，请下载原文件。');
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const chars = Array.from(line);
    const rows: string[] = [];
    for (let i = 0; i < chars.length; i += 34) rows.push(chars.slice(i, i + 34).join(''));
    return rows.length ? rows : [''];
  });
  if (lines.length > 2800) throw Error('正文超过 200 页导出上限，请下载原文件。');
  const pages: Slide[] = [];
  for (let i = 0; i < lines.length; i += 14)
    pages.push(
      slide('text-' + i, [
        {
          id: 'body-' + i,
          type: 'text',
          left: 48,
          top: 40,
          width: 864,
          height: 460,
          rotate: 0,
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#111111',
          content: lines
            .slice(i, i + 14)
            .map((l) => '<p style="font-size:22px">' + escape(l || ' ') + '</p>')
            .join(''),
        },
      ]),
    );
  return pages;
}
async function bytes(path: string, signal: AbortSignal, max = LIMIT): Promise<Response> {
  const r = await fetch(path, {
    headers: { 'x-zhiban-request': 'identity-v1' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!r.ok) throw Error('内容已变化、未发布或当前无访问权限，请重新读取。');
  const n = Number(r.headers.get('content-length'));
  if (n > max) throw Error('导出内容超过限制。');
  return r;
}
async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const b = await (await bytes(path, signal)).text();
  if (b.length > LIMIT) throw Error('内容超过限制。');
  return JSON.parse(b) as T;
}
const dataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const f = new FileReader();
    f.onload = () => resolve(String(f.result));
    f.onerror = () => reject(Error('图片读取失败'));
    f.readAsDataURL(blob);
  });
export async function publishedSnapshot(
  tenant: string,
  offering: string,
  unit: ExportUnit,
  signal: AbortSignal,
) {
  const obase = `/api/zhiban/learning/${tenant}/offerings/${offering}/outline`;
  const checkOutline = async (expected?: number) => {
    const o = await json<Outline>(obase, signal);
    const units = (o.mode === 'TEACHER' ? (o.published ?? []) : o.chapters).flatMap((c) => c.units);
    if (
      (expected !== undefined && o.publicationNo !== expected) ||
      !units.some((u) => u.id === unit.id && u.target === unit.target && u.kind === unit.kind)
    )
      throw Error('课程目录已变化，请重新读取。');
    return o.publicationNo;
  };
  const outlineNo = await checkOutline();
  let slides: Slide[], version: string, recheck: () => Promise<void>;
  if (unit.kind === 'MATERIAL') {
    const base = `/api/zhiban/materials/${tenant}/offerings/${offering}/${unit.target}`;
    const m = await json<Material>(base, signal);
    if (!m.publicationNo) throw Error('资源尚未发布');
    slides = textSlides(m.text);
    version = String(m.publicationNo);
    recheck = async () => {
      const v = await json<Material>(base, signal);
      if (v.publicationNo !== m.publicationNo || v.digest !== m.digest)
        throw Error('资源发布版本已变化，请重试。');
    };
  } else {
    const base = `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${unit.target}`;
    const p = await json<Lecture>(base + '/preview?source=published', signal);
    if (!p.publicationId || !p.slides.length || p.slides.length > 200)
      throw Error('讲义发布版本或页数无效。');
    version = p.publicationId;
    let total = 0;
    slides = [];
    for (const page of p.slides) {
      const elements: Slide['elements'] = [];
      for (const e of page.elements) {
        const common = {
          id: e.id,
          left: e.x,
          top: e.y,
          width: e.width,
          height: e.height,
          rotate: 0,
        };
        if (e.assetId) {
          const r = await bytes(
            `${base}/assets/${e.assetId}?source=published&version=${p.publicationId}&slide=${page.id}`,
            signal,
            4 * 1024 * 1024,
          );
          if (r.headers.get('content-type')?.split(';')[0] !== 'image/png')
            throw Error('讲义图片格式不符');
          const blob = await r.blob();
          total += blob.size;
          if (blob.size > 4 * 1024 * 1024 || total > LIMIT) throw Error('讲义图片超过导出限制');
          elements.push({ ...common, type: 'image', src: await dataUrl(blob), fixedRatio: true });
        } else
          elements.push({
            ...common,
            type: 'text',
            content: escape(e.text ?? '').replace(/\n/g, '<br>'),
            defaultFontName: 'Microsoft YaHei',
            defaultColor: '#111111',
          });
      }
      slides.push(slide(page.id, elements));
    }
    recheck = async () => {
      const v = await json<Lecture>(base + '/preview?source=published', signal);
      if (v.publicationId !== p.publicationId) throw Error('讲义发布版本已变化，请重试。');
    };
  }
  return {
    slides,
    version,
    confirm: async () => {
      await recheck();
      await checkOutline(outlineNo);
      signal.throwIfAborted();
    },
  };
}
export async function exportPublished(
  tenant: string,
  offering: string,
  unit: ExportUnit,
  format: 'pptx' | 'html',
  signal: AbortSignal,
) {
  const snapshot = await publishedSnapshot(tenant, offering, unit, signal);
  let blob: Blob;
  if (format === 'pptx')
    blob = await buildPptxBlob(
      snapshot.slides,
      [],
      0.5625,
      960,
      96,
      96 / 72,
      undefined,
      undefined,
      true,
    );
  else {
    const get = async (name: string, max: number) => {
      const r = await bytes('/zhiban/export-player/' + name, signal, max);
      const b = await r.text();
      if (b.length > max) throw Error('离线播放器超过限制');
      return b;
    };
    const [playerScript, playerStyle] = await Promise.all([
      get('player.min.js', 16 * 1024 * 1024),
      get('player.min.css', 2 * 1024 * 1024),
    ]);
    const now = Date.now();
    const manifest: ClassroomManifest = {
      formatVersion: 1,
      exportedAt: new Date(now).toISOString(),
      appVersion: 'zhiban-p3-published',
      stage: {
        name: unit.title + ' · 发布版本 ' + snapshot.version,
        createdAt: now,
        updatedAt: now,
        language: 'zh-CN',
      },
      agents: [],
      mediaIndex: {},
      scenes: snapshot.slides.map((canvas, order) => ({
        type: 'slide',
        title: unit.title + ' · ' + (order + 1),
        order,
        content: { type: 'slide', canvas },
      })),
    };
    const prepared = prepareStandaloneManifest(manifest, { dataUris: new Map() });
    if (prepared.unresolved.length) throw Error('离线资源不完整，已取消下载');
    blob = new Blob(
      [
        assembleStandaloneHtml({
          manifest: prepared.manifest,
          config: { strings: zh.export.htmlPlayer },
          playerScript,
          playerStyle,
          lang: 'zh-CN',
        }),
      ],
      { type: 'text/html;charset=utf-8' },
    );
  }
  if (blob.size > LIMIT) throw Error('导出文件超过 32 MiB 限制');
  await snapshot.confirm();
  return {
    blob,
    name:
      (unit.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || '课程内容') +
      '-v' +
      snapshot.version +
      '.' +
      format,
  };
}
export function PublishedExport({
  tenant,
  offering,
  unit,
}: {
  tenant: string;
  offering: string;
  unit: ExportUnit;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), [tenant, offering, unit.id]);
  async function run(format: 'pptx' | 'html') {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    setBusy(true);
    setMessage('正在读取并核对已发布版本…');
    try {
      const result = await exportPublished(tenant, offering, unit, format, controller.signal);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(result.blob),
        a = document.createElement('a');
      a.href = url;
      a.download = result.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage('已生成发布版本文件。离线副本不会随课程更新或撤权；请按课程许可使用。');
    } catch (e) {
      if (!controller.signal.aborted)
        setMessage(e instanceof Error ? e.message : '导出失败，请重试。');
    } finally {
      clearTimeout(timer);
      active.current = null;
      setBusy(false);
    }
  }
  return (
    <section aria-label="导出已发布单元">
      <p>导出当前单元的已发布文本／PNG；教学资源按解析正文分页，不包含原文件排版。</p>
      <button disabled={busy} onClick={() => void run('pptx')}>
        导出 PPTX
      </button>{' '}
      <button disabled={busy} onClick={() => void run('html')}>
        导出离线 HTML
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
