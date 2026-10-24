import { publishedPlayerHref } from './published-player-link';
import { PublishedExport } from './published-export';
import { MaterialPreview } from './material-client';
/** Course navigation adapter: published business references + public OpenMAIC SlideCanvas. */
import React, { useEffect, useRef, useState } from 'react';
import { SlideCanvas } from '@openmaic/renderer';
import type { Slide } from '@openmaic/dsl';
type Unit = {
  id: string;
  title: string;
  kind: 'LECTURE' | 'ACTIVITY' | 'MATERIAL';
  target: string;
  chapter: string;
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
type Preview = { publicationId: string; slides: Page[]; html?: string };
type Outline = {
  progress?: {
    publicationNo: number;
    configured: boolean;
    required: number;
    satisfied: number;
    rows: { activityId: string; complete: boolean; stale: boolean; blockedBy: string[] }[];
  };
  mode: 'TEACHER' | 'STUDENT';
  publicationNo: number;
  chapters: { title: string; units: Omit<Unit, 'chapter'>[] }[];
  published?: { title: string; units: Omit<Unit, 'chapter'>[] }[];
  resources: { id: string; state: string; quarantined: boolean }[];
  materials?: { id: string; status: string }[];
  activities: { id: string; status: string }[];
};
type LearningHost = {
  render(
    tenant: string,
    offering: { id: string; status: string },
    root: HTMLElement,
    person: (id: string) => string,
    options: { activityId: string },
  ): Promise<(() => void) | undefined>;
};
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function learningCenterRoute(path: string) {
  const m = new RegExp(
    `^/zhiban/(teacher|student)/courses/(${uuid})/learning-center(?:/(${uuid}))?$`,
  ).exec(path);
  return m ? { role: m[1], course: m[2], unit: m[3] ?? null } : null;
}
function canvas(page: Page): Slide {
  return {
    id: page.id,
    viewportSize: 960,
    viewportRatio: 0.5625,
    elements: page.elements.map((e) => ({
      id: e.id,
      left: e.x,
      top: e.y,
      width: e.width,
      height: e.height,
      rotate: 0,
      ...(e.assetId
        ? { type: 'image' as const, src: 'asset:' + e.assetId, fixedRatio: true }
        : {
            type: 'text' as const,
            content: e.text ?? '',
            defaultFontName: 'sans-serif',
            defaultColor: '#111111',
          }),
    })),
    background: { type: 'solid', color: '#ffffff' },
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
  };
}
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { 'x-zhiban-request': 'identity-v1' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw Error(
      response.status === 401
        ? '登录已失效，请返回工作台登录。'
        : '内容不可访问，可能已撤回或课程资格已变化。',
    );
  return (await response.json()) as T;
}
function Activity({
  tenant,
  offering,
  id,
  teacher,
  status,
}: {
  tenant: string;
  offering: string;
  id: string;
  teacher: boolean;
  status: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false,
      cleanup: (() => void) | undefined;
    const controller = new AbortController();
    const node = root.current!;
    if (teacher) {
      void read<{ rows: { id: string; title: string; prompt: string; activity_type?: string }[] }>(
        `/api/zhiban/learning/${tenant}/offerings/${offering}/activities?q=${id}&limit=10`,
        controller.signal,
      )
        .then((data) => {
          const activity = data.rows.find((a) => a.id === id);
          if (!activity || cancelled) return;
          if (activity.activity_type === 'QUIZ') {
            cleanup = (
              window as Window & {
                zhibanQuiz: {
                  render: (
                    t: string,
                    o: string,
                    n: HTMLElement,
                    p: { activity: string },
                  ) => () => void;
                };
              }
            ).zhibanQuiz.render(tenant, offering, node, { activity: id });
            return;
          }
          const p = document.createElement('p');
          p.textContent = activity.prompt;
          node.replaceChildren(p);
        })
        .catch((e) => {
          if (!cancelled) node.textContent = String(e.message);
        });
    } else {
      const host = (window as Window & { zhibanLearning?: LearningHost }).zhibanLearning;
      if (!host) node.textContent = '作答组件未加载，请刷新重试。';
      else
        void host
          .render(tenant, { id: offering, status }, node, (x) => x, { activityId: id })
          .then((done) => {
            if (cancelled) done?.();
            else cleanup = done;
          })
          .catch((e) => {
            if (!cancelled) node.textContent = String(e.message);
          });
    }
    return () => {
      cancelled = true;
      controller.abort();
      cleanup?.();
    };
  }, [tenant, offering, id, teacher, status]);
  return <div ref={root} />;
}
export function CourseLearningCenter() {
  const route = learningCenterRoute(location.pathname)!;
  const offeringStatus =
    (window as Window & { zhibanCoursePage?: { offering?: { status: string } } }).zhibanCoursePage
      ?.offering?.status ?? 'CLOSED';
  const query = new URLSearchParams(location.search),
    tenant = query.get('space')!,
    offering = query.get('offering')!;
  const [outline, setOutline] = useState<Outline | null>(null),
    [units, setUnits] = useState<Unit[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(0);
  const unit = units.find((u) => u.id === route.unit) ?? (!route.unit ? units[0] : undefined);
  const href = (u?: Unit) =>
    `/zhiban/${route.role}/courses/${route.course}/learning-center${u ? '/' + u.id : ''}?space=${tenant}&offering=${offering}`;
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      const data = await read<Outline>(
        `/api/zhiban/learning/${tenant}/offerings/${offering}/outline`,
        controller.signal,
      );
      if (data.mode !== route.role.toUpperCase()) throw Error('当前身份与课程入口不匹配。');
      const chapters = data.mode === 'TEACHER' ? (data.published ?? []) : data.chapters;
      const authorized = chapters
        .flatMap((c) => c.units.map((u) => ({ ...u, chapter: c.title })))
        .filter((u) =>
          u.kind === 'LECTURE'
            ? data.resources.some(
                (r) => r.id === u.target && r.state === 'PUBLISHED' && !r.quarantined,
              )
            : u.kind === 'MATERIAL'
              ? (data.materials ?? []).some((m) => m.id === u.target && m.status === 'PUBLISHED')
              : data.activities.some((a) => a.id === u.target && a.status === 'PUBLISHED'),
        );
      setOutline(data);
      setUnits(authorized);
      const selected = route.unit ? authorized.find((u) => u.id === route.unit) : authorized[0];
      if (route.unit && !selected) throw Error('单元不存在、未发布或已不可访问，请返回课程目录。');
      if (selected?.kind === 'LECTURE')
        setPreview(
          await read<Preview>(
            `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${selected.target}/preview?source=published`,
            controller.signal,
          ),
        );
    })()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
        else setError('读取超时或页面已关闭，请刷新重试。');
      })
      .finally(() => {
        clearTimeout(timer);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tenant, offering, route.role, route.unit]);
  if (error)
    return (
      <section role="alert">
        <p>{error}</p>
        <a href={href()}>返回学习目录</a>
      </section>
    );
  if (loading) return <p role="status">正在读取已发布课程单元…</p>;
  if (!unit)
    return (
      <section>
        <h1>课程学习中心</h1>
        <p>尚无可学习的已发布单元，请等待教师发布课程目录。</p>
      </section>
    );
  const index = units.findIndex((u) => u.id === unit.id),
    current = preview?.slides[page];
  return (
    <section className="learning-center">
      <h1>课程学习中心</h1>
      <p>
        目录版本 {outline?.publicationNo} ·{' '}
        {route.role === 'teacher' ? '教师预览（已发布内容）' : '按课程目录学习'}
      </p>
      <p className="muted">自由浏览；阅读讲义不计作答完成或成绩。</p>
      {outline?.progress?.configured && (
        <div role="status">
          <p>
            {outline.progress.required
              ? `必修活动完成 ${outline.progress.satisfied} / ${outline.progress.required}`
              : '已配置规则，尚无必修活动；不计算完成百分比。'}
          </p>
          <p>进度基于进入本页时的正式证据；提交或评分发布后可刷新查看。</p>
          {outline.progress.rows
            .filter((r) => r.activityId === unit.target)
            .map((r) => (
              <p key={r.activityId}>
                {r.stale
                  ? '规则绑定版本已过期，请联系教师更新。'
                  : r.complete
                    ? '当前活动已满足完成依据。'
                    : '当前活动尚未满足完成依据。'}
                {r.blockedBy.length > 0 &&
                  ` 新进入需先完成：${r.blockedBy.map((id) => units.find((u) => u.target === id)?.title ?? '先修活动').join('、')}。`}{' '}
                已有作答、提交与历史不受先修锁定。
              </p>
            ))}
        </div>
      )}
      <nav className="learning-unit-list" aria-label="课程单元目录">
        {units.map((u) => (
          <a key={u.id} href={href(u)} aria-current={u.id === unit.id ? 'page' : undefined}>
            {u.chapter} · {u.kind === 'LECTURE' ? '讲义' : u.kind === 'MATERIAL' ? '资源' : '活动'}{' '}
            · {u.title}
          </a>
        ))}
      </nav>
      <article>
        <h2>{unit.title}</h2>
        {unit.kind !== 'ACTIVITY' && preview?.html === undefined && (
          <PublishedExport
            key={unit.id}
            tenant={tenant}
            offering={offering}
            unit={{ ...unit, kind: unit.kind }}
          />
        )}
        {unit.kind === 'LECTURE' && current && (
          <>
            <p>
              <a href={publishedPlayerHref(tenant, offering, unit.target, preview!.publicationId)}>
                {preview?.html !== undefined
                  ? '使用 OpenMAIC 互动播放器'
                  : '使用 OpenMAIC 原生 PPT 播放器'}
              </a>
            </p>
            {preview?.html === undefined && (
              <>
                <div className="content-preview">
                  <SlideCanvas
                    slide={canvas(current)}
                    renderImage={(e) => (
                      <img
                        src={`/api/zhiban/content/${tenant}/offerings/${offering}/resources/${unit.target}/assets/${e.src.slice(6)}?source=published&version=${preview!.publicationId}&slide=${current.id}`}
                        alt="课程讲义 PNG"
                        referrerPolicy="same-origin"
                      />
                    )}
                  />
                </div>
                <div className="content-controls">
                  <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    上一页讲义
                  </button>
                  <span>
                    第 {page + 1} / {preview!.slides.length} 页
                  </span>
                  <button
                    disabled={page === preview!.slides.length - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页讲义
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {unit.kind === 'MATERIAL' && (
          <MaterialPreview key={unit.target} tenant={tenant} offering={offering} id={unit.target} />
        )}
        {unit.kind === 'ACTIVITY' && (
          <>
            <p>
              {route.role === 'teacher'
                ? '此处预览已发布任务；请从课堂与互动编辑或从学生成绩评分。'
                : '作答、保存草稿、附件和提交记录沿用本课程原规则。'}
            </p>
            <Activity
              tenant={tenant}
              offering={offering}
              id={unit.target}
              teacher={route.role === 'teacher'}
              status={offeringStatus}
            />
          </>
        )}
      </article>
      <nav className="content-controls" aria-label="单元导航">
        {index > 0 && <a href={href(units[index - 1])}>上一单元</a>}
        {index < units.length - 1 && <a href={href(units[index + 1])}>下一单元</a>}
        <a
          href={`/zhiban/${route.role}/courses/${route.course}?space=${tenant}&offering=${offering}`}
        >
          返回课程目录
        </a>
      </nav>
    </section>
  );
}
