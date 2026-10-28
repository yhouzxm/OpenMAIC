/* Explicit P3 totals and appeals. Every action uses the original session, CSRF and course guards. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('final-grades');
  if (!root) return;
  root.classList.add('academic-form');
  if (window.zhibanCoursePage) {
    const main = document.querySelector('main');
    if (main) {
      const container = document.createElement('div');
      container.className = 'course-panel';
      main.before(container);
      container.append(main, root);
      main.classList.remove('course-panel');
    }
  }
  const params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = params.get('tenant'),
    offering = params.get('offering');
  const uuid = /^[0-9a-f-]{36}$/;
  if (!uuid.test(tenant ?? '') || !uuid.test(offering ?? '')) return;
  const base = `/api/zhiban/assessment/${tenant}/offerings/${offering}/finalgrades`;
  let data = null,
    choices = [],
    draft = [],
    dirty = false,
    busy = false,
    dead = false,
    member = null,
    view = 'TOTALS',
    after = null,
    pending = null,
    controller = null;
  const notes = {};
  let notice = '';
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function changed() {
    dirty = true;
    window.zhibanCoursePage?.setDirty('finalgrade', true, root);
  }
  function label(text, input) {
    const l = el('label', text + ' ');
    input.setAttribute('aria-label', text);
    l.append(input);
    return l;
  }
  function button(text, fn, disabled = false) {
    const b = el('button', text);
    b.type = 'button';
    b.className = 'button secondary';
    b.disabled = disabled || busy || !!pending;
    b.onclick = () => void fn();
    return b;
  }
  function note(key, title, max = 2000) {
    const n = el('textarea');
    n.maxLength = max;
    n.value = notes[key] ?? '';
    n.oninput = () => {
      notes[key] = n.value;
    };
    return label(title, n);
  }
  function select(text, options, value, change) {
    const n = el('select');
    for (const [id, title] of options) {
      const o = el('option', title);
      o.value = id;
      n.append(o);
    }
    n.value = value;
    n.onchange = () => change(n.value);
    return label(text, n);
  }
  async function request(body = null, key = null) {
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const headers = { 'x-zhiban-request': 'identity-v1' };
      if (body) {
        const csrf = await fetch('/api/zhiban/identity/csrf', {
          headers,
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!csrf.ok) throw Object.assign(Error('登录已失效'), { definitive: true, status: 401 });
        headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
        headers['content-type'] = 'application/json';
        headers['x-zhiban-command'] = key;
      }
      const q = new URLSearchParams({ view });
      if (member) q.set('member', member);
      if (after) q.set('after', after);
      const r = await fetch(base + (body ? '' : '?' + q), {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
          signal: controller.signal,
        }),
        v = await r.json();
      if (!r.ok)
        throw Object.assign(
          Error(
            {
              CONFLICT: '记录或成绩来源已变化，请刷新核对；原操作可能已由其他人完成。',
              INVALID_INPUT: '请检查权重合计100%、活动选择和必填说明。',
              INVALID_STATE:
                '条件尚未满足：请确认正式成绩齐全、活动版本有效；重新发布或申诉处理须满足对应条件。',
              FORBIDDEN: '当前任教、选课或账户资格已失效。',
              NOT_FOUND: '该总评或申诉不可访问。',
            }[v.error?.code] ?? '总评暂不可用，请稍后重试。',
          ),
          { definitive: r.status >= 400 && r.status < 500, status: r.status },
        );
      return v;
    } finally {
      clearTimeout(timer);
      controller = null;
    }
  }
  async function load() {
    if (busy || dead) return;
    busy = true;
    root.querySelectorAll('input,button,select,textarea').forEach((n) => (n.disabled = true));
    try {
      data = await request();
      if (dead) return;
      if (data.activities) choices = data.activities;
      if (!dirty) draft = structuredClone(data.draft ?? []);
      draw();
    } catch (e) {
      notice = e.message;
      if ([401, 403].includes(e.status)) {
        data = null;
        choices = [];
        draft = [];
        dirty = false;
        pending = null;
        window.zhibanCoursePage?.setDirty('finalgrade', false);
      }
      draw();
    } finally {
      busy = false;
      if (!dead) draw();
    }
  }
  async function send(command) {
    if (busy || dead) return;
    pending = pending ?? { command, key: crypto.randomUUID() };
    window.zhibanCoursePage?.setDirty('finalgrade', true, root);
    busy = true;
    let refresh = true;
    draw();
    try {
      await request(pending.command, pending.key);
      if (pending.command.type === 'SAVE_WEIGHTS') {
        dirty = false;
        window.zhibanCoursePage?.setDirty('finalgrade', false, root);
      }
      pending = null;
      notice = '操作已确认；发布快照及申诉记录已保留。';
    } catch (e) {
      notice = e.message;
      if (e.status === 409 && pending.command.type === 'SAVE_WEIGHTS') refresh = false;
      if (e.definitive) pending = null;
    } finally {
      busy = false;
      window.zhibanCoursePage?.setDirty('finalgrade', dirty || !!pending, root);
      if (!pending && refresh) await load();
      else draw();
    }
  }
  async function navigate(nextMember, nextView, nextAfter = null) {
    if (pending) return;
    if (dirty && !confirm('权重草稿未保存，放弃未保存的修改并切换？')) return;
    dirty = false;
    window.zhibanCoursePage?.setDirty('finalgrade', false);
    member = nextMember;
    view = nextView;
    after = nextAfter;
    await load();
  }
  function draw() {
    if (dead) return;
    root.replaceChildren(el('h2', '课程总评与成绩申诉'));
    const status = el('p', notice);
    status.setAttribute('role', 'status');
    root.append(status);
    if (pending) {
      const retry = button('重试同一总评操作', () => send(pending.command));
      retry.disabled = busy;
      root.append(retry);
    }
    if (!data) {
      root.append(button('重试读取总评', load));
      return;
    }
    const teacher = data.mode === 'TEACHER';
    root.append(
      el(
        'p',
        `已发布权重版本 ${data.ruleVersion}；缺成绩保持待齐。总评须显式发布，后续变更只标记需重算。`,
      ),
    );
    root.append(
      button('查看总评', () => navigate(null, 'TOTALS')),
      button('查看成绩申诉', () => navigate(null, 'APPEALS')),
      button('刷新总评与申诉', () => navigate(member, view)),
    );
    if (teacher && view === 'TOTALS' && !member) {
      const config = el('section');
      config.append(el('h3', '教学班总评权重'));
      config.append(
        el(
          'p',
          '最多20项正式活动，权重合计100%。保存草稿不改变已发布权重；活动换版须重新绑定并发布。',
        ),
      );
      draft.forEach((item, index) => {
        const r = el('div'),
          opts = choices.map((a) => [a.id, a.title]);
        if (!opts.some(([id]) => id === item.activityId))
          opts.push([item.activityId, '原活动（当前不可用）']);
        r.className = 'learning-activity';
        r.append(
          select('总评活动 ' + (index + 1), opts, item.activityId, (id) => {
            item.activityId = id;
            item.version = Number(choices.find((a) => a.id === id).published_version);
            changed();
            draw();
          }),
        );
        const n = el('input');
        n.type = 'number';
        n.min = '0.01';
        n.max = '100';
        n.step = '0.01';
        n.value = String(item.weightBps / 100);
        n.oninput = () => {
          item.weightBps = Math.round(Number(n.value) * 100);
          changed();
        };
        r.append(
          label('权重百分比 ' + (index + 1), n),
          el('span', '绑定版本 ' + item.version),
          button('重新绑定活动 ' + (index + 1), () => {
            const a = choices.find((a) => a.id === item.activityId);
            if (a) {
              item.version = Number(a.published_version);
              changed();
              draw();
            }
          }),
          button('移除权重 ' + (index + 1), () => {
            draft.splice(index, 1);
            changed();
            draw();
          }),
        );
        config.append(r);
      });
      config.append(
        button(
          '添加总评活动',
          () => {
            const a = choices.find((a) => !draft.some((i) => i.activityId === a.id));
            if (a) {
              draft.push({
                activityId: a.id,
                version: Number(a.published_version),
                weightBps: 10000,
              });
              changed();
              draw();
            }
          },
          draft.length >= 20 || !choices.some((a) => !draft.some((i) => i.activityId === a.id)),
        ),
        button('保存总评权重草稿', () =>
          send({ type: 'SAVE_WEIGHTS', revision: data.revision, items: draft }),
        ),
        button('发布总评权重', () => {
          if (dirty) {
            notice = '请先保存权重草稿。';
            draw();
            return;
          }
          return send({ type: 'PUBLISH_WEIGHTS', revision: data.revision });
        }),
      );
      root.append(config, el('h3', '选择在班学生预览并发布总评'));
      for (const row of data.rows)
        root.append(
          button('总评 · ' + (row.name ?? row.membership_id), () =>
            navigate(row.membership_id, 'TOTALS'),
          ),
        );
    } else if (view === 'APPEALS') {
      root.append(el('h3', teacher ? '教学班成绩申诉' : '我的成绩申诉'));
      for (const appeal of data.rows) {
        const card = el('section');
        card.className = 'learning-activity';
        card.append(
          el(
            'h4',
            `总评第 ${appeal.total_version} 版 · ${Number(appeal.score_points) / 100} / 100 · ${appeal.state === 'OPEN' ? '待处理' : '已处理'}`,
          ),
          el('p', '申诉：' + appeal.body),
        );
        if (teacher)
          card.append(
            el('p', '学生 ' + appeal.membership_id),
            button('查看该学生总评', () => navigate(appeal.membership_id, 'TOTALS')),
          );
        if (appeal.response)
          card.append(
            el('p', '处理说明：' + appeal.response),
            el(
              'p',
              appeal.replacement_id
                ? '已关联重新发布的总评：' + appeal.replacement_id
                : '说明处理；不直接修改成绩。',
            ),
          );
        if (teacher && appeal.state === 'OPEN') {
          card.append(
            note('reply-' + appeal.id, '申诉处理说明 · ' + appeal.id),
            button('说明处理并结案', () =>
              send({
                type: 'RESOLVE_APPEAL',
                id: appeal.id,
                memberId: appeal.membership_id,
                revision: appeal.revision,
                decision: 'EXPLAINED',
                body: notes['reply-' + appeal.id] ?? '',
              }),
            ),
            button('关联已重发总评并结案', () =>
              send({
                type: 'RESOLVE_APPEAL',
                id: appeal.id,
                memberId: appeal.membership_id,
                revision: appeal.revision,
                decision: 'REPLACED',
                body: notes['reply-' + appeal.id] ?? '',
              }),
            ),
          );
        }
        root.append(card);
      }
    } else {
      if (data.needsRecalculation)
        root.append(el('p', '当前来源已变化，已发布总评需重算；旧快照保留。'));
      if (teacher && data.preview) {
        const p = data.preview;
        root.append(
          el('h3', p.ready ? '总评预览：' + p.scorePoints / 100 + ' / 100' : '总评待齐，不能发布'),
        );
        const statuses = {
          READY: '成绩已发布',
          ENROLLMENT_INACTIVE: '选课失效',
          VERSION_UNAVAILABLE: '活动未发布或版本已变化',
          NOT_SUBMITTED: '尚无正式提交',
          AWAITING_GRADE: '等待成绩发布',
        };
        for (const c of p.components)
          root.append(
            el(
              'p',
              `${c.title} · 权重 ${c.weightBps / 100}% · ${statuses[c.status]}${c.status === 'READY' ? ' · ' + c.score / 100 + ' / ' + c.maximum / 100 : ''}`,
            ),
          );
        root.append(
          note('publish-' + member, '总评发布说明', 1000),
          button(
            '发布该学生总评',
            () =>
              send({
                type: 'PUBLISH_TOTAL',
                memberId: member,
                sourceDigest: p.sourceDigest,
                previousId: p.latest?.id ?? null,
                reason: notes['publish-' + member] ?? '',
              }),
            !p.ready,
          ),
        );
      }
      root.append(el('h3', '已发布总评历史'));
      for (const publication of data.rows) {
        const card = el('section');
        card.className = 'learning-activity';
        card.append(
          el(
            'h4',
            `总评第 ${publication.version} 版：${Number(publication.score_points) / 100} / 100`,
          ),
          el(
            'p',
            `权重版本 ${publication.rule_version} · ${new Date(Number(publication.published_at)).toLocaleString()}`,
          ),
          el('p', '发布说明：' + publication.reason),
        );
        for (const c of publication.components)
          card.append(
            el('p', `${c.title} · ${c.weightBps / 100}% · ${c.score / 100} / ${c.maximum / 100}`),
          );
        if (!teacher && !publication.appealed)
          card.append(
            note('appeal-' + publication.id, '申诉理由 · 总评第 ' + publication.version + ' 版'),
            button('提交申诉 · 总评第 ' + publication.version + ' 版', () =>
              send({
                type: 'OPEN_APPEAL',
                publicationId: publication.id,
                body: notes['appeal-' + publication.id] ?? '',
              }),
            ),
          );
        if (publication.appealed)
          card.append(el('p', '该版本已提交申诉，可到“查看成绩申诉”查处理结果。'));
        root.append(card);
      }
    }
    if (!data.rows?.length) root.append(el('p', '当前没有记录。'));
    if (after) root.append(button('返回总评或申诉第一页', () => navigate(member, view)));
    if (data.next) root.append(button('下一页总评或申诉', () => navigate(member, view, data.next)));
    root.querySelectorAll('input,select,textarea').forEach((n) => (n.disabled = busy || !!pending));
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty || pending) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      dead = true;
      controller?.abort();
      data = null;
      pending = null;
      draft = [];
      root.replaceChildren(el('p', '登录状态已变化，请返回工作台。'));
    };
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  window.addEventListener('pagehide', () => {
    dead = true;
    controller?.abort();
    root.replaceChildren();
    channel?.close();
    window.zhibanCoursePage?.setDirty('finalgrade', false);
  });
  await load();
})();
