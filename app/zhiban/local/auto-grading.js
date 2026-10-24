(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const p = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = p.get('tenant'),
    offering = p.get('offering'),
    role = p.get('role'),
    mode = role === 'teacher' ? 'TEACHER' : 'STUDENT',
    root = document.getElementById('auto-grading');
  if (
    ![tenant, offering].every((x) => /^[0-9a-f-]{36}$/.test(x ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '请从已授权课程进入。';
    return;
  }
  const base = `/api/zhiban/autograde/${tenant}/offerings/${offering}`,
    el = (tag, s) => {
      const n = document.createElement(tag);
      if (s !== undefined) n.textContent = s;
      return n;
    },
    text = (p, s) => p.append(el('p', s));
  let view = 'POLICIES',
    timer = null,
    busy = false;
  const abort = new AbortController();
  window.addEventListener(
    'pagehide',
    () => {
      abort.abort();
      clearTimeout(timer);
    },
    { once: true },
  );
  root.append(el('h1', '受限 AI 正式评分'));
  text(
    root,
    '教师显式启用固定版本、模型和评分规则后，新提交由独立 AI 服务正式评分。仅支持文本作答和含简答的正式测验；不覆盖既有成绩。失败保留人工处理，学生可以申诉，教师更正须填写公开原因。',
  );
  const nav = el('nav'),
    alert = el('p'),
    list = el('div');
  alert.setAttribute('role', 'alert');
  root.append(nav, alert, list);
  async function req(c = null, key = null, args = {}) {
    const h = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    if (c) {
      const r = await fetch('/api/zhiban/identity/csrf', { headers: h, signal });
      if (!r.ok) throw Error('登录已失效');
      h['x-zhiban-csrf'] = (await r.json()).csrfToken;
      h['content-type'] = 'application/json';
      h['x-zhiban-command'] = key;
    }
    const r = await fetch(base + (c ? '' : '?' + new URLSearchParams({ mode, view, ...args })), {
        method: c ? 'POST' : 'GET',
        headers: h,
        signal,
        cache: 'no-store',
        ...(c ? { body: JSON.stringify(c) } : {}),
      }),
      v = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 409
          ? '版本、任务或授权已变化，请刷新核对；输入仍保留。'
          : r.status === 503
            ? '真实模型或服务暂不可用，请重试或走人工评分。'
            : '当前请求不可用，请核对课程授权与输入。',
      );
    return v;
  }
  function button(parent, title, fn) {
    const b = el('button', title);
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        alert.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    parent.append(b);
    return b;
  }
  function input(f, label, value = '', tag = 'textarea') {
    const l = el('label', label),
      n = el(tag);
    n.setAttribute('aria-label', label);
    n.required = true;
    n.value = value;
    l.append(n);
    f.append(l);
    return n;
  }
  function form(parent, label, fields, make) {
    const f = el('form'),
      i = fields(f);
    let pending = null;
    f.oninput = () => {
      pending = null;
      window.zhibanCoursePage?.setDirty('auto-form', true, f);
    };
    const b = el('button', label);
    b.type = 'submit';
    f.append(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      b.disabled = true;
      try {
        if (!pending) pending = { c: make(i), key: crypto.randomUUID() };
        await req(pending.c, pending.key);
        window.zhibanCoursePage?.setDirty('auto-form', false);
        await load();
      } catch (e) {
        alert.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    parent.append(f);
    return f;
  }
  for (const [v, title] of [
    ['POLICIES', '评分规则'],
    ['JOBS', mode === 'TEACHER' ? '服务任务' : '本人成绩与申诉'],
    ['APPEALS', '申诉记录'],
  ])
    button(nav, title, async () => {
      view = v;
      await load();
    });
  async function load(cursor = null) {
    if (busy) return;
    busy = true;
    try {
      const r = await req(null, null, cursor ? { cursor } : {});
      if (!cursor) list.replaceChildren();
      if (view === 'POLICIES' && mode === 'TEACHER')
        text(
          list,
          r.capability?.ready
            ? `实际模型：${r.capability.provider} / ${r.capability.model}`
            : '未配置可用真实模型，不能启用正式评分。',
        );
      for (const x of r.rows) {
        const card = el('section');
        card.append(el('h2', x.title ?? (view === 'APPEALS' ? '成绩申诉' : '服务任务')));
        list.append(card);
        if (view === 'POLICIES') {
          const active = x.enabled && x.activity_version === x.published_version;
          text(
            card,
            active
              ? `已启用 · ${x.provider} / ${x.model} · 固定版本 ${x.activity_version}`
              : '未启用／活动版本已变化',
          );
          if (x.rubric) text(card, '评分规则：' + x.rubric);
          if (
            mode === 'TEACHER' &&
            (x.activity_type === 'TEXT_RESPONSE' || x.mode === 'ASSESSED')
          ) {
            form(
              card,
              '启用／更新自动正式评分',
              (f) => ({
                rubric: input(f, '固定评分规则', x.rubric ?? ''),
                max: input(
                  f,
                  '满分',
                  String((x.max_points ?? x.quiz_max_points ?? 10000) / 100),
                  'input',
                ),
              }),
              (i) => ({
                type: 'ENABLE',
                activityId: x.id,
                activityVersion: x.published_version,
                revision: x.revision,
                rubric: i.rubric.value,
                maxPoints: Math.round(Number(i.max.value) * 100),
              }),
            );
            if (x.enabled)
              button(card, '停用自动评分', async () => {
                await req(
                  { type: 'DISABLE', activityId: x.id, revision: x.revision },
                  crypto.randomUUID(),
                );
                await load();
              });
          }
        } else if (view === 'JOBS' && mode === 'TEACHER') {
          const state = x.request_state === 'PENDING' ? 'PENDING' : (x.state ?? x.request_state);
          text(card, `${x.student_name} · ${state} ${x.failure ?? ''}`);
          if (x.model) text(card, `实际模型：${x.model.provider} / ${x.model.model}`);
          if (state === 'RUNNING')
            button(card, '取消本次服务任务', async () => {
              await req(
                { type: 'CANCEL', id: x.job_id, revision: x.revision },
                crypto.randomUUID(),
              );
              await load();
            });
          if (x.request_state === 'FAILED')
            button(card, '按当前规则重新排队', async () => {
              await req({ type: 'RETRY', submissionId: x.id }, crypto.randomUUID());
              await load();
            });
          const a = el('a', '原人工评分与更正');
          a.href = `/zhiban/teacher/courses/${p.get('course')}/grades?space=${tenant}&offering=${offering}&submission=${x.id}`;
          card.append(a);
        } else if (view === 'JOBS') {
          text(
            card,
            `${x.score_points / 100} / ${x.max_points / 100} · AI 服务正式评分版本 ${x.version}`,
          );
          text(card, x.feedback);
          if (x.latest_version > x.version)
            text(
              card,
              `此 AI 历史评分已被更正；当前正式成绩 ${x.latest_score_points / 100}，版本 ${x.latest_version}，可从课程成绩查看公开更正依据。`,
            );
          if (!x.appealed)
            form(
              card,
              '提交本人成绩申诉',
              (f) => input(f, '申诉说明'),
              (i) => ({ type: 'OPEN_APPEAL', publicationId: x.id, body: i.value }),
            );
          else text(card, '已提出申诉，可在申诉记录查看。');
        } else {
          text(card, x.body);
          text(card, x.state === 'OPEN' ? '待教师处理' : '已处理：' + (x.response ?? ''));
          if (mode === 'TEACHER' && x.state === 'OPEN')
            form(
              card,
              '回复并结案',
              (f) => ({
                response: input(f, '公开处理说明'),
                replacement: input(f, '原成绩更正后的发布编号（仅解释可留空）', '', 'input'),
              }),
              (i) => ({
                type: 'RESOLVE_APPEAL',
                id: x.id,
                revision: x.revision,
                response: i.response.value,
                replacementId: i.replacement.value.trim() || null,
              }),
            ).querySelector('input').required = false;
        }
      }
      if (!r.rows.length) text(list, '暂无记录。');
      if (r.next) button(list, '更多', () => load(r.next));
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      alert.textContent = e.message;
    } finally {
      busy = false;
    }
  }
  button(nav, '刷新', () => load());
  await load();
})();
