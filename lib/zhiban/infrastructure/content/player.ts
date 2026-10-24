/** Data adapter only. Playback UI/engine stays in OpenMAIC's native App. */
import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';
import { escapeHtmlText, serializeJsonForHtmlScript } from '@/lib/export/standalone-html/assemble';
import zh from '@/lib/i18n/locales/zh-CN.json';
import type { Draft } from './model';
export const PUBLISHED_PLAYER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  // Native renderer positions elements through React style properties; this document carries only validated text/PNG.
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self'",
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
export type PublishedPlayerPreview = Draft & {
  publicationId: string;
  publicationNo: number;
  html?: string;
};
export function attemptRuntimeDocument(base: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作答关联与可信记录</title><link rel="stylesheet" href="/zhiban/published-player.css"><script src="/zhiban/attempt-runtime-page.js" defer></script></head><body class="attempt-runtime-history"><header><button id="runtime-return" type="button">返回课程页面</button><h1>作答关联与可信记录</h1><p>只读查证服务端学习事实；撤回的互动内容不会在此播放。</p></header><main id="attempt-runtime-root"></main><script type="application/json" id="zhiban-runtime-binding">${serializeJsonForHtmlScript({ base })}</script></body></html>`;
}
export function publishedPlayerManifest(
  base: string,
  p: PublishedPlayerPreview,
): ClassroomManifest {
  return {
    formatVersion: 1,
    exportedAt: new Date(0).toISOString(),
    appVersion: 'zhiban-p4-readonly',
    stage: {
      name: `${p.title} · 发布版本 ${p.publicationNo}`,
      createdAt: 0,
      updatedAt: 0,
      language: 'zh-CN',
    },
    agents: [],
    mediaIndex: {},
    scenes:
      p.html !== undefined
        ? [
            {
              type: 'interactive',
              title: p.title,
              order: 0,
              content: { type: 'interactive', html: ' ' },
            },
          ]
        : p.slides.map((s, order) => ({
            type: 'slide',
            title: `${p.title} · ${order + 1}`,
            order,
            content: {
              type: 'slide',
              canvas: {
                id: s.id,
                viewportSize: 960,
                viewportRatio: 0.5625,
                background: { type: 'solid', color: '#ffffff' },
                theme: {
                  backgroundColor: '#ffffff',
                  themeColors: ['#111111'],
                  fontColor: '#111111',
                  fontName: 'sans-serif',
                },
                elements: s.elements.map((e) => ({
                  id: e.id,
                  left: e.x,
                  top: e.y,
                  width: e.width,
                  height: e.height,
                  rotate: 0,
                  ...('assetId' in e && e.assetId
                    ? {
                        type: 'image' as const,
                        fixedRatio: true,
                        src: `${base}/assets/${e.assetId}?source=published&version=${p.publicationId}&slide=${s.id}`,
                      }
                    : {
                        type: 'text' as const,
                        content: escapeHtmlText(e.text ?? '').replace(/\n/g, '<br>'),
                        defaultFontName: 'sans-serif',
                        defaultColor: '#111111',
                      }),
                })),
              },
            },
          })),
  };
}
export function publishedPlayerDocument(
  base: string,
  p: PublishedPlayerPreview,
  tenant: string,
  attemptRuntimeEnabled = false,
  joint?: {
    attemptId: string;
    activityId: string;
    activityVersion: string;
    sessionId: string;
    dispatchId: string;
    bindingId: string;
  },
  classroomId?: string,
): string {
  const manifest = publishedPlayerManifest(base, p);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlText(p.title)} · 原生 PPT 播放</title><link rel="stylesheet" href="/zhiban/export-player/player.min.css"><link rel="stylesheet" href="/zhiban/published-player.css"><script src="/zhiban/published-player.js" defer></script></head><body class="published-player"><header class="published-player-context"><button id="player-return" type="button">返回课程页面</button><span>固定发布版本 ${p.publicationNo} · 只读播放，不计完成或成绩</span><a href="/zhiban?space=${tenant}">返回工作台</a></header><p id="player-status" role="status">正在核对发布版本与课程资格…</p><section id="classroom-presentation" hidden aria-label="课堂演示控制"></section><div id="openmaic-player"></div>${attemptRuntimeEnabled && p.html !== undefined ? '<div id="attempt-runtime-root"></div>' : ''}<script type="application/json" id="openmaic-classroom">${serializeJsonForHtmlScript(manifest)}</script><script type="application/json" id="openmaic-player-config">${serializeJsonForHtmlScript({ strings: zh.export.htmlPlayer, ...(p.html !== undefined ? { interactiveSourceUrl: base + '/frame?publication=' + p.publicationId, interactiveSandbox: 'allow-scripts' } : {}) })}</script><script type="application/json" id="zhiban-player-binding">${serializeJsonForHtmlScript({ base, publicationId: p.publicationId, ...(joint ? { joint } : {}), ...(classroomId ? { classroomId } : {}) })}</script></body></html>`;
}
