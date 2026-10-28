/* Read-only teacher report. Session remains in the HttpOnly same-origin cookie. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('analytics');
  const params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = params.get('tenant'),
    offering = params.get('offering');
  let generation = 0,
    controller,
    state,
    filter = 'ALL',
    search = '';
  let view =
    location.hash === '#cases' || /^#followup-case-[0-9a-f-]{36}$/.test(location.hash)
      ? 'cases'
      : location.hash === '#followups'
        ? 'followups'
        : 'statistics';
  let caseFilters = { q: '', state: 'ALL' },
    caseCursors = [null],
    casePage = 0,
    caseDialog = null,
    noteDirty = false;
  let reminderCleanup = null;
  window.addEventListener('beforeunload', (event) => {
    if (noteDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  let followFilters = { q: '', state: 'ALL_PENDING', limit: '20' },
    followCursors = [null],
    followPage = 0;
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function status(row) {
    return row.gradeVersion !== null
      ? 'GRADED'
      : row.submissionVersion !== null
        ? 'WAITING'
        : row.attemptNo !== null
          ? 'STARTED'
          : 'NEW';
  }
  const labels = {
    GRADED: '成绩已发布',
    WAITING: '已提交 · 待发布成绩',
    STARTED: '已开始 · 未提交',
    NEW: '尚未开始',
  };
  function clear() {
    reminderCleanup?.();
    reminderCleanup = null;
    state = null;
    root.replaceChildren(modeBar);
  }
  function error(text) {
    clear();
    const n = el('p', text, 'notice');
    n.setAttribute('role', 'alert');
    root.append(n);
  }
  function render() {
    root.replaceChildren(modeBar);
    const heading = el('div', undefined, 'analytics-heading');
    const title = el('div');
    title.append(el('p', '教学班概览', 'eyebrow'), el('h1', state.offering.title));
    const refresh = el('button', '刷新数据', 'button secondary');
    refresh.type = 'button';
    refresh.onclick = () => void load(state.selected);
    heading.append(title, refresh);
    root.append(heading);
    root.append(el('p', '统计时点：' + new Date(state.asOf).toLocaleString('zh-CN'), 'muted'));
    const label = el('label', '查看活动');
    const select = el('select');
    select.id = 'activity';
    for (const a of state.activities) {
      const option = el('option', a.title + ' · 发布版本 ' + a.version);
      option.value = a.id + ':' + a.version;
      option.selected = state.selected?.id === a.id && state.selected.version === a.version;
      select.append(option);
    }
    select.disabled = !state.activities.length;
    select.onchange = () => {
      const [id, version] = select.value.split(':');
      void load({ id, version: Number(version) });
    };
    label.append(select);
    root.append(label);
    const cards = el('section', undefined, 'analytics-cards');
    cards.setAttribute('aria-label', '统计汇总');
    const s = state.summary;
    for (const [name, value] of [
      ['在班名单', s.enrolled],
      ['当前发布活动', s.publishedActivities],
      ['已开始', s.started],
      ['已提交', s.submitted],
      ['未提交', s.notSubmitted],
      ['成绩已发布', s.graded],
      ['待发布成绩', s.awaitingGrade],
      ['平均得分率', s.averagePercent === null ? null : s.averagePercent + '%'],
    ]) {
      const c = el('article', undefined, 'card analytics-metric');
      c.append(el('span', name), el('strong', value === null ? '—' : String(value)));
      cards.append(c);
    }
    root.append(cards);
    root.append(
      el(
        'p',
        '按当前在班名单统计。每人仅计所选发布版本的最新尝试及其最新提交，成绩仅计最新已发布人工评分。平均得分率为学生得分率的未加权平均，不作为课程总评。',
        'analytics-note',
      ),
    );
    if (!state.selected) {
      root.append(el('p', '暂无当前发布活动。发布学习活动后可查看提交与成绩统计。', 'empty-state'));
      return;
    }
    if (!state.students.length) {
      root.append(el('p', '当前教学班没有在班学生。', 'empty-state'));
      return;
    }
    const tools = el('div', undefined, 'analytics-tools');
    const searchLabel = el('label', '查找学生');
    const input = el('input');
    input.type = 'search';
    input.value = search;
    input.placeholder = '姓名或 Membership ID';
    searchLabel.append(input);
    const filterLabel = el('label', '学习状态');
    const statusFilter = el('select');
    for (const [key, value] of Object.entries({ ALL: '全部学生', ...labels })) {
      const o = el('option', value);
      o.value = key;
      o.selected = key === filter;
      statusFilter.append(o);
    }
    filterLabel.append(statusFilter);
    tools.append(searchLabel, filterLabel);
    root.append(tools);
    const count = el('p', undefined, 'muted');
    count.setAttribute('aria-live', 'polite');
    root.append(count);
    const wrapper = el('div', undefined, 'analytics-table');
    const table = el('table');
    const caption = el(
      'caption',
      '学生明细 · ' + state.selected.title + ' · 版本 ' + state.selected.version,
    );
    table.append(caption);
    const head = el('tr');
    for (const text of ['学生', '学习状态', '最新尝试 / 提交', '提交时间', '已发布成绩']) {
      const th = el('th', text);
      th.scope = 'col';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    table.append(thead, tbody);
    wrapper.append(table);
    root.append(wrapper);
    function rows() {
      tbody.replaceChildren();
      const needle = search.toLocaleLowerCase();
      const selected = state.students.filter(
        (r) =>
          (filter === 'ALL' || status(r) === filter) &&
          ((r.displayName || '') + ' ' + r.membershipId).toLocaleLowerCase().includes(needle),
      );
      count.textContent = '显示 ' + selected.length + ' / ' + state.students.length + ' 位学生';
      for (const r of selected) {
        const tr = el('tr');
        const name = el('td');
        name.append(el('strong', r.displayName || '未设置姓名'), el('small', r.membershipId));
        const badge = el('span', labels[status(r)], 'analytics-status ' + status(r).toLowerCase());
        const cell = el('td');
        cell.append(badge);
        const attempts =
          r.attemptNo === null
            ? '—'
            : '#' +
              r.attemptNo +
              ' / ' +
              (r.submissionVersion === null ? '未提交' : 'v' + r.submissionVersion);
        const score =
          r.gradeVersion === null
            ? '—'
            : r.scorePoints / 100 + ' / ' + r.maxPoints / 100 + ' · v' + r.gradeVersion;
        tr.append(
          name,
          cell,
          el('td', attempts),
          el('td', r.submittedAt === null ? '—' : new Date(r.submittedAt).toLocaleString('zh-CN')),
          el('td', score),
        );
        tbody.append(tr);
      }
      if (!selected.length) {
        const tr = el('tr'),
          td = el('td', '没有符合筛选条件的学生。');
        td.colSpan = 5;
        tr.append(td);
        tbody.append(tr);
      }
    }
    input.oninput = () => {
      search = input.value;
      rows();
    };
    statusFilter.onchange = () => {
      filter = statusFilter.value;
      rows();
    };
    rows();
  }
  const followLabels = {
    RISK_SUPPORT: '教师审阅后登记支持',
    ALL_PENDING: '全部待跟进',
    OVERDUE: '逾期未交',
    NOT_STARTED: '尚未开始',
    IN_PROGRESS: '已开始未交',
    AWAITING_GRADE: '已提交待发布成绩',
  };
  const modeBar = el('nav', undefined, 'analytics-tools');
  modeBar.setAttribute('aria-label', '教学分析视图');
  for (const [key, name] of [
    ['statistics', '活动统计'],
    ['followups', '教师待跟进名单'],
    ['cases', '跟进记录与结案'],
  ]) {
    const b = el('button', name, 'button secondary');
    b.type = 'button';
    b.onclick = () => {
      view = key;
      followCursors = [null];
      followPage = 0;
      history.replaceState(
        null,
        '',
        key === 'cases' ? '#cases' : key === 'followups' ? '#followups' : '#statistics',
      );
      void load(null);
    };
    modeBar.append(b);
  }
  root.prepend(modeBar);
  function renderFollowups(data) {
    root.replaceChildren(modeBar, el('h1', '教师待跟进名单'));
    root.append(el('p', '统计时点：' + new Date(data.asOf).toLocaleString('zh-CN'), 'muted'));
    root.append(
      el(
        'p',
        '按当前在班学生 × 当前发布的正式活动列出；每项只取该版本最新尝试及其最新提交。逾期以服务器时点和发布截止时间判定，不代表学生风险或学习完成。练习、草稿、撤回活动及已有发布成绩的最新提交不列入。',
        'analytics-note',
      ),
    );
    const summary = el('section', undefined, 'analytics-cards');
    summary.setAttribute('aria-label', '待跟进汇总');
    for (const [name, number] of [
      ['待跟进事项', data.summary.pending],
      ['逾期未交', data.summary.overdue],
      ['尚未开始', data.summary.notStarted],
      ['已开始未交', data.summary.inProgress],
      ['已提交待发布', data.summary.awaitingGrade],
    ]) {
      const card = el('article', undefined, 'card analytics-metric');
      card.append(el('span', name), el('strong', String(number)));
      summary.append(card);
    }
    root.append(
      summary,
      el(
        'p',
        '汇总随搜索范围变化，按事项计数；同一学生可能有多个活动。逾期未交与“尚未开始／已开始未交”重叠，不可相加。翻页期间数据可能变化，刷新会回到第一页。',
        'analytics-note',
      ),
    );
    const form = el('form', undefined, 'analytics-tools');
    const searchLabel = el('label', '搜索待跟进学生或活动'),
      input = el('input');
    input.type = 'search';
    input.maxLength = 120;
    input.value = followFilters.q;
    input.placeholder = '姓名、完整成员 ID 或活动标题';
    searchLabel.append(input);
    const stateLabel = el('label', '跟进原因'),
      select = el('select');
    select.setAttribute('aria-label', '跟进原因');
    for (const [key, name] of Object.entries(followLabels)) {
      const option = el('option', name);
      option.value = key;
      select.append(option);
    }
    select.value = followFilters.state;
    stateLabel.append(select);
    const limitLabel = el('label', '待跟进每页条数'),
      limit = el('select');
    limit.setAttribute('aria-label', '待跟进每页条数');
    for (const n of ['20', '50']) {
      const option = el('option', n);
      option.value = n;
      limit.append(option);
    }
    limit.value = followFilters.limit;
    limitLabel.append(limit);
    const submit = el('button', '查询待跟进名单', 'button secondary');
    submit.type = 'submit';
    const refresh = el('button', '刷新待跟进名单', 'button secondary');
    refresh.type = 'button';
    refresh.onclick = () => {
      followPage = 0;
      followCursors = [null];
      void loadFollowups();
    };
    form.append(searchLabel, stateLabel, limitLabel, submit, refresh);
    form.onsubmit = (e) => {
      e.preventDefault();
      followFilters = { q: input.value.trim(), state: select.value, limit: limit.value };
      followPage = 0;
      followCursors = [null];
      void loadFollowups();
    };
    root.append(
      form,
      el(
        'p',
        `匹配 ${data.totalMatches} 条 · 第 ${followPage + 1} 页 · 本页 ${data.rows.length} 条`,
        'muted',
      ),
    );
    const wrapper = el('div', undefined, 'analytics-table'),
      table = el('table'),
      head = el('tr'),
      thead = el('thead'),
      body = el('tbody');
    table.append(el('caption', '当前待跟进事项'));
    for (const name of [
      '学生',
      '活动／发布版本',
      '跟进依据',
      '发布截止时间',
      '最新尝试／提交',
      '处理入口',
    ]) {
      const th = el('th', name);
      th.scope = 'col';
      head.append(th);
    }
    thead.append(head);
    table.append(thead, body);
    wrapper.append(table);
    root.append(wrapper);
    for (const r of data.rows) {
      const tr = el('tr'),
        student = el('td'),
        activity = el('td'),
        actions = el('td');
      student.append(el('strong', r.displayName || '未设置姓名'), el('small', r.membershipId));
      activity.append(el('strong', r.title), el('small', '发布版本 ' + r.version));
      const context = `space=${tenant}&offering=${offering}`;
      const back = nestedContext ? `/zhiban/teacher/courses/${course}` : null;
      if (r.submissionId) {
        const a = el('a', '查看提交与评分');
        a.href =
          (back
            ? back + '/grades?' + context
            : `/zhiban/grading?tenant=${tenant}&offering=${offering}`) +
          `#followup-grading-${r.activityId}-${r.membershipId}`;
        actions.append(a);
      } else if (back) {
        const a = el('a', '查看原活动');
        a.href = back + '/classrooms?' + context + '#activity-' + r.activityId;
        actions.append(a);
      } else {
        const a = el('a', '进入课程活动');
        a.href = `/zhiban?space=${tenant}`;
        actions.append(a);
      }
      if (data.caseManagementEnabled) {
        const b = el(
          'button',
          r.caseId ? (r.caseState === 'CLOSED' ? '查看已结案跟进' : '查看进行中跟进') : '记录跟进',
          'button secondary',
        );
        b.type = 'button';
        b.onclick = () => (r.caseId ? loadCaseDetail(r.caseId) : editCase(r));
        actions.append(b);
      }
      tr.append(
        student,
        activity,
        el(
          'td',
          followLabels[r.reason] +
            (r.reason === 'OVERDUE' ? (r.attemptId ? '（已开始）' : '（尚未开始）') : ''),
        ),
        el(
          'td',
          r.deadlineAt === null
            ? '无截止时间'
            : new Date(Number(r.deadlineAt)).toLocaleString('zh-CN'),
        ),
        el(
          'td',
          r.attemptNo === null
            ? '尚无尝试'
            : `尝试 #${r.attemptNo} / ` +
                (r.submissionVersion === null ? '未提交' : `提交 v${r.submissionVersion}`),
        ),
        actions,
      );
      body.append(tr);
    }
    if (!data.rows.length) {
      const tr = el('tr'),
        td = el('td', '暂无符合条件的待跟进事项。');
      td.colSpan = 6;
      tr.append(td);
      body.append(tr);
    }
    const pager = el('div', undefined, 'analytics-tools'),
      prev = el('button', '上一页待跟进', 'button secondary'),
      next = el('button', '下一页待跟进', 'button secondary');
    prev.disabled = followPage === 0;
    next.disabled = !data.next;
    prev.onclick = () => {
      followPage--;
      void loadFollowups();
    };
    next.onclick = () => {
      followCursors[++followPage] = data.next;
      void loadFollowups();
    };
    pager.append(prev, next);
    root.append(pager);
  }
  async function loadFollowups() {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    clear();
    root.setAttribute('aria-busy', 'true');
    root.append(el('p', '正在读取待跟进名单…', 'muted'));
    const requestController = controller,
      timer = setTimeout(() => requestController.abort(), 10000);
    try {
      const q = new URLSearchParams(followFilters);
      if (followCursors[followPage]) q.set('cursor', followCursors[followPage]);
      const r = await fetch(
        `/api/zhiban/analytics/${tenant}/offerings/${offering}/followups?${q}`,
        {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: requestController.signal,
        },
      );
      if (current !== generation) return;
      const data = await r.json();
      if (current !== generation) return;
      if (!r.ok) {
        error(
          r.status === 403
            ? '当前任教或教师授权已失效。'
            : r.status === 401
              ? '登录已失效，请返回工作台。'
              : r.status === 400
                ? '筛选或游标无效，请重新查询。'
                : '待跟进名单暂不可用，请重新打开页面。',
        );
        return;
      }
      renderFollowups(data);
    } catch {
      if (current === generation) error('待跟进名单读取失败，请重新打开页面。');
    } finally {
      clearTimeout(timer);
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const caseBase = `/api/zhiban/analytics/${tenant}/offerings/${offering}/followup-cases`;
  async function caseRequest(suffix = '', command = null, key = null) {
    const c = new AbortController(),
      timeout = setTimeout(() => c.abort(), 10000);
    const headers = { 'x-zhiban-request': 'identity-v1' };
    try {
      if (command) {
        const csrf = await fetch('/api/zhiban/identity/csrf', {
          headers,
          cache: 'no-store',
          signal: c.signal,
        });
        if (!csrf.ok) throw Object.assign(Error('登录已失效，请重新登录。'), { definitive: true });
        headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
        headers['x-zhiban-command'] = key;
        headers['content-type'] = 'application/json';
      }
      const r = await fetch(caseBase + suffix, {
        headers,
        method: command ? 'POST' : 'GET',
        cache: 'no-store',
        signal: c.signal,
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
      const data = await r.json();
      if (!r.ok)
        throw Object.assign(
          Error(
            r.status === 403
              ? '当前任教或教师授权已失效。'
              : r.status === 401
                ? '登录已失效，请重新登录。'
                : r.status === 409
                  ? '记录或学习事实已变化；输入保留。请读取新版本后再处理，或回名单查看已有跟进。'
                  : r.status === 400
                    ? '跟进内容或参数无效。'
                    : '跟进记录暂不可用。',
          ),
          { definitive: r.status >= 400 && r.status < 500 },
        );
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
  function setNoteDirty(value) {
    noteDirty = value;
    window.zhibanCoursePage?.setDirty('followup-note', value, caseDialog);
  }
  function editCase(target, record = null) {
    if (caseDialog) return;
    const dialog = el('dialog', undefined, 'followup-editor');
    caseDialog = dialog;
    dialog.setAttribute('aria-label', record ? '处理跟进记录' : '新建人工跟进');
    const title = el('h2', record ? '追加跟进／结案' : '记录人工跟进'),
      message = el('p');
    message.setAttribute('role', 'status');
    const form = el('form'),
      label = el('label', '跟进内容／处理说明'),
      text = el('textarea');
    text.setAttribute('aria-label', '跟进内容／处理说明');
    text.maxLength = 2000;
    text.rows = 6;
    text.required = true;
    label.append(text);
    text.oninput = () => setNoteDirty(text.value.length > 0);
    const actionLabel = el('label', '处理动作'),
      action = el('select');
    action.setAttribute('aria-label', '处理动作');
    function options() {
      action.replaceChildren();
      for (const [value, name] of record
        ? record.state === 'CLOSED'
          ? [['REOPEN_CASE', '重新打开']]
          : [
              ['ADD_NOTE', '追加跟进'],
              ['CLOSE_CASE', '结案'],
            ]
        : [['CREATE_CASE', '创建跟进']]) {
        const o = el('option', name);
        o.value = value;
        action.append(o);
      }
    }
    options();
    actionLabel.append(action);
    const save = el('button', '保存跟进', 'button'),
      retry = el('button', '按原命令重试', 'button secondary'),
      refresh = el('button', '读取新版本并保留输入', 'button secondary'),
      cancel = el('button', '放弃未保存内容并关闭', 'button secondary');
    save.type = 'submit';
    retry.type = refresh.type = cancel.type = 'button';
    retry.hidden = true;
    refresh.hidden = !record;
    let pending = null,
      busy = false;
    const close = () => {
      setNoteDirty(false);
      dialog.close();
      dialog.remove();
      caseDialog = null;
    };
    cancel.onclick = () => {
      if (!busy) close();
    };
    dialog.oncancel = (e) => {
      e.preventDefault();
      if (!busy && !pending && !noteDirty) close();
      else if (noteDirty)
        message.textContent = '输入尚未保存，请保存或明确选择放弃未保存内容并关闭。';
    };
    refresh.onclick = async () => {
      if (busy || pending) return;
      try {
        record = (await caseRequest('/' + record.id)).record;
        options();
        message.textContent = '已更新版本，输入保留。';
      } catch (e) {
        message.textContent = e.message;
      }
    };
    async function send() {
      if (busy || !pending) return;
      busy = true;
      save.disabled =
        retry.disabled =
        cancel.disabled =
        action.disabled =
        text.disabled =
        refresh.disabled =
          true;
      try {
        const result = await caseRequest('', pending.command, pending.key);
        pending = null;
        close();
        if (view === 'cases') await loadCaseDetail(result.id);
        else await loadFollowups();
      } catch (e) {
        if (e.definitive) pending = null;
        message.textContent = e.message + (pending ? ' 结果待确认，请按原命令号重试。' : '');
        retry.hidden = !pending;
      } finally {
        busy = false;
        save.disabled = !!pending;
        retry.disabled = false;
        cancel.disabled = !!pending;
        action.disabled = text.disabled = refresh.disabled = !!pending;
      }
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      if (busy || pending || !text.value.trim()) return;
      const command = record
        ? { type: action.value, id: record.id, revision: record.revision, body: text.value.trim() }
        : {
            type: 'CREATE_CASE',
            activityId: target.activityId,
            version: target.version,
            membershipId: target.membershipId,
            body: text.value.trim(),
          };
      pending = { command, key: crypto.randomUUID() };
      void send();
    };
    retry.onclick = () => void send();
    form.append(actionLabel, label, save, retry, refresh, cancel);
    dialog.append(
      title,
      el(
        'p',
        (record ? record.activity_title : target.title) +
          ' · ' +
          (record ? record.student_name : target.displayName || target.membershipId),
      ),
      el('p', '仅当前任教教师可见。结案只标记人工处理结果，不修改成绩或消除未交事实。', 'muted'),
      message,
      form,
    );
    document.body.append(dialog);
    dialog.showModal();
    text.focus();
  }
  async function loadCases() {
    const current = ++generation;
    controller?.abort();
    clear();
    root.setAttribute('aria-busy', 'true');
    try {
      const search = new URLSearchParams(caseFilters);
      if (caseCursors[casePage]) search.set('cursor', caseCursors[casePage]);
      const data = await caseRequest('?' + search);
      if (current !== generation) return;
      root.append(
        el('h1', '人工跟进记录与结案'),
        el(
          'p',
          '包含已结案、旧发布版本和历史选课记录。结案不替代真实提交或成绩发布；当前任教教师可协作处理。',
          'analytics-note',
        ),
      );
      const form = el('form', undefined, 'analytics-tools'),
        qLabel = el('label', '搜索跟进记录'),
        q = el('input'),
        stateLabel = el('label', '跟进记录状态'),
        state = el('select'),
        submit = el('button', '查询跟进记录', 'button secondary');
      q.maxLength = 120;
      q.value = caseFilters.q;
      qLabel.append(q);
      state.setAttribute('aria-label', '跟进记录状态');
      for (const [v, name] of [
        ['ALL', '全部状态'],
        ['OPEN', '进行中'],
        ['CLOSED', '已结案'],
      ]) {
        const o = el('option', name);
        o.value = v;
        state.append(o);
      }
      state.value = caseFilters.state;
      stateLabel.append(state);
      submit.type = 'submit';
      form.append(qLabel, stateLabel, submit);
      form.onsubmit = (e) => {
        e.preventDefault();
        caseFilters = { q: q.value.trim(), state: state.value };
        caseCursors = [null];
        casePage = 0;
        void loadCases();
      };
      root.append(form);
      for (const r of data.rows) {
        const card = el('article', undefined, 'card followup-case-card');
        card.append(
          el('h2', r.activity_title + ' · ' + r.student_name),
          el(
            'p',
            `发布版本 ${r.activity_version} · ${r.state === 'CLOSED' ? '已结案' : '进行中'} · 记录版本 ${r.revision}`,
          ),
          el('p', '最近处理：' + new Date(Number(r.updated_at)).toLocaleString('zh-CN')),
        );
        const open = el('button', '查看跟进记录', 'button secondary');
        open.onclick = () => void loadCaseDetail(r.id);
        card.append(open);
        root.append(card);
      }
      if (!data.rows.length) root.append(el('p', '暂无匹配的人工跟进记录。'));
      const prev = el('button', '上一页跟进记录', 'button secondary'),
        next = el('button', '下一页跟进记录', 'button secondary');
      prev.disabled = casePage === 0;
      next.disabled = !data.next;
      prev.onclick = () => {
        casePage--;
        void loadCases();
      };
      next.onclick = () => {
        caseCursors[++casePage] = data.next;
        void loadCases();
      };
      root.append(el('p', `跟进记录第 ${casePage + 1} 页`), prev, next);
    } catch (e) {
      if (current === generation) error(e.message);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  async function loadCaseDetail(id, cursor = null) {
    view = 'cases';
    history.replaceState(null, '', '#followup-case-' + id);
    const current = ++generation;
    controller?.abort();
    clear();
    root.setAttribute('aria-busy', 'true');
    try {
      const data = await caseRequest(
        '/' + id + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      if (current !== generation) return;
      const r = data.record;
      root.append(
        el('h1', r.activity_title + ' · ' + r.student_name),
        el(
          'p',
          `人工跟进：${r.state === 'CLOSED' ? '已结案' : '进行中'} · 版本 ${r.revision} · 活动发布版本 ${r.activity_version}`,
        ),
      );
      root.append(
        el(
          'p',
          `创建人：${r.creator_name} · ${new Date(Number(r.created_at)).toLocaleString('zh-CN')}`,
        ),
        el('p', '关联选课记录：' + r.enrollment_id, 'muted'),
      );
      const evidence = el('details');
      evidence.append(
        el('summary', '查看创建时的事实依据'),
        el(
          'p',
          (followLabels[r.evidence.reason] || r.evidence.reason) +
            ' · ' +
            new Date(Number(r.evidence.asOf)).toLocaleString('zh-CN'),
        ),
        el('p', '此快照不是当前学习完成或成绩证明。'),
      );
      root.append(evidence);
      const edit = el(
          'button',
          r.state === 'CLOSED' ? '重新打开跟进' : '追加跟进或结案',
          'button secondary',
        ),
        back = el('button', '返回跟进记录列表', 'button secondary');
      edit.onclick = () => editCase(null, r);
      back.onclick = () => {
        view = 'cases';
        void loadCases();
      };
      root.append(edit, back);
      if (nestedContext) {
        const plan = el('a', '制定／查看补救计划', 'button secondary');
        plan.href = `/zhiban/teacher/courses/${course}/remediation?space=${tenant}&offering=${offering}#case-${r.id}`;
        root.append(plan);
      }
      const reminders = el('section', undefined, 'card');
      root.append(reminders);
      reminderCleanup = window.zhibanReminders?.mount(reminders, tenant, offering, r);
      root.append(el('h2', '处理历史'));
      const names = {
        CREATE_CASE: '创建跟进',
        ADD_NOTE: '追加跟进',
        CLOSE_CASE: '结案',
        REOPEN_CASE: '重新打开',
      };
      for (const event of data.rows) {
        const card = el('article', undefined, 'card followup-case-card');
        card.append(
          el('h3', names[event.action] + ' · ' + event.actor_name),
          el(
            'p',
            new Date(Number(event.created_at)).toLocaleString('zh-CN') +
              ' · 版本 ' +
              event.revision,
          ),
          el('p', event.body, 'followup-note-body'),
        );
        root.append(card);
      }
      if (data.next) {
        const next = el('button', '查看更早处理记录', 'button secondary');
        next.onclick = () => void loadCaseDetail(id, data.next);
        root.append(next);
      }
      if (cursor) {
        const latest = el('button', '回到最新处理记录', 'button secondary');
        latest.onclick = () => void loadCaseDetail(id);
        root.append(latest);
      }
    } catch (e) {
      if (current === generation) error(e.message);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  async function load(selection) {
    if (view === 'cases') return loadCases();
    if (view === 'followups') return loadFollowups();
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    clear();
    root.setAttribute('aria-busy', 'true');
    root.append(el('p', '正在读取教学班统计…', 'muted'));
    const requestController = controller;
    const timer = setTimeout(() => requestController.abort(), 10000);
    try {
      const q = selection
        ? '?' +
          new URLSearchParams({ activityId: selection.id, version: String(selection.version) })
        : '';
      const r = await fetch(
        '/api/zhiban/analytics/' +
          encodeURIComponent(tenant) +
          '/offerings/' +
          encodeURIComponent(offering) +
          q,
        {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (current !== generation) return;
      if (!r.ok) {
        error(
          r.status === 401
            ? '登录已失效，请返回工作台重新登录。'
            : r.status === 403
              ? '当前身份没有该教学班的任教权限。'
              : r.status === 409
                ? '活动发布版本已变更，请重新打开统计页面。'
                : '统计暂不可用，请稍后重新打开页面。',
        );
        return;
      }
      const result = await r.json();
      if (current !== generation) return;
      state = result;
      render();
    } catch {
      if (current === generation) error('统计读取失败，请检查连接并重新打开页面。');
    } finally {
      clearTimeout(timer);
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      generation++;
      controller?.abort();
      root.setAttribute('aria-busy', 'false');
      if (caseDialog) {
        setNoteDirty(false);
        caseDialog.close();
        caseDialog.remove();
        caseDialog = null;
      }
      error('登录状态已变化，请返回工作台。');
    };
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void load(null);
  });
  window.addEventListener('pagehide', () => {
    generation++;
    controller?.abort();
    clear();
    channel?.close();
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const course = params.get('course');
  const simpleContext = [...params.keys()].sort().join(',') === 'offering,tenant';
  const nestedContext =
    [...params.keys()].sort().join(',') === 'course,offering,role,tenant' &&
    params.get('role') === 'teacher' &&
    uuid.test(course);
  const validContext = simpleContext || nestedContext;
  const courseReturn = nestedContext
    ? `/zhiban/teacher/courses/${course}/analytics?space=${tenant}&offering=${offering}`
    : '/zhiban?space=' + encodeURIComponent(tenant || '');
  if (nestedContext && !window.zhibanCoursePage?.embedded) {
    const back = document.querySelector('.topbar .brand');
    back.href = courseReturn;
    back.textContent = '← 返回课程工作区';
  }
  if (!tenant || !offering || !uuid.test(tenant) || !uuid.test(offering) || !validContext) {
    error('教学班地址无效，请从工作台进入教师统计。');
    root.setAttribute('aria-busy', 'false');
  } else {
    const initialCase = /^#followup-case-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
    if (initialCase) void loadCaseDetail(initialCase);
    else void load(null);
  }
})();
