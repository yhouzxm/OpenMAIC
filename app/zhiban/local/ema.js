/* Six descriptive dimensions reuse Learner publication/disputes; EMA output remains private until teacher action. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('ema'),
    p = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = p.get('tenant'),
    offering = p.get('offering'),
    course = p.get('course'),
    role = p.get('role'),
    mode = role === 'teacher' ? 'TEACHER' : 'STUDENT';
  const uuid = /^[0-9a-f-]{36}$/;
  if (
    ![tenant, offering, course].every((x) => uuid.test(x ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '请从已授权课程进入。';
    return;
  }
  const base = `/api/zhiban/ema/${tenant}/offerings/${offering}`,
    learner = `/api/zhiban/learner/${tenant}/offerings/${offering}`;
  const href = (surface, fragment = '') =>
    `/zhiban/${role}/courses/${course}/${surface}?space=${tenant}&offering=${offering}${fragment}`;
  const controller = new AbortController();
  let selected =
    role === 'teacher' ? (/^#student-([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? null) : null;
  let dirty = false,
    disposed = false,
    generation = 0,
    timer = null,
    dimensions = [],
    name = '',
    cursors = [null],
    page = 0,
    rosterQ = '';
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const text = (parent, s) => parent.append(el('p', s));
  const link = (parent, label, url) => {
    const a = el('a', label);
    a.href = url;
    parent.append(a);
  };
  const clearDirty = () => {
    dirty = false;
    window.zhibanCoursePage?.setDirty('ema-form', false);
  };
  const date = (v) => new Date(Number(v)).toLocaleString('zh-CN');
  async function request(path, command = null, key = null) {
    const headers = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    if (command) {
      const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store', signal });
      if (!r.ok) throw Error('登录已失效，请回工作台。');
      headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
      headers['content-type'] = 'application/json';
      headers['x-zhiban-command'] = key;
    }
    const r = await fetch(path, {
      headers,
      signal,
      cache: 'no-store',
      method: command ? 'POST' : 'GET',
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          r.status === 409
            ? '版本、来源或审阅状态已变化，请刷新核对；输入仍保留。'
            : r.status === 503
              ? '服务或真实模型暂不可用；未知结果请重试同一命令。'
              : r.status === 401 || r.status === 403
                ? '当前账户、任教或本人课程关系不可用。'
                : '请求无效或记录不可访问。',
        ),
        {
          definitive: r.status >= 400 && r.status < 500,
          blocked: [401, 403, 404].includes(r.status),
        },
      );
    return data;
  }
  const get = (args = {}, api = base) =>
    request(
      api +
        '?' +
        new URLSearchParams({
          mode,
          ...(mode === 'TEACHER' && selected && !['ROSTER', 'JOB'].includes(args.view)
            ? { enrollment: selected }
            : {}),
          ...args,
        }),
    );
  function button(parent, label, action) {
    const b = el('button', label);
    b.type = 'button';
    b.onclick = () => {
      if (dirty && !confirm('尚有未保存内容，确定放弃并切换？')) return;
      clearDirty();
      action();
    };
    parent.append(b);
    return b;
  }
  function control(form, label, tag = 'textarea', max = 2000) {
    const n = el(tag);
    n.required = true;
    n.maxLength = max;
    n.setAttribute('aria-label', label);
    const l = el('label', label);
    l.append(n);
    form.append(l);
    return n;
  }
  function select(form, label, options) {
    const n = el('select');
    n.setAttribute('aria-label', label);
    for (const [value, title] of options) {
      const op = el('option', title);
      op.value = value;
      n.append(op);
    }
    const l = el('label', label);
    l.append(n);
    form.append(l);
    return n;
  }
  function mutation(form, label, build, success) {
    const b = el('button', label);
    b.type = 'submit';
    const msg = el('p');
    msg.setAttribute('role', 'status');
    form.append(b, msg);
    let pending = null,
      busy = false;
    const changed = () => {
      dirty = true;
      window.zhibanCoursePage?.setDirty('ema-form', true, form);
    };
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy || disposed) return;
      try {
        pending ??= { command: build(), key: crypto.randomUUID() };
      } catch (e) {
        msg.textContent = e.message;
        return;
      }
      busy = true;
      changed();
      root.inert = true;
      root.setAttribute('aria-busy', 'true');
      try {
        const r = await request(base, pending.command, pending.key);
        pending = null;
        clearDirty();
        await success(r);
      } catch (e) {
        msg.textContent = e.message;
        if (e.definitive) pending = null;
        b.textContent = pending ? '重试同一命令' : label;
        for (const c of form.querySelectorAll('input,textarea,select'))
          c.disabled = !!pending || e.blocked;
      } finally {
        busy = false;
        root.inert = false;
        root.setAttribute('aria-busy', 'false');
      }
    };
  }
  function header() {
    root.append(el('h1', '六维证据画像与 EMA'));
    text(
      root,
      '每维只呈现有来源的具体观察。未有观察或证据不足不代表能力不足，不生成能力分、排名或心理诊断。',
    );
    if (name) root.append(el('h2', name));
    const nav = el('nav');
    nav.className = 'actions';
    if (mode === 'TEACHER')
      button(nav, '选择学生', () => {
        selected = null;
        cursors = [null];
        page = 0;
        roster();
      });
    if (selected || mode === 'STUDENT') {
      button(nav, '六维画像', () => show('DIMENSIONS'));
      if (mode === 'TEACHER') {
        button(nav, '新增维度观察', () => editor());
        button(nav, 'EMA 分析作业', () => show('JOBS'));
        button(nav, '新建 EMA 作业', queue);
      }
    }
    link(
      nav,
      '学习观察与本人纠错',
      href('learning-profile', selected ? '#student-' + selected : ''),
    );
    root.append(nav);
  }
  function reset() {
    clearTimeout(timer);
    generation++;
    root.replaceChildren();
    root.setAttribute('aria-busy', 'true');
    return generation;
  }
  function error(e) {
    const msg = el('p', e.message);
    msg.className = 'notice';
    msg.setAttribute('role', 'alert');
    root.append(msg);
    root.setAttribute('aria-busy', 'false');
  }
  function pager(data, again) {
    const nav = el('nav');
    nav.className = 'actions';
    if (page)
      button(nav, '上一页', () => {
        page--;
        again();
      });
    text(nav, '第 ' + (page + 1) + ' 页');
    if (data.next)
      button(nav, '下一页', () => {
        cursors[++page] = data.next;
        again();
      });
    root.append(nav);
  }
  async function roster() {
    const g = reset();
    header();
    try {
      const data = await get(
        { view: 'ROSTER', q: rosterQ, ...(cursors[page] ? { cursor: cursors[page] } : {}) },
        learner,
      );
      if (g !== generation) return;
      const f = el('form'),
        q = control(f, '搜索学生', 'input', 120);
      q.required = false;
      q.value = rosterQ;
      const b = el('button', '搜索');
      f.append(b);
      f.onsubmit = (e) => {
        e.preventDefault();
        rosterQ = q.value;
        cursors = [null];
        page = 0;
        roster();
      };
      root.append(f);
      for (const r of data.rows)
        button(root, r.student_name, () => {
          selected = r.id;
          name = r.student_name;
          history.replaceState(
            null,
            '',
            location.pathname + location.search + '#student-' + selected,
          );
          show('DIMENSIONS');
        });
      if (!data.rows.length) text(root, '暂无可选的当前学生。');
      pager(data, roster);
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      error(e);
    }
  }
  const states = {
    QUEUED: '待运行',
    RUNNING: '分析中',
    READY: '待教师审阅',
    FAILED: '运行失败',
    STALE: '来源已变化',
    CANCELLED: '已取消',
  };
  async function show(next = 'DIMENSIONS', d = null, keep = false) {
    if (!keep) {
      cursors = [null];
      page = 0;
    }
    const g = reset();
    header();
    try {
      const data = await get({
        view: next,
        ...(d ? { dimension: d } : {}),
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (g !== generation) return;
      dimensions = data.dimensions;
      selected = data.enrollmentId;
      if (next === 'DIMENSIONS') {
        const grid = el('div');
        grid.className = 'dimension-grid';
        for (const d of dimensions) {
          const card = el('section'),
            count = data.counts.find((c) => c.dimension === d.id);
          card.append(el('h2', d.title));
          text(card, d.definition);
          text(
            card,
            count?.published
              ? `${count.published} 条教师已发布观察；请核对引用是否仍有效。`
              : '尚无教师已发布观察 · 当前不作能力结论',
          );
          button(card, '查看' + d.title, () => show('NOTES', d.id));
          grid.append(card);
        }
        root.append(grid);
      } else if (next === 'NOTES') {
        root.append(el('h2', dimensions.find((x) => x.id === d)?.title));
        for (const n of data.rows) {
          const card = el('section');
          card.append(el('h3', n.title));
          text(card, n.body);
          text(
            card,
            `${n.state === 'DRAFT' ? '教师草稿' : n.state === 'WITHDRAWN' ? '已撤回' : '教师已发布'} · ${n.evidence.fresh ? '引用仍一致' : '引用已变化或不可用，需教师核对'} · ${n.confidence === 'LIMITED' ? '证据有限' : '教师声明支持本次观察'}`,
          );
          link(
            card,
            mode === 'TEACHER' ? '审核、发布与修订' : '查看证据、历史与提出本人纠错',
            href('learning-profile', '#note-' + n.id),
          );
          root.append(card);
        }
        if (!data.rows.length) text(root, '本维当前没有可见观察；证据不足，不据此评价能力。');
        pager(data, () => show(next, d, true));
      } else {
        root.append(el('h2', 'EMA 分析作业'));
        text(
          root,
          '仅分析教师选定的固定公开证据。预约到期后由当前任教教师点击运行；不保存教师凭据或离线代行授权。模型建议和拒绝理由仅任教教师可见。',
        );
        text(
          root,
          data.capability?.ready
            ? `真实模型已配置：${data.capability.provider} / ${data.capability.model}`
            : '真实模型尚未配置，可以准备范围，运行不可用。',
        );
        for (const j of data.rows) {
          const card = el('section');
          card.append(el('h3', j.purpose));
          text(
            card,
            `${j.state === 'READY' ? `教师已审阅 ${j.reviewed}/6 维` : states[j.state]} · 到期 ${date(j.due_at)}`,
          );
          button(card, '查看作业', () => job(j.id));
          root.append(card);
        }
        if (!data.rows.length) text(root, '尚无分析作业。');
        pager(data, () => show(next, null, true));
      }
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      error(e);
    }
  }
  async function evidencePicker(form, refs = null) {
    let cursor = null;
    const choices = [];
    const box = el('fieldset');
    box.append(el('legend', '选择 1–5 条固定公开证据'));
    form.append(box);
    async function load() {
      const data = await get({ view: 'EVIDENCE', ...(cursor ? { cursor } : {}) }, learner);
      for (const s of data.rows) {
        if (refs && !refs.some((r) => r.kind === s.kind && r.id === s.id && r.digest === s.digest))
          continue;
        const check = el('input');
        check.type = 'checkbox';
        check.setAttribute('aria-label', s.snapshot.title + ' · ' + s.kind);
        const label = el('label', `${s.kind} · ${s.snapshot.title} · ${s.id}`);
        label.prepend(check);
        box.append(label);
        const details = el('details');
        details.append(
          el('summary', '查看固定证据'),
          el('pre', JSON.stringify(s.snapshot, null, 2)),
        );
        box.append(details);
        choices.push({ check, ref: { kind: s.kind, id: s.id, digest: s.digest } });
      }
      cursor = data.next;
      more.hidden = !cursor;
    }
    const more = el('button', '加载更多来源');
    more.type = 'button';
    box.append(more);
    more.onclick = () => load().catch(error);
    await load();
    return () => {
      const selected = choices.filter((x) => x.check.checked).map((x) => x.ref);
      if (!selected.length || selected.length > 5) throw Error('请选择 1–5 条证据。');
      return selected;
    };
  }
  async function editor(jobData = null, finding = null) {
    const g = reset();
    header();
    try {
      if (!dimensions.length) dimensions = (await get()).dimensions;
      const form = el('form');
      form.append(el('h2', finding ? '审阅采用为观察草稿' : '登记维度观察草稿'));
      const d = select(
        form,
        '观察维度',
        dimensions.map((d) => [d.id, d.title]),
      );
      if (finding) {
        d.value = finding.dimension;
        d.disabled = true;
      }
      const title = control(form, '观察标题', 'input', 120),
        body = control(form, '观察内容'),
        confidence = select(form, '教师证据声明', [
          ['LIMITED', '证据有限'],
          ['SUPPORTED', '引用可支持本次具体观察'],
        ]);
      if (finding) {
        title.value = dimensions.find((d) => d.id === finding.dimension).title + ' · 教师审阅';
        body.value = finding.observation;
      }
      const allowed = finding ? finding.evidence.map((i) => jobData.job.evidence[i - 1]) : null;
      const refs = await evidencePicker(form, allowed);
      if (g !== generation) return;
      let reason = null;
      if (finding) reason = control(form, '教师采用理由', 'textarea', 1000);
      text(
        form,
        '保存只创建草稿。请进入原观察页核对证据并显式发布，学生才能看到；本人纠错沿用原流程。',
      );
      mutation(
        form,
        '保存观察草稿',
        () => {
          const content = {
            title: title.value,
            body: body.value,
            confidence: confidence.value,
            evidence: refs(),
          };
          return finding
            ? {
                type: 'ADOPT',
                id: jobData.job.id,
                revision: jobData.job.revision,
                dimension: finding.dimension,
                text: content,
                reason: reason.value,
              }
            : {
                type: 'CREATE_OBSERVATION',
                enrollmentId: selected,
                dimension: d.value,
                text: content,
              };
        },
        async (r) => {
          location.href = href('learning-profile', '#note-' + (r.noteId ?? r.id));
        },
      );
      root.append(form);
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      error(e);
    }
  }
  async function queue() {
    const g = reset();
    header();
    try {
      const f = el('form');
      f.append(el('h2', '新建 EMA 证据分析'));
      const purpose = control(f, '分析目的', 'textarea', 1000),
        due = control(f, '预约时间（可留空立即运行）', 'input');
      due.type = 'datetime-local';
      due.required = false;
      const refs = await evidencePicker(f);
      if (g !== generation) return;
      text(
        f,
        '只发送所选来源的公开快照。不包含未提交答案、评分草稿、教师私有记录、Tutor 或 Peer 私聊。六维不打分；创建后须任教教师运行。',
      );
      mutation(
        f,
        '创建固定范围作业',
        () => ({
          type: 'QUEUE',
          enrollmentId: selected,
          purpose: purpose.value,
          dueAt: due.value ? new Date(due.value).getTime() : null,
          evidence: refs(),
        }),
        (r) => job(r.id),
      );
      root.append(f);
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      error(e);
    }
  }
  async function job(id) {
    const g = reset();
    header();
    try {
      const data = await get({ view: 'JOB', id });
      if (g !== generation) return;
      selected = data.enrollmentId;
      dimensions = data.dimensions;
      const j = data.job;
      root.append(el('h2', j.purpose));
      text(root, `${states[j.state]} · 版本 ${j.revision} · 预约 ${date(j.due_at)}`);
      text(root, '固定证据 ' + j.source_digest + ' · 提示词 ' + j.prompt_version);
      if (j.model) text(root, '实际模型 ' + j.model.provider + ' / ' + j.model.model);
      if (!data.fresh) text(root, '固定来源已变化或不可用：不能采用，请重新选择证据创建新作业。');
      for (const [index, s] of j.evidence.entries()) {
        const details = el('details');
        details.append(
          el('summary', `证据 ${index + 1} · ${s.kind}`),
          el('pre', JSON.stringify(s.snapshot, null, 2)),
        );
        root.append(details);
      }
      function action(label, type) {
        const f = el('form');
        mutation(
          f,
          label,
          () => ({ type, id, revision: j.revision }),
          () => job(id),
        );
        root.append(f);
      }
      if (j.state === 'QUEUED') {
        if (Number(j.due_at) <= Date.now() && data.capability?.ready && data.fresh)
          action('运行真实模型分析', 'RUN');
        else text(root, '到期且模型、来源均可用后才能运行。');
        action('取消作业', 'CANCEL');
      }
      if (j.state === 'RUNNING') {
        action('取消分析', 'CANCEL');
        if (Number(j.started_at) + 120000 < Date.now()) action('关闭超时作业', 'EXPIRE');
        timer = setTimeout(() => {
          if (!dirty && !disposed && g === generation) job(id);
        }, 2000);
      }
      if (j.failure) text(root, '运行状态：' + j.failure + '；失败不产生画像或发布。');
      for (const f of j.result ?? []) {
        const card = el('section');
        card.append(el('h3', dimensions.find((d) => d.id === f.dimension).title));
        text(
          card,
          (f.state === 'INSUFFICIENT' ? '现有范围证据不足' : 'AI 有限建议，待教师核对') +
            ' · 引用 ' +
            (f.evidence.join('、') || '无'),
        );
        text(card, f.observation);
        const review = data.reviews.find((r) => r.dimension === f.dimension);
        if (review) {
          text(
            card,
            (review.decision === 'ADOPT' ? '已采用为草稿' : '已拒绝') + '：' + review.reason,
          );
          if (review.note_id)
            link(
              card,
              '查看观察草稿／发布与纠错',
              href('learning-profile', '#note-' + review.note_id),
            );
        } else if (j.state === 'READY') {
          if (data.fresh && f.state !== 'INSUFFICIENT')
            button(card, '审阅采用' + dimensions.find((d) => d.id === f.dimension).title, () =>
              editor(data, f),
            );
          const reject = el('form'),
            reason = control(reject, '拒绝理由 · ' + f.dimension, 'textarea', 1000);
          mutation(
            reject,
            '拒绝本维建议',
            () => ({
              type: 'REJECT',
              id,
              revision: j.revision,
              dimension: f.dimension,
              reason: reason.value,
            }),
            () => job(id),
          );
          card.append(reject);
        }
        root.append(card);
      }
      if (data.rows.length) {
        const details = el('details');
        details.append(el('summary', '作业审计（最近20条）'));
        for (const e of data.rows)
          text(details, `${date(e.created_at)} · ${e.action} · v${e.revision}`);
        root.append(details);
      }
      root.setAttribute('aria-busy', 'false');
    } catch (e) {
      error(e);
    }
  }
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      clearDirty();
    },
    { once: true },
  );
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('zhiban-session') : null;
  channel?.addEventListener('message', (e) => {
    if (['logout', 'session-changed'].includes(e.data?.type ?? e.data)) {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      clearDirty();
      root.replaceChildren(el('p', '登录状态已变化，请返回工作台重新确认。'));
    }
  });
  window.addEventListener('pagehide', () => channel?.close(), { once: true });
  if (mode === 'TEACHER' && !selected) await roster();
  else await show();
})().catch((e) => {
  document.getElementById('ema').textContent = '无法加载六维证据：' + e.message;
});
