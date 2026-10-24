/* Published plan text is public to its recipient; self reports never replace Learning evidence. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('concepts'),
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
  const base = `/api/zhiban/concept/${tenant}/offerings/${offering}`,
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
  const states = {
    DRAFT: '教师草稿',
    OPEN: '待补充／复核',
    RESOLVED: '教师确认本次已纠正',
    RETRACTED: '教师已撤回判断',
  };
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
            ? '证据、审阅或学生回复版本已变化，或该证据已有记录。输入保留，请重新核对。'
            : r.status === 401 || r.status === 403
              ? '账户、角色或课程关系已变化，不能继续访问或发布。'
              : r.status === 404
                ? '该证据或纠错不可访问。'
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
  const read = (args = {}) => request(base + '?' + new URLSearchParams({ mode, ...args }));
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
  let view = 'LIST',
    filter = 'ALL',
    search = '';
  const actions = {
    CREATE_CORRECTION: '登记证据草稿',
    EDIT_DRAFT: '修订草稿',
    PUBLISH_CORRECTION: '发布纠错',
    REVISE_FEEDBACK: '更正公开说明',
    RESPOND: '学生补充解释',
    ASSESS: '教师复核',
    RETRACT: '撤回判断',
  };
  function mutationForm(form, name, build, success) {
    const submit = el('button', name);
    submit.type = 'submit';
    const msg = el('p', '', 'notice');
    msg.setAttribute('role', 'status');
    form.append(submit, msg);
    let pending = null,
      busy = false;
    const key = 'concept-' + crypto.randomUUID();
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
  function header(title) {
    root.append(
      el('h1', title),
      el(
        'p',
        mode === 'TEACHER'
          ? '从已发布的正式作答建立可追溯证据。概念判断由教师作出，可更正、撤回；不自动改变成绩、完成或学生画像。'
          : '查看教师明确发布给本人的纠错说明，补充解释后由教师复核；提交解释不等于重交测验或获得成绩。',
        'notice',
      ),
    );
    const nav = el('nav', undefined, 'actions');
    nav.setAttribute('aria-label', '概念纠错视图');
    button(mode === 'TEACHER' ? '纠错记录' : '我的纠错', () => showList('LIST', true), nav);
    if (mode === 'TEACHER') button('正式作答证据', () => showList('SOURCES', true), nav);
    root.append(nav);
  }
  function evidence(data, title, parent = root) {
    const card = el('section', undefined, 'evidence');
    card.append(el('h3', title));
    card.append(
      el(
        'p',
        `${data.title} · 固定活动版本 ${data.activity_version} · 正式发布版本 ${data.grade_version}`,
      ),
    );
    if (data.question) {
      card.append(el('p', data.question.question, 'prose'));
      for (const op of data.question.options ?? [])
        card.append(el('p', `${op.value} · ${op.label}`));
    }
    card.append(
      el(
        'p',
        '该次提交：' +
          (Array.isArray(data.answer) ? data.answer.join('、') : String(data.answer ?? '未填写')),
        'prose',
      ),
    );
    card.append(
      el(
        'p',
        `本题／作答正式得分：${Number(data.item_points) / 100} / ${Number(data.item_max) / 100}；提交于 ${date(data.submitted_at)}`,
      ),
    );
    if (title === '当前来源核对') {
      card.append(
        el(
          'p',
          data.fresh
            ? '原来源仍是当前正式证据。'
            : '原来源已变化或不在当前范围；固定证据保留，不代表当前仍存在概念错误。',
          'notice',
        ),
      );
      card.append(
        el(
          'p',
          data.latest_publication_id
            ? `当前最新正式总分：${Number(data.latest_score_points) / 100} / ${Number(data.latest_max_points) / 100}（发布版本 ${data.latest_grade_version}）。总分不能单独证明概念掌握。`
            : '最新提交尚无正式成绩。',
        ),
      );
    }
    const refs = el('details');
    refs.append(
      el('summary', '查看固定记录引用'),
      el(
        'p',
        `Attempt ${data.attempt_id}；Submission ${data.submission_id}；Publication ${data.publication_id}；题目 ${data.question_id || '整份文本作答'}`,
        'prose',
      ),
    );
    card.append(refs);
    parent.append(card);
  }
  function contentFields(form, record = {}) {
    const fields = {};
    for (const [key, name, max, area] of [
      ['concept', '概念名称', 120, false],
      ['explanation', '给学生的纠错说明', 2000, true],
      ['guidance', '给学生的下一步建议', 2000, true],
      ['privateNote', '教师私有依据说明', 2000, true],
    ]) {
      const n = textControl(max, area);
      n.value = record[key] ?? '';
      fields[key] = n;
      form.append(label(name, n));
    }
    form.append(el('p', '公开说明请单独撰写。教师私有依据不会发送给学生。', 'notice'));
    return () => Object.fromEntries(Object.entries(fields).map(([k, n]) => [k, n.value]));
  }
  function paginate(next, loader) {
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
  async function showList(nextView = view, fresh = false) {
    if (fresh) {
      view = nextView;
      cursors = [null];
      page = 0;
      history.replaceState(null, '', location.pathname + location.search);
    }
    const gen = reset();
    header(view === 'SOURCES' ? '正式作答证据' : '概念纠错');
    const form = el('form'),
      q = textControl(120);
    q.required = false;
    q.value = search;
    form.append(label('搜索概念、活动或学生', q));
    let state = null;
    if (view === 'LIST') {
      state = selectControl([
        ['ALL', '全部状态'],
        ...Object.entries(states).filter(([k]) => mode === 'TEACHER' || k !== 'DRAFT'),
      ]);
      state.value = filter;
      form.append(label('纠错状态', state));
    }
    const submit = el('button', '查询');
    submit.type = 'submit';
    form.append(submit);
    form.onsubmit = (e) => {
      e.preventDefault();
      search = q.value;
      filter = state?.value ?? 'ALL';
      showList(view, true).catch(notice);
    };
    root.append(form);
    try {
      const data = await read({
        view,
        q: search,
        state: filter,
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (gen !== generation || disposed) return;
      if (!data.rows.length)
        root.append(
          el(
            'p',
            view === 'SOURCES'
              ? '暂无当前正式失分证据。评分草稿、练习及旧来源不会列入；失分本身不证明概念错误。'
              : '暂无可见纠错记录。',
          ),
        );
      for (const r of data.rows) {
        const card = el('section', undefined, 'card');
        if (view === 'SOURCES') {
          card.append(el('h2', r.title + ' · ' + r.student_name));
          evidence(r, '正式作答依据', card);
          card.append(
            el(
              'p',
              r.activity_type === 'QUIZ' && r.review_closed_at === null
                ? '测验尚未关闭答案复核，可先保存教师草稿，暂不能公开发布。'
                : '此来源可由教师明确判断后发布纠错。',
              'notice',
            ),
          );
          button(
            r.correction_id ? '查看已有纠错' : '登记概念证据',
            () => (r.correction_id ? detail(r.correction_id) : create(r)),
            card,
          );
        } else {
          card.append(
            el('h2', r.concept),
            el(
              'p',
              `${states[r.state]} · 版本 ${r.revision}${r.student_name ? ' · ' + r.student_name : ''}`,
            ),
            el('p', r.explanation, 'prose'),
          );
          button('查看纠错', () => detail(r.id), card);
        }
        root.append(card);
      }
      paginate(data.next, () => showList().catch(notice));
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (gen === generation) notice(error);
    }
  }
  function create(source) {
    reset();
    header('登记概念证据草稿');
    evidence(source, '正式作答依据');
    const form = el('form'),
      fields = contentFields(form);
    mutationForm(
      form,
      '保存教师草稿',
      () => ({
        type: 'CREATE_CORRECTION',
        publicationId: source.publication_id,
        questionId: source.question_id,
        expectedDigest: source.digest,
        ...fields(),
      }),
      (r) => detail(r.id),
    );
    root.setAttribute('aria-busy', 'false');
  }
  async function detail(id) {
    const same = /^#correction-/.test(location.hash) && location.hash === '#correction-' + id;
    if (!same) {
      cursors = [null];
      page = 0;
    }
    history.replaceState(null, '', location.pathname + location.search + '#correction-' + id);
    const gen = reset();
    header('概念纠错详情');
    try {
      const data = await read({
        view: 'DETAIL',
        id,
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (gen !== generation || disposed) return;
      const r = data.record,
        current = data.current;
      root.append(
        el('h2', r.concept + (r.student_name ? ' · ' + r.student_name : '')),
        el('p', `${states[r.state]} · 版本 ${r.revision}`),
      );
      root.append(
        el('h3', '教师纠错说明'),
        el('p', r.explanation, 'prose'),
        el('h3', '下一步建议'),
        el('p', r.guidance, 'prose'),
      );
      if (r.state === 'RETRACTED')
        root.append(
          el('p', '教师已撤回这次判断。历史说明保留用于追溯，不再作为当前纠错要求。', 'notice'),
        );
      evidence(r.evidence, '登记时固定证据');
      evidence(current, '当前来源核对');
      link(
        '查看原活动',
        href(mode === 'TEACHER' ? 'classrooms' : 'coursework') +
          '#activity-' +
          r.evidence.activity_id,
      );
      link(mode === 'TEACHER' ? '补救计划' : '我的补救任务', href('remediation'));
      if (mode === 'TEACHER') {
        const form = el('form');
        const allowed =
          r.state === 'DRAFT'
            ? [
                ['EDIT_DRAFT', '修订教师草稿'],
                ['PUBLISH_CORRECTION', '发布给学生'],
              ]
            : r.state === 'OPEN'
              ? [
                  ['ASSESS', '复核学生解释'],
                  ['REVISE_FEEDBACK', '更正公开说明'],
                  ['RETRACT', '撤回概念判断'],
                ]
              : r.state === 'RESOLVED'
                ? [['RETRACT', '撤回概念判断']]
                : [];
        if (allowed.length) {
          const action = selectControl(allowed);
          form.append(label('教师纠错动作', action));
          const fields = contentFields(form, r),
            reason = textControl(1000, true),
            body = textControl(2000, true),
            outcome = selectControl([
              ['NEEDS_MORE', '继续澄清'],
              ['RESOLVED', '教师确认本次已纠正'],
            ]);
          reason.value = '';
          form.append(
            label('修订理由（公开更正时学生可见）', reason),
            label('给学生的复核／撤回说明', body),
            label('教师复核判断', outcome),
          );
          const sync = () => {
            const text = ['EDIT_DRAFT', 'REVISE_FEEDBACK'].includes(action.value);
            for (const l of form.querySelectorAll('label')) {
              const n = l.querySelector('input,textarea,select');
              if (n === action) continue;
              const show =
                n === outcome
                  ? action.value === 'ASSESS'
                  : n === reason
                    ? text
                    : n === body
                      ? ['ASSESS', 'RETRACT'].includes(action.value)
                      : n.getAttribute('aria-label') === '教师私有依据说明'
                        ? action.value !== 'PUBLISH_CORRECTION'
                        : text;
              l.hidden = !show;
              n.required = show && n !== outcome;
              n.disabled = !show;
            }
          };
          action.onchange = sync;
          sync();
          mutationForm(
            form,
            '保存教师处理',
            () => {
              const common = { id, revision: r.revision };
              if (action.value === 'PUBLISH_CORRECTION')
                return { type: action.value, ...common, expectedDigest: current.digest };
              if (['EDIT_DRAFT', 'REVISE_FEEDBACK'].includes(action.value))
                return {
                  type: action.value,
                  ...common,
                  expectedDigest: current.digest,
                  ...fields(),
                  reason: reason.value,
                };
              if (action.value === 'ASSESS') {
                if (!data.latestResponseRevision)
                  throw Error('当前页面尚无学生解释，请先刷新当前证据；发布后等待学生补充。');
                return {
                  type: 'ASSESS',
                  ...common,
                  expectedDigest: current.digest,
                  responseRevision: data.latestResponseRevision,
                  outcome: outcome.value,
                  body: body.value,
                  privateNote: fields().privateNote,
                };
              }
              return {
                type: 'RETRACT',
                ...common,
                body: body.value,
                privateNote: fields().privateNote,
              };
            },
            () => {
              page = 0;
              cursors = [null];
              return detail(id);
            },
          );
          if (
            r.state === 'DRAFT' &&
            current.activity_type === 'QUIZ' &&
            current.review_closed_at === null
          )
            root.append(
              el(
                'p',
                '原测验尚未关闭答案复核，暂不能发布给学生。请在原测验关闭后刷新核对。',
                'notice',
              ),
            );
        }
      } else if (r.state === 'OPEN') {
        const form = el('form'),
          body = textControl(2000, true);
        form.append(label('我的补充解释或问题', body));
        mutationForm(
          form,
          '提交补充解释',
          () => ({ type: 'RESPOND', id, revision: r.revision, body: body.value }),
          () => {
            page = 0;
            cursors = [null];
            return detail(id);
          },
        );
      }
      root.append(el('h2', mode === 'TEACHER' ? '不可变纠错历史' : '纠错与解释记录'));
      for (const event of data.rows) {
        const card = el('section', undefined, 'card');
        card.append(
          el('h3', `${actions[event.action]} · 版本 ${event.revision}`),
          el('p', `${event.actor_name} · ${date(event.created_at)} · ${states[event.state]}`),
        );
        if (event.body) card.append(el('p', event.body, 'prose'));
        if (event.private_note) card.append(el('p', '教师私有：' + event.private_note, 'prose'));
        const d = el('details');
        d.append(
          el('summary', '查看当时公开说明'),
          el('p', event.public_text.concept),
          el('p', event.public_text.explanation, 'prose'),
          el('p', event.public_text.guidance, 'prose'),
        );
        card.append(d);
        root.append(card);
      }
      paginate(data.next, () => detail(id).catch(notice));
      button('刷新当前证据', () => {
        page = 0;
        cursors = [null];
        return detail(id);
      });
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
  const selected = /^#correction-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
  if (selected) await detail(selected);
  else await showList();
})().catch((error) => {
  document.getElementById('concepts').textContent = '无法加载概念纠错：' + error.message;
});
