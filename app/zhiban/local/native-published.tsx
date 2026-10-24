import React from 'react';
import { createRoot } from 'react-dom/client';
import { STANDALONE_MEDIA_TABLE_ELEMENT_ID } from '@/lib/export/standalone-html/contract';
import { App } from '@/lib/standalone-player/App';
import zh from '@/lib/i18n/locales/zh-CN.json';
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering'),
  resource = q.get('resource'),
  publication = q.get('publication');
const isDraft = q.get('source') === 'draft',
  revision = q.get('revision');
const url = isDraft
  ? `/api/zhiban/authoring/${tenant}/offerings/${offering}/draft/${resource}/document?revision=${revision}`
  : `/api/zhiban/authoring/${tenant}/offerings/${offering}/published/${resource}?publication=${publication}`;
const root = createRoot(document.getElementById('openmaic-player')!),
  status = document.getElementById('player-status')!;
(document.getElementById('native-return') as HTMLAnchorElement).href =
  `/zhiban/content?tenant=${tenant}&offering=${offering}`;
let live = true,
  shown = false;
async function read() {
  try {
    const r = await fetch(url, {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
    });
    if (!r.ok) throw Error('当前发布或课程资格不可用');
    const data = await r.json();
    if (!live) return;
    if (!shown) {
      let table = document.getElementById(STANDALONE_MEDIA_TABLE_ELEMENT_ID);
      if (!table) {
        table = document.createElement('script');
        table.id = STANDALONE_MEDIA_TABLE_ELEMENT_ID;
        (table as HTMLScriptElement).type = 'application/json';
        document.body.append(table);
      }
      table.textContent = JSON.stringify(data.mediaTable);
      root.render(
        <App
          data={{
            manifest: data.manifest,
            scenes: data.manifest.scenes,
            config: {
              strings: zh.export.htmlPlayer,
              interactiveSourceUrl: data.frameUrl,
              interactiveSandbox: 'allow-scripts',
            },
          }}
        />,
      );
      shown = true;
    }
    status.textContent = `${isDraft ? '待发布固定草稿 ' + revision : '发布版本 ' + data.publicationNo} · ${data.manifest.scenes.length} 个原生场景`;
  } catch {
    if (live) {
      root.render(null);
      shown = false;
      status.textContent = '当前发布版本已撤回、课程资格已变化或连接暂不可用，请返回课程核对。';
    }
  }
}
void read();
const timer = setInterval(() => {
  if (document.visibilityState === 'visible') void read();
}, 5000);
addEventListener(
  'pagehide',
  () => {
    live = false;
    clearInterval(timer);
    root.unmount();
  },
  { once: true },
);
