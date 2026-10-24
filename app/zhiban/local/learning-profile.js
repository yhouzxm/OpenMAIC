/* Published plan text is public to its recipient; self reports never replace Learning evidence. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('learner'),
    params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = params.get('tenant'),
    offering = params.get('offering'),
    course = params.get('course'),
    role = params.get('role'),
    mode = role === 'teacher' ? 'TEACHER' : 'STUDENT';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    ![tenant, offering, course].every((v) => uuid.test(v ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '课程地址无效，请从工作台进入。';
    return;
  }
  const base = `/api/zhiban/learner/${tenant}/offerings/${offering}`,
    context = `space=${tenant}&offering=${offering}`;
  const href = (part) => `/zhiban/${role}/courses/${course}/${part}?${context}`;
  let generation = 0,
    disposed = false,
    dirtyKey = null,
    cursors = [null],
    page = 0;
  const controller = new AbortController();
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const date = (value) =>
    value === null || value === undefined
      ? '未设置'
      : new Date(Number(value)).toLocaleString('zh-CN');
  const clearDirty = () => {
    if (dirtyKey) window.zhibanCoursePage?.setDirty(dirtyKey, false);
    dirtyKey = null;
  };
  function reset() {
    generation++;
    clearDirty();
    root.replaceChildren();
    root.setAttribute('aria-busy', 'true');
    return generation;
  }
  function notice(error) {
    const p = el('p', error.message ?? String(error), 'notice');
    p.setAttribute('role', 'alert');
    root.append(p);
    root.setAttribute('aria-busy', 'false');
  }
  async function request(path, command = null, key = null) {
    const headers = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    if (command) {
      const c = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store', signal });
      if (!c.ok)
        throw Object.assign(Error('登录已失效，请返回工作台。'), {
          definitive: true,
          blocked: true,
        });
      headers['x-zhiban-csrf'] = (await c.json()).csrfToken;
      headers['x-zhiban-command'] = key;
      headers['content-type'] = 'application/json';
    }
    const r = await fetch(path, {
      headers,
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      signal,
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          r.status === 409
            ? '观察、引用证据或纠错请求已变化，或已有待处理请求。输入保留，请核对最新记录。'
            : r.status === 401 || r.status === 403
              ? '账户、角色或课程关系已变化，不能继续访问或发布。'
              : r.status === 404
                ? '该画像观察或纠错请求不可访问。'
                : r.status === 400
                  ? '请检查证据引用与必填内容。'
                  : '服务暂不可用；提交结果不确定时请重试同一命令。',
        ),
        {
          definitive: r.status >= 400 && r.status < 500,
          blocked: [401, 403, 404].includes(r.status),
        },
      );
    return data;
  }
  let enrollmentId = null;
  const read = (args = {}) =>
    request(
      base +
        '?' +
        new URLSearchParams({
          mode,
          ...(mode === 'TEACHER' &&
          enrollmentId &&
          !['ROSTER', 'NOTE', 'DISPUTE'].includes(args.view)
            ? { enrollment: enrollmentId }
            : {}),
          ...args,
        }),
    );
  function button(name, action, parent = root) {
    const b = el('button', name);
    b.type = 'button';
    b.onclick = action;
    parent.append(b);
    return b;
  }
  function label(name, control) {
    control.setAttribute('aria-label', name);
    const l = el('label', name);
    l.append(control);
    return l;
  }
  function textControl(max, area = false) {
    const n = el(area ? 'textarea' : 'input');
    n.maxLength = max;
    n.required = true;
    return n;
  }
  function selectControl(options) {
    const s = el('select');
    for (const [value, name] of options) {
      const op = el('option', name);
      op.value = value;
      s.append(op);
    }
    return s;
  }
  function mutationForm(form, name, build, success) {
    const submit = el('button', name);
    submit.type = 'submit';
    const msg = el('p', '', 'notice');
    msg.setAttribute('role', 'status');
    form.append(submit, msg);
    let pending = null,
      busy = false;
    const key = 'learner-' + crypto.randomUUID();
    const dirty = () => {
      dirtyKey = key;
      window.zhibanCoursePage?.setDirty(key, true, form);
    };
    form.addEventListener('input', dirty);
    form.addEventListener('change', dirty);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || disposed) return;
      try {
        pending ||= { key: crypto.randomUUID(), command: build() };
      } catch (error) {
        msg.textContent = error.message;
        return;
      }
      busy = true;
      dirty();
      const controls = [...form.querySelectorAll('input,textarea,select,button')];
      controls.forEach((n) => (n.disabled = true));
      try {
        const result = await request(base, pending.command, pending.key);
        if (disposed) return;
        pending = null;
        clearDirty();
        await success(result);
      } catch (error) {
        if (disposed) return;
        msg.textContent = error.message;
        if (error.definitive) pending = null;
        submit.textContent = pending ? '重试同一命令' : name;
        if (!error.blocked) {
          controls.forEach((n) => (n.disabled = !!pending));
          submit.disabled = false;
        }
      } finally {
        busy = false;
      }
    };
    root.append(form);
  }
  function link(name, url, parent = root) {
    const a = el('a', name, 'button secondary');
    a.href = url;
    parent.append(a);
  }
  const states = {
    DRAFT: '教师草稿',
    PUBLISHED: '已发布学习观察',
    WITHDRAWN: '已撤回学习观察',
    OPEN: '待教师处理',
    RESOLVED: '已处理',
  };
  const kinds = {
    GRADE: '正式成绩记录',
    CONCEPT: '教师概念判断',
    REMEDIATION: '教师补救安排／评价',
  };
  const confidences = { LIMITED: '教师注明：证据有限', SUPPORTED: '教师注明：引用可支持本次观察' };
  const actions = {
    CREATE_OBSERVATION: '登记观察草稿',
    EDIT_DRAFT: '修订草稿',
    PUBLISH_OBSERVATION: '发布学习观察',
    REVISE_PUBLIC: '修订公开观察',
    WITHDRAW_OBSERVATION: '撤回学习观察',
    DISPUTE_REVISE: '因本人纠错修订',
    DISPUTE_WITHDRAW: '因本人纠错撤回',
    OPEN_DISPUTE: '本人提出纠错',
    APPEND_DISPUTE: '本人补充纠错',
    RESOLVE_DISPUTE: '教师处理纠错',
  };
  let currentView = mode === 'TEACHER' ? 'ROSTER' : 'OVERVIEW',
    studentName = '',
    queryText = '',
    stateFilter = 'ALL',
    kindFilter = 'ALL';
  const setContext = (data) => {
    if (data.enrollment) {
      enrollmentId = data.enrollment.id;
      studentName = data.enrollment.studentName;
    }
  };
  const restart = () => {
    cursors = [null];
    page = 0;
  };
  function header(title) {
    root.append(
      el('h1', title),
      el(
        'p',
        '这里保留可追溯证据、教师发布与本人纠错。六维分类及 EMA 在课程“六维证据与 EMA”查看，不计算能力分或排名。',
        'notice',
      ),
    );
    if (studentName) root.append(el('h2', studentName + ' · 本次入班记录'));
    const nav = el('nav', undefined, 'actions');
    nav.setAttribute('aria-label', '学习证据画像视图');
    if (mode === 'TEACHER')
      button(
        '选择学生',
        () => {
          enrollmentId = null;
          studentName = '';
          show('ROSTER', true);
        },
        nav,
      );
    if (mode === 'STUDENT' || enrollmentId)
      for (const [v, n] of [
        ['OVERVIEW', '证据画像'],
        ['EVIDENCE', '来源证据'],
        ['NOTES', '学习观察'],
        ['DISPUTES', '本人纠错记录'],
      ])
        button(n, () => show(v, true), nav);
    link(
      '六维证据与 EMA',
      href('evidence-profile') + (enrollmentId ? '#student-' + enrollmentId : ''),
      nav,
    );
    root.append(nav);
  }
  function sourceCard(kind, s, parent = root) {
    const box = el('section', undefined, 'evidence');
    box.append(el('h3', kinds[kind] + ' · ' + s.title));
    if (kind === 'GRADE') {
      box.append(
        el(
          'p',
          `正式成绩 ${Number(s.scorePoints) / 100} / ${Number(s.maxPoints) / 100} · 活动版本 ${s.activityVersion} · 正式发布版本 ${s.publicationVersion}`,
        ),
      );
      box.append(el('p', '仅证明这次正式作答的表现，不能单独证明稳定能力。'));
      link('查看课程成绩记录', href('grades'), box);
    } else if (kind === 'CONCEPT') {
      box.append(
        el(
          'p',
          `教师判断 · ${s.state === 'OPEN' ? '待澄清' : s.state === 'RESOLVED' ? '本次已纠正' : '已撤回'} · 版本 ${s.revision}`,
        ),
        el('p', s.explanation, 'prose'),
        el('p', s.guidance, 'prose'),
      );
      if (s.sourcePublicationCurrent === false)
        box.append(
          el('p', '原概念判断引用的成绩后来已有正式更正；请结合其判断版本与新成绩核对。', 'notice'),
        );
      link('查看概念纠错记录', href('concepts') + '#correction-' + (s.id ?? ''), box);
    } else {
      box.append(el('p', s.goal, 'prose'), el('p', `计划状态 ${s.state} · 版本 ${s.revision}`));
      if (s.teacherOutcome)
        box.append(
          el(
            'p',
            '教师评估：' +
              (s.teacherOutcome === 'ACHIEVED' ? '本次目标已达到' : '仍需继续') +
              '；' +
              s.teacherReview,
            'prose',
          ),
        );
      box.append(el('p', '安排或人工评估不替代原作答、成绩，也不等于系统认证掌握。'));
      link('查看补救计划', href('remediation') + '#plan-' + (s.id ?? ''), box);
    }
    const d = el('details');
    d.append(el('summary', '查看来源与版本引用'), el('p', JSON.stringify(s, null, 2), 'prose'));
    box.append(d);
    parent.append(box);
  }
  function references(e, parent = root) {
    parent.append(
      el(
        'p',
        e.fresh
          ? '全部引用仍与当前记录一致。'
          : '引用依据已变化或不在当前范围；固定依据保留，请核对后修订或撤回。',
        'notice',
      ),
    );
    for (const r of e.citations) {
      const wrap = el('section');
      wrap.append(
        el('h3', r.unchanged && r.eligible ? '固定依据仍有效' : '固定依据与当前记录有差异'),
      );
      sourceCard(r.kind, { ...r.original, id: r.id }, wrap);
      if (!r.unchanged) {
        const d = el('details');
        d.append(el('summary', '查看当前来源对照'));
        sourceCard(r.kind, { ...r.current, id: r.id }, d);
        wrap.append(d);
      }
      parent.append(wrap);
    }
  }
  function paging(next, loader) {
    const nav = el('div', undefined, 'actions');
    if (page > 0)
      button(
        '上一页',
        () => {
          page--;
          loader();
        },
        nav,
      );
    if (next)
      button(
        '下一页',
        () => {
          cursors[page + 1] = next;
          page++;
          loader();
        },
        nav,
      );
    root.append(nav);
  }
  function filters(view) {
    const form = el('form'),
      q = textControl(120);
    q.required = false;
    q.value = queryText;
    form.append(label(view === 'ROSTER' ? '搜索本班学生' : '搜索来源或观察标题', q));
    let state = null,
      kind = null;
    if (view === 'NOTES' || view === 'DISPUTES') {
      state = selectControl([
        ['ALL', '全部状态'],
        ...(view === 'NOTES' ? ['DRAFT', 'PUBLISHED', 'WITHDRAWN'] : ['OPEN', 'RESOLVED'])
          .filter((k) => mode === 'TEACHER' || k !== 'DRAFT')
          .map((k) => [k, states[k]]),
      ]);
      state.value = stateFilter;
      form.append(label('记录状态', state));
    }
    if (view === 'EVIDENCE') {
      kind = selectControl([['ALL', '全部来源'], ...Object.entries(kinds)]);
      kind.value = kindFilter;
      form.append(label('证据类型', kind));
    }
    const b = el('button', '查询');
    b.type = 'submit';
    form.append(b);
    form.onsubmit = (e) => {
      e.preventDefault();
      queryText = q.value;
      stateFilter = state?.value ?? 'ALL';
      kindFilter = kind?.value ?? 'ALL';
      show(view, true);
    };
    root.append(form);
  }
  async function show(view = currentView, fresh = false) {
    if (view !== currentView) {
      queryText = '';
      stateFilter = 'ALL';
      kindFilter = 'ALL';
    }
    currentView = view;
    if (fresh) {
      restart();
      history.replaceState(
        null,
        '',
        location.pathname + location.search + (enrollmentId ? '#student-' + enrollmentId : ''),
      );
    }
    const gen = reset();
    header(view === 'ROSTER' ? '选择本班学生' : '学习证据画像');
    if (view !== 'OVERVIEW') filters(view);
    try {
      const data = await read({
        view,
        ...(view !== 'OVERVIEW' ? { q: queryText, state: stateFilter, kind: kindFilter } : {}),
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (gen !== generation || disposed) return;
      setContext(data);
      if (view === 'OVERVIEW') {
        root.append(el('h2', studentName + ' · 可核对的证据范围'));
        for (const [k, n] of Object.entries(kinds)) {
          const r = data.rows.find((r) => r.kind === k);
          root.append(el('p', `${n}：${r?.count ?? 0} 条当前可用来源`));
        }
        root.append(
          el(
            'p',
            `已发布学习观察 ${data.observations.published} 条；已撤回 ${data.observations.withdrawn} 条。`,
          ),
          el(
            'p',
            '没有证据表示当前没有可引用记录，不代表能力不足；教师观点与正式记录分开呈现。',
            'notice',
          ),
        );
        button('查看学习观察', () => show('NOTES', true));
        button('查看来源证据', () => show('EVIDENCE', true));
      } else {
        if (!data.rows.length)
          root.append(
            el(
              'p',
              view === 'ROSTER'
                ? '暂无匹配的在班学生。'
                : view === 'EVIDENCE'
                  ? '暂无当前可用来源；未提交、评分草稿、练习或私有审阅不会成为画像证据。'
                  : '暂无可见记录。',
            ),
          );
        for (const r of data.rows) {
          const card = el('section', undefined, 'card');
          if (view === 'ROSTER') {
            card.append(el('h2', r.student_name), el('p', r.membership_id));
            button(
              '查看证据画像',
              () => {
                enrollmentId = r.id;
                studentName = r.student_name;
                queryText = '';
                show('OVERVIEW', true);
              },
              card,
            );
          }
          if (view === 'EVIDENCE') {
            sourceCard(r.kind, { ...r.snapshot, id: r.id }, card);
            if (mode === 'TEACHER') button('引用撰写学习观察', () => edit(null, [r]), card);
          }
          if (view === 'NOTES') {
            card.append(
              el('h2', r.title),
              el('p', `${states[r.state]} · 版本 ${r.revision} · ${confidences[r.confidence]}`),
              el('p', r.body, 'prose'),
              el('p', r.evidence.fresh ? '引用仍有效' : '引用依据已变化', 'notice'),
            );
            button('查看学习观察', () => note(r.id), card);
          }
          if (view === 'DISPUTES') {
            card.append(
              el('h2', r.title),
              el(
                'p',
                `${states[r.state]} · 请求版本 ${r.revision} · 原观察版本 ${r.target_revision}`,
              ),
            );
            button('查看本人纠错', () => dispute(r.id), card);
          }
          root.append(card);
        }
        paging(data.next, () => show(view));
      }
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (gen === generation) notice(error);
    }
  }
  async function editor(form, record = {}, initial = []) {
    const title = textControl(120),
      body = textControl(2000, true),
      confidence = selectControl(Object.entries(confidences));
    title.value = record.title ?? '';
    body.value = record.body ?? '';
    confidence.value = record.confidence ?? 'LIMITED';
    form.append(
      label('学习观察标题', title),
      label('给学生的学习观察', body),
      label('教师注明的证据充分程度', confidence),
      el('p', '这些文字和引用在明确发布后对本人可见。不要把私有风险判断复制进来。', 'notice'),
    );
    const selected = new Map(initial.map((r) => [r.kind + ':' + r.id, r])),
      selection = el('div'),
      options = el('section'),
      search = textControl(120);
    search.required = false;
    const choice = selectControl([['ALL', '全部来源'], ...Object.entries(kinds)]);
    form.append(
      el('h3', '引用 1–5 条当前可用证据'),
      selection,
      label('筛选可引用来源', search),
      label('选择来源类型', choice),
      options,
    );
    let after = [null],
      p = 0,
      epoch = 0;
    const selectedView = () => {
      selection.replaceChildren();
      for (const [k, r] of selected) {
        const line = el('div', undefined, 'selected-evidence');
        line.append(el('span', kinds[r.kind] + ' · ' + r.snapshot.title));
        button(
          '取消引用',
          () => {
            selected.delete(k);
            selectedView();
            load();
          },
          line,
        );
        selection.append(line);
      }
    };
    async function load() {
      const g = ++epoch;
      options.replaceChildren(el('p', '正在读取来源…'));
      try {
        const data = await read({
          view: 'EVIDENCE',
          q: search.value,
          kind: choice.value,
          ...(after[p] ? { cursor: after[p] } : {}),
        });
        if (disposed || g !== epoch) return;
        options.replaceChildren();
        for (const r of data.rows) {
          const box = el('input');
          box.type = 'checkbox';
          box.checked = selected.has(r.kind + ':' + r.id);
          const name = '引用：' + kinds[r.kind] + ' · ' + r.snapshot.title;
          const l = label(name, box);
          l.className = 'evidence-option';
          l.append(
            el(
              'span',
              r.snapshot.publicationVersion
                ? '正式发布版本 ' + r.snapshot.publicationVersion
                : '记录版本 ' + r.snapshot.revision,
            ),
          );
          box.onchange = () => {
            const key = r.kind + ':' + r.id;
            if (box.checked) {
              if (selected.size >= 5 && !selected.has(key)) {
                box.checked = false;
                notice(Error('每条观察最多引用5条证据。'));
                return;
              }
              selected.set(key, r);
            } else selected.delete(key);
            selectedView();
          };
          options.append(l);
        }
        if (!data.rows.length) options.append(el('p', '暂无符合条件的当前来源。'));
        if (p > 0)
          button(
            '上一页来源',
            () => {
              p--;
              load();
            },
            options,
          );
        if (data.next)
          button(
            '下一页来源',
            () => {
              after[p + 1] = data.next;
              p++;
              load();
            },
            options,
          );
      } catch (error) {
        options.replaceChildren(el('p', error.message, 'notice'));
      }
    }
    button(
      '筛选来源',
      () => {
        after = [null];
        p = 0;
        load();
      },
      form,
    );
    selectedView();
    await load();
    return () => {
      if (!selected.size) throw Error('请至少选择1条证据。');
      return {
        title: title.value,
        body: body.value,
        confidence: confidence.value,
        evidence: [...selected.values()].map((r) => ({ kind: r.kind, id: r.id, digest: r.digest })),
      };
    };
  }
  async function edit(data, initial = []) {
    reset();
    header(data ? '修订学习观察' : '撰写学习观察草稿');
    const form = el('form');
    root.append(form);
    const r = data?.record,
      seed = data
        ? data.evidence.citations.map((r) => ({
            kind: r.kind,
            id: r.id,
            digest: r.originalDigest,
            snapshot: r.original,
          }))
        : initial;
    if (data && !data.evidence.fresh)
      form.append(
        el('p', '旧引用已变化；请取消旧引用，重新选择当前来源，不会自动替换依据。', 'notice'),
      );
    const fields = await editor(form, r ?? {}, seed);
    let reason = null;
    if (r) {
      reason = textControl(1000, true);
      form.append(label('给学生的修订理由（草稿阶段仅教师可见）', reason));
    }
    mutationForm(
      form,
      r ? '保存观察修订' : '保存画像草稿',
      () =>
        r
          ? {
              type: r.state === 'DRAFT' ? 'EDIT_DRAFT' : 'REVISE_PUBLIC',
              id: r.id,
              revision: r.revision,
              reason: reason.value,
              ...fields(),
            }
          : { type: 'CREATE_OBSERVATION', enrollmentId, ...fields() },
      (r) => {
        restart();
        return note(r.id);
      },
    );
    root.setAttribute('aria-busy', 'false');
  }
  function noteText(r) {
    root.append(
      el('h2', r.title),
      el('p', `${states[r.state]} · 版本 ${r.revision}`),
      el('p', confidences[r.confidence]),
      el('p', r.body, 'prose'),
    );
    if (r.state === 'WITHDRAWN')
      root.append(el('p', '教师已撤回此观察；历史保留，不再作为当前学习判断。', 'notice'));
  }
  async function note(id, more = false) {
    if (!more) restart();
    history.replaceState(null, '', location.pathname + location.search + '#note-' + id);
    const gen = reset();
    try {
      const data = await read({
        view: 'NOTE',
        id,
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (gen !== generation || disposed) return;
      setContext(data);
      header('学习观察详情');
      const r = data.record;
      noteText(r);
      references(data.evidence);
      if (data.openDispute) linkButton('查看待处理本人纠错', () => dispute(data.openDispute.id));
      if (mode === 'TEACHER' && r.state !== 'WITHDRAWN') {
        button(r.state === 'DRAFT' ? '编辑教师草稿' : '修订公开学习观察', () => edit(data));
        const form = el('form');
        if (r.state === 'DRAFT')
          mutationForm(
            form,
            '发布学习观察给学生',
            () => ({
              type: 'PUBLISH_OBSERVATION',
              id,
              revision: r.revision,
              expectedDigest: data.evidence.digest,
            }),
            () => note(id),
          );
        else {
          const body = textControl(2000, true);
          form.append(label('给学生的撤回说明', body));
          mutationForm(
            form,
            '撤回学习观察',
            () => ({ type: 'WITHDRAW_OBSERVATION', id, revision: r.revision, body: body.value }),
            () => note(id),
          );
        }
      }
      if (mode === 'STUDENT' && r.state === 'PUBLISHED' && !data.openDispute) {
        const form = el('form'),
          body = textControl(2000, true),
          desired = textControl(2000, true);
        form.append(
          el('h2', '对这条观察提出本人纠错'),
          label('我认为需要纠正的问题', body),
          label('我希望如何纠正或补充', desired),
        );
        mutationForm(
          form,
          '提交本人纠错',
          () => ({
            type: 'OPEN_DISPUTE',
            id,
            revision: r.revision,
            body: body.value,
            desired: desired.value,
          }),
          (r) => dispute(r.id),
        );
      }
      root.append(el('h2', '学习观察历史'));
      for (const e of data.rows) {
        const card = el('section', undefined, 'card');
        card.append(
          el('h3', actions[e.action] + ' · 版本 ' + e.revision),
          el('p', e.actor_name + ' · ' + date(e.created_at)),
          el('p', e.body, 'prose'),
        );
        const d = el('details');
        d.append(
          el('summary', '查看当时观察与固定引用'),
          el('p', e.snapshot.title),
          el('p', e.snapshot.body, 'prose'),
        );
        for (const ref of e.snapshot.citations)
          sourceCard(ref.kind, { ...ref.snapshot, id: ref.id }, d);
        card.append(d);
        root.append(card);
      }
      paging(data.next, () => note(id, true));
      button('刷新观察与引用', () => note(id));
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (gen === generation) notice(error);
    }
  }
  function linkButton(name, action) {
    button(name, action);
  }
  async function dispute(id, more = false) {
    if (!more) restart();
    history.replaceState(null, '', location.pathname + location.search + '#dispute-' + id);
    const gen = reset();
    try {
      const data = await read({
        view: 'DISPUTE',
        id,
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (gen !== generation || disposed) return;
      setContext(data);
      header('本人纠错详情');
      const r = data.record,
        n = data.note;
      root.append(
        el('h2', n.title),
        el('p', `${states[r.state]} · 请求版本 ${r.revision}`),
        el('h3', '提出纠错时的固定观察'),
        el('p', `原观察版本 ${r.target_revision} · ${r.original_snapshot.title}`),
        el('p', r.original_snapshot.body, 'prose'),
        el('h3', '当前学习观察'),
      );
      noteText(n);
      references(data.evidence);
      button('查看学习观察历史', () => note(n.id));
      if (r.state === 'OPEN' && mode === 'STUDENT') {
        const form = el('form'),
          body = textControl(2000, true),
          desired = textControl(2000, true);
        form.append(label('补充本人纠错问题', body), label('补充期望的更正', desired));
        mutationForm(
          form,
          '追加本人纠错说明',
          () => ({
            type: 'APPEND_DISPUTE',
            id,
            revision: r.revision,
            body: body.value,
            desired: desired.value,
          }),
          () => dispute(id),
        );
      }
      if (r.state === 'OPEN' && mode === 'TEACHER') {
        const form = el('form'),
          outcome = selectControl([
            ['KEEP', '保留当前观察并说明'],
            ['REVISE', '采纳纠错并修订观察'],
            ['WITHDRAW', '撤回观察并结束纠错'],
          ]),
          response = textControl(2000, true),
          replacement = el('section');
        form.append(
          label('本人纠错处理方式', outcome),
          label('给学生的处理说明', response),
          replacement,
        );
        root.append(form);
        const fields = await editor(
          replacement,
          n,
          data.evidence.citations.map((r) => ({
            kind: r.kind,
            id: r.id,
            digest: r.originalDigest,
            snapshot: r.original,
          })),
        );
        replacement.hidden = outcome.value !== 'REVISE';
        const sync = () => {
          replacement.hidden = outcome.value !== 'REVISE';
          for (const n of replacement.querySelectorAll('input,textarea,select,button'))
            n.disabled = replacement.hidden;
        };
        outcome.onchange = sync;
        sync();
        mutationForm(
          form,
          '保存本人纠错处理',
          () => {
            const common = {
              type: 'RESOLVE_DISPUTE',
              id,
              revision: r.revision,
              noteRevision: n.revision,
              outcome: outcome.value,
              response: response.value,
            };
            return outcome.value === 'REVISE'
              ? { ...common, replacement: fields() }
              : outcome.value === 'KEEP'
                ? { ...common, expectedDigest: data.evidence.digest }
                : common;
          },
          () => dispute(id),
        );
      }
      root.append(el('h2', '双方纠错处理历史'));
      for (const e of data.rows) {
        const card = el('section', undefined, 'card');
        card.append(
          el('h3', actions[e.action] + ' · 请求版本 ' + e.revision),
          el('p', e.actor_name + ' · ' + date(e.created_at)),
          el('p', e.body, 'prose'),
        );
        if (e.desired) card.append(el('p', '期望更正：' + e.desired, 'prose'));
        if (e.outcome)
          card.append(
            el(
              'p',
              '教师处理：' +
                { KEEP: '保留并说明', REVISE: '已修订学习观察', WITHDRAW: '已撤回学习观察' }[
                  e.outcome
                ],
            ),
          );
        root.append(card);
      }
      paging(data.next, () => dispute(id, true));
      button('刷新纠错与当前观察', () => dispute(id));
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (gen === generation) notice(error);
    }
  }
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      controller.abort();
      clearDirty();
    },
    { once: true },
  );
  async function routeHash() {
    const noteId = /^#note-([0-9a-f-]{36})$/.exec(location.hash)?.[1],
      disputeId = /^#dispute-([0-9a-f-]{36})$/.exec(location.hash)?.[1],
      studentId = /^#student-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
    if (noteId) await note(noteId);
    else if (disputeId) await dispute(disputeId);
    else {
      if (mode === 'TEACHER') {
        enrollmentId = studentId ?? null;
        currentView = studentId ? 'OVERVIEW' : 'ROSTER';
      } else currentView = 'OVERVIEW';
      await show();
    }
  }
  window.addEventListener('hashchange', (event) => {
    if (disposed) return;
    if (dirtyKey && !confirm('有未保存的修改，确认放弃修改并离开？')) {
      history.replaceState(null, '', event.oldURL);
      return;
    }
    routeHash().catch(notice);
  });
  await routeHash();
})().catch((error) => {
  document.getElementById('learner').textContent = '无法加载学习证据画像：' + error.message;
});
