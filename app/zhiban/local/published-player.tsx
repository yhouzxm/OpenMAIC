/** Host lifecycle/auth binding only; the complete PPT UI and engine are upstream OpenMAIC. */
import React from 'react';
import { JointAttemptPanel, type JointEntry } from './joint-attempt-client';
import { AttemptRuntimePanel } from './attempt-runtime-client';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '@/lib/standalone-player/App';
import { readPlayerData } from '@/lib/standalone-player/read-data';
import { sceneHash, sceneIndexFromHash } from '@/lib/standalone-player/navigation';
import { classroomPresentation, type PresentationView } from './classroom-player';
const data = readPlayerData(document);
const binding = JSON.parse(document.getElementById('zhiban-player-binding')!.textContent!) as {
  base: string;
  publicationId: string;
  classroomId?: string;
  joint?: JointEntry;
};
const container = document.getElementById('openmaic-player')!;
const status = document.getElementById('player-status')!;
const runtimeContainer = document.getElementById('attempt-runtime-root');
const presentation = document.getElementById('classroom-presentation')!;
const parts = /^\/api\/zhiban\/content\/([^/]+)\/offerings\/([^/]+)\/resources\/([^/]+)$/.exec(
  binding.base,
)!;
const classroomBase = `/api/zhiban/learning/${parts[1]}/offerings/${parts[2]}/classrooms`;
let classroomReturn = `/zhiban?space=${parts[1]}`;
let livePresentation: ReturnType<typeof classroomPresentation> = null;
let following = true,
  sharing = false,
  initializedPosition = false;
let shareButton: HTMLButtonElement | undefined;
let followButton: HTMLButtonElement | undefined;
let presentationStatus: HTMLElement | undefined;
function gotoPage(page: number) {
  const hash = sceneHash(page - 1);
  if (location.hash === hash) return;
  history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
function showPresentation() {
  const live = livePresentation;
  if (!live) return;
  if (!presentationStatus) {
    presentationStatus = document.createElement('p');
    presentationStatus.setAttribute('role', 'status');
    presentation.append(presentationStatus);
    const control = document.createElement('button');
    control.type = 'button';
    if (live.teacher) {
      shareButton = control;
      control.textContent = '共享当前原生播放器页';
      control.addEventListener('click', () => void sharePage());
    } else {
      followButton = control;
      control.addEventListener('click', () => {
        following = !following;
        if (following && livePresentation) gotoPage(livePresentation.task.current_page);
        showPresentation();
      });
    }
    presentation.append(control);
    const back = document.createElement('a');
    back.textContent = '返回本次课堂';
    back.href = classroomReturn;
    presentation.append(back);
  }
  presentation.hidden = false;
  presentationStatus.textContent = live.teacher
    ? `全班共享第 ${live.task.current_page} / ${live.task.page_count} 页；原生翻页后可显式共享。`
    : `${following ? '跟随教师' : '自主浏览'}；教师第 ${live.task.current_page} / ${live.task.page_count} 页。翻页不计完成或成绩。`;
  if (followButton) {
    followButton.textContent = following ? '切换自主浏览' : '恢复跟随教师';
    followButton.setAttribute('aria-pressed', String(following));
  }
  if (shareButton) shareButton.disabled = sharing;
}
async function sharePage() {
  const live = livePresentation;
  if (sharing || closed || disposed || !live?.teacher) return;
  sharing = true;
  showPresentation();
  const page = sceneIndexFromHash(location.hash, data.manifest.scenes.length) + 1;
  try {
    const csrf = await fetch('/api/zhiban/identity/csrf', {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!csrf.ok) throw Error('当前登录已变化，请返回课堂重新核对。');
    const token = await csrf.json();
    if (closed || disposed) return;
    const r = await fetch(classroomBase, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        'x-zhiban-request': 'identity-v1',
        'x-zhiban-csrf': token.csrfToken,
        'x-zhiban-command': crypto.randomUUID().replaceAll('-', ''),
      },
      body: JSON.stringify({
        type: 'PRESENT_LECTURE_PAGE',
        id: live.session.id,
        revision: live.session.revision,
        dispatchId: live.task.id,
        presentationRevision: live.task.presentation_revision,
        page,
      }),
    });
    if (!r.ok)
      throw Error(
        r.status === 409
          ? '课堂位置已变化，请重新核对后再共享。'
          : '当前共享不可用，请返回课堂核对授权。',
      );
    if (!disposed) await verify();
  } catch (error) {
    if (!disposed && presentationStatus)
      presentationStatus.textContent =
        error instanceof Error ? error.message : '共享结果待核对，请返回课堂查证后再操作。';
  } finally {
    sharing = false;
    if (shareButton) shareButton.disabled = closed || disposed;
  }
}

let runtimeRoot: Root | undefined;
let root: Root | undefined,
  controller: AbortController | undefined,
  checking = false,
  closed = false,
  disposed = false;
function removePlayer(message: string) {
  livePresentation = null;
  presentation.hidden = true;
  if (shareButton) shareButton.disabled = true;
  runtimeRoot?.unmount();
  runtimeRoot = undefined;
  runtimeContainer?.replaceChildren();
  root?.unmount();
  root = undefined;
  container.replaceChildren();
  status.hidden = false;
  status.textContent = message;
}
async function verify() {
  if (closed || disposed || checking || document.hidden || !navigator.onLine) return;
  checking = true;
  controller = new AbortController();
  const timer = setTimeout(() => controller?.abort(), 12000);
  try {
    const r = await fetch(binding.base + '/preview?source=published', {
      headers: {
        'x-zhiban-request': 'identity-v1',
        'x-zhiban-publication-id': binding.publicationId,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (disposed) return;
    if (!r.ok) {
      closed = true;
      removePlayer('当前登录、课程资格或发布版本已变化，请返回课程重新进入。');
      return;
    }
    const preview = (await r.json()) as { publicationId: string };
    if (disposed) return;
    if (preview.publicationId !== binding.publicationId) {
      closed = true;
      removePlayer('发布版本已变化，请返回课程重新进入。');
      return;
    }
    if (binding.classroomId) {
      const response = await fetch(classroomBase, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (disposed) return;
      if (!response.ok) {
        if (response.status >= 500) throw Error('Classroom temporarily unavailable');
        closed = true;
        removePlayer('课堂授权已变化，请返回课堂重新进入。');
        return;
      }
      const view = (await response.json()) as PresentationView;
      if (disposed) return;
      if (
        view.courseId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(view.courseId)
      ) {
        const teacher = view.mode === 'TEACHER';
        const flow = view.sessions.find((s) => s.id === binding.classroomId)?.flow;
        classroomReturn = `/zhiban/${teacher ? 'teacher' : 'student'}/courses/${view.courseId}/${flow ? 'classroom-plan' : teacher ? 'classrooms' : 'coursework'}?space=${parts[1]}&offering=${parts[2]}#classroom-${binding.classroomId}`;
      }
      livePresentation = classroomPresentation(
        view,
        binding.classroomId,
        parts[3],
        binding.publicationId,
        data.manifest.scenes.length,
      );
      if (!livePresentation) {
        closed = true;
        removePlayer('课堂已暂停、结束或任务已切换，请返回课堂重新进入。');
        return;
      }
    }
    status.hidden = true;
    if (!root) {
      root = createRoot(container);
      root.render(<App data={data} />);
      if (runtimeContainer) {
        runtimeRoot = createRoot(runtimeContainer);
        runtimeRoot.render(
          binding.joint ? (
            <JointAttemptPanel
              base={binding.base}
              publicationId={binding.publicationId}
              joint={binding.joint}
            />
          ) : (
            <AttemptRuntimePanel {...binding} />
          ),
        );
      }
    }
    if (livePresentation) {
      if (!initializedPosition || (!livePresentation.teacher && following)) {
        gotoPage(livePresentation.task.current_page);
        initializedPosition = true;
      }
      showPresentation();
    }
  } catch {
    if (!disposed) {
      status.hidden = false;
      status.textContent = root
        ? '连接中断：暂留已读取版本，联网后重新核对。'
        : '连接不可用，请联网后重试或返回课程。';
    }
  } finally {
    clearTimeout(timer);
    checking = false;
  }
}
document.getElementById('player-return')!.addEventListener('click', () => {
  if (binding.classroomId) location.assign(classroomReturn);
  else if (history.length > 1) history.back();
  else location.assign('/zhiban');
});
window.addEventListener('pagehide', () => {
  disposed = true;
  controller?.abort();
  removePlayer('正在离开播放页面…');
});
window.addEventListener('pageshow', () => {
  disposed = false;
  void verify();
});
window.addEventListener('online', () => void verify());
window.addEventListener('offline', () => {
  status.hidden = false;
  status.textContent = '连接中断：暂留已读取版本，联网后重新核对。';
});
document.addEventListener('visibilitychange', () => void verify());
setInterval(() => void verify(), 5000);
void verify();
