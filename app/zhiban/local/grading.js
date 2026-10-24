/* Teacher-only bounded review queue. A queue row never supplies authorization. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('grading-list'),
    message = document.getElementById('grading-message'),
    editor = document.getElementById('grading-editor');
  const params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = params.get('tenant'),
    offering = params.get('offering');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const course = params.get('course'),
    role = params.get('role');
  const fromCourse =
    course !== null &&
    role === 'teacher' &&
    uuid.test(course) &&
    params.getAll('course').length === 1 &&
    params.getAll('role').length === 1;
  const noCourse = course === null && role === null;
  // Fixed UUID-only navigation hints; the queue still checks current teacher access.
  const classroom = /^#classroom-grading-([0-9a-f-]{36})-([0-9a-f-]{36})$/.exec(location.hash);
  const followup = /^#followup-grading-([0-9a-f-]{36})-([0-9a-f-]{36})$/.exec(location.hash);
  const invalidFollowup =
    location.hash.startsWith('#followup-grading') &&
    (!followup || !followup.slice(1).every((id) => uuid.test(id)));
  const invalidClassroom =
    location.hash.startsWith('#classroom-grading') &&
    (!classroom || !fromCourse || !classroom.slice(1).every((id) => uuid.test(id)));
  if (
    invalidClassroom ||
    invalidFollowup ||
    !uuid.test(tenant || '') ||
    !uuid.test(offering || '') ||
    [...params.keys()].some(
      (k) => !['tenant', 'offering', ...(fromCourse ? ['course', 'role'] : [])].includes(k),
    ) ||
    (!fromCourse && !noCourse) ||
    params.getAll('tenant').length !== 1 ||
    params.getAll('offering').length !== 1
  ) {
    message.textContent = '评分地址无效，请从教师工作台进入。';
    return;
  }
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = el('button', text);
    b.type = 'button';
    b.onclick = () => void fn();
    return b;
  };
  let activityType = 'ALL';
  let q = '',
    state = classroom ? 'ALL' : 'TODO',
    activity = followup?.[1] ?? classroom?.[1] ?? null,
    activityName = followup?.[1] ?? classroom?.[1] ?? '',
    limit = '20',
    cursors = [null],
    page = 0,
    epoch = 0,
    closed = false,
    loading = false,
    selected = null,
    gradeCleanup = null,
    pickerCleanup = () => {};
  let bookCleanup = null,
    bookMode = !!window.zhibanGradebook && !classroom && !followup && location.hash !== '#queue';
  const modeBar = el('nav');
  modeBar.setAttribute('aria-label', '成绩视图');
  root.before(modeBar);
  async function showBook() {
    if (loading || closed) return;
    bookMode = true;
    closeEditor();
    pickerCleanup();
    await reloadBook();
  }
  async function reloadBook() {
    loading = true;
    modeBar.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      if (bookCleanup) await bookCleanup.refresh();
      else bookCleanup = await window.zhibanGradebook.render(root, tenant, offering, review);
      if (closed) bookCleanup?.();
    } finally {
      loading = false;
      modeBar.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }
  modeBar.append(
    ...(window.zhibanGradebook ? [button('课程成绩簿', showBook)] : []),
    button('待评分列表', () => {
      if (loading || closed) return;
      bookMode = false;
      bookCleanup?.();
      bookCleanup = null;
      closeEditor();
      return load();
    }),
  );
  const controllers = new Set();
  async function request(domain, kind, filters) {
    const c = new AbortController();
    controllers.add(c);
    const timer = setTimeout(() => c.abort(), 10000);
    try {
      const search = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== null && v !== undefined),
      );
      const r = await fetch(
        `/api/zhiban/${domain}/${tenant}/offerings/${offering}/${kind}?${search}`,
        {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: c.signal,
        },
      );
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          {
            FORBIDDEN: '当前任教或教师授权已失效。',
            UNAUTHENTICATED: '登录已失效，请返回工作台。',
            INVALID_INPUT: '筛选或游标无效，请重新查询。',
          }[data.error?.code] || '评分名单暂时不可用，请重试。',
        );
      return data;
    } finally {
      clearTimeout(timer);
      controllers.delete(c);
    }
  }
  function closeEditor() {
    selected = null;
    gradeCleanup?.();
    gradeCleanup = null;
    editor.replaceChildren();
  }
  async function review(row) {
    closeEditor();
    selected = row.id;
    const slot = el('section');
    editor.append(
      el('h2', row.student_name + ' · ' + row.activity_title),
      button(bookMode ? '返回成绩簿' : '关闭评分', () => {
        closeEditor();
        if (bookMode) root.scrollIntoView({ block: 'nearest' });
      }),
      slot,
    );
    const destroy = await window.zhibanAssessment.render(
      tenant,
      { id: offering },
      slot,
      (id) => (id === row.membership_id ? row.student_name : id),
      { paged: true, review: true, submissions: [{ id: row.id }], activities: [], attempts: [] },
      () => (bookMode ? reloadBook() : load()),
    );
    if (closed || selected !== row.id || !slot.isConnected) destroy?.();
    else gradeCleanup = destroy;
  }
  function reset() {
    cursors = [null];
    page = 0;
  }
  function picker(parent) {
    const details = el('details');
    details.append(el('summary', '按活动筛选'));
    const panel = el('section');
    details.append(panel);
    parent.append(details);
    let dead = false,
      index = 0,
      history = [null],
      query = '',
      busy = false,
      version = 0,
      initialized = false;
    pickerCleanup = () => {
      dead = true;
      version++;
    };
    async function read() {
      if (dead || closed || busy) return;
      busy = true;
      const generation = ++version;
      panel.querySelectorAll('input,button').forEach((n) => (n.disabled = true));
      try {
        const data = await request('learning', 'activities', {
          q: query,
          limit: '10',
          cursor: history[index],
        });
        if (dead || closed || version !== generation || !panel.isConnected) return;
        panel.replaceChildren();
        const form = el('form', undefined, 'course-filters'),
          label = el('label', '搜索筛选活动'),
          input = el('input');
        input.maxLength = 120;
        input.value = query;
        label.append(input);
        const submit = el('button', '查询筛选活动');
        submit.type = 'submit';
        form.append(label, submit);
        form.onsubmit = (e) => {
          e.preventDefault();
          if (busy) return;
          query = input.value.trim();
          history = [null];
          index = 0;
          void read();
        };
        panel.append(form);
        for (const a of data.rows)
          panel.append(
            button('选择活动 ' + a.title, () => {
              if (loading) return;
              activity = a.id;
              activityName = a.title;
              reset();
              closeEditor();
              return load();
            }),
          );
        if (!data.rows.length) panel.append(el('p', '暂无匹配活动。'));
        const prev = button('上一页活动选项', () => {
            if (!busy && index > 0) {
              index--;
              return read();
            }
          }),
          next = button('下一页活动选项', () => {
            if (!busy && data.nextCursor) {
              history[++index] = data.nextCursor;
              return read();
            }
          });
        prev.disabled = index === 0;
        next.disabled = !data.nextCursor;
        panel.append(el('p', `活动选项第 ${index + 1} 页`), prev, next);
      } catch (e) {
        if (!dead && !closed)
          panel.replaceChildren(el('p', e.message), button('重试活动选项', read));
      } finally {
        busy = false;
      }
    }
    details.addEventListener('toggle', () => {
      if (details.open && !initialized) {
        initialized = true;
        void read();
      }
    });
  }
  async function load() {
    if (closed || loading) return;
    loading = true;
    modeBar.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const generation = ++epoch;
    root.querySelectorAll('input,select,button').forEach((n) => (n.disabled = true));
    try {
      const data = await request('assessment', 'queue', {
        q,
        state,
        activityType,
        activity,
        ...(followup ? { member: followup[2] } : {}),
        limit,
        cursor: cursors[page],
      });
      if (closed || generation !== epoch) return;
      if (activity && data.rows.length) activityName = data.rows[0].activity_title;
      pickerCleanup();
      root.replaceChildren();
      message.textContent = '';
      const back = el('a', fromCourse ? '返回课程工作区' : '返回课程工作台', 'button secondary');
      back.href = fromCourse
        ? `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}`
        : '/zhiban?space=' + tenant;
      if (followup) {
        const followupBack = el('a', '返回待跟进名单', 'button secondary');
        followupBack.href = fromCourse
          ? `/zhiban/teacher/courses/${course}/analytics?space=${tenant}&offering=${offering}#followups`
          : `/zhiban/analytics?tenant=${tenant}&offering=${offering}#followups`;
        root.append(
          followupBack,
          el(
            'p',
            '已限定原活动与学生；名单不授予评分权限，提交与评分继续由原页面重新核验。',
            'muted',
          ),
        );
      }
      if (classroom) {
        const classroomBack = el('a', '返回本次课堂', 'button secondary');
        classroomBack.href =
          `/zhiban/teacher/courses/${course}/classrooms?space=${tenant}&offering=${offering}` +
          '#classroom-' +
          classroom[2];
        root.append(classroomBack);
        root.append(
          el(
            'p',
            '课堂入口预选活动并包含已发布成绩；可调整筛选。列表按活动汇总教学班尝试，并非仅限本课堂进入记录。',
            'muted',
          ),
        );
      }
      if (!window.zhibanCoursePage?.embedded) root.append(back);
      root.append(el('h2', '最新正式提交'));
      const f = el('form', undefined, 'course-filters'),
        label = el('label', '搜索学生或活动'),
        input = el('input');
      input.value = q;
      input.maxLength = 120;
      input.placeholder = '学生姓名、完整成员 ID 或发布版本活动标题';
      label.append(input);
      f.append(label);
      const st = el('label', '评分状态'),
        select = el('select');
      select.setAttribute('aria-label', '评分状态');
      for (const [v, t] of [
        ['TODO', '待处理（未评分／待发布）'],
        ['UNSCORED', '未评分'],
        ['MANUAL', '待简答评分'],
        ['DRAFT', '待发布'],
        ['PUBLISHED', '已发布'],
        ['ALL', '全部'],
      ]) {
        const o = el('option', t);
        o.value = v;
        select.append(o);
      }
      select.value = state;
      st.append(select);
      f.append(st);
      const typeLabel = el('label', '活动类型'),
        typeSelect = el('select');
      typeSelect.setAttribute('aria-label', '活动类型');
      for (const [value, label] of [
        ['ALL', '全部活动'],
        ['TEXT_RESPONSE', '文字作业'],
        ['QUIZ', '课程测验'],
      ]) {
        const option = el('option', label);
        option.value = value;
        typeSelect.append(option);
      }
      typeSelect.value = activityType;
      typeLabel.append(typeSelect);
      f.append(typeLabel);
      const sz = el('label', '评分每页条数'),
        size = el('select');
      size.setAttribute('aria-label', '评分每页条数');
      for (const v of ['10', '20', '50']) {
        const o = el('option', v);
        o.value = v;
        size.append(o);
      }
      size.value = limit;
      sz.append(size);
      f.append(sz);
      const submit = el('button', '查询评分');
      submit.type = 'submit';
      f.append(submit);
      f.onsubmit = (e) => {
        e.preventDefault();
        if (loading) return;
        q = input.value.trim();
        state = select.value;
        activityType = typeSelect.value;
        limit = size.value;
        reset();
        closeEditor();
        void load();
      };
      root.append(f);
      root.append(el('p', activity ? '已选活动：' + activityName : '活动：全部', 'muted'));
      if (activity)
        root.append(
          button('清除活动筛选', () => {
            activity = null;
            activityName = '';
            reset();
            closeEditor();
            return load();
          }),
        );
      picker(root);
      root.append(button('刷新评分名单', load));
      const list = el('div', undefined, 'management-list grading-rows');
      root.append(list);
      for (const row of data.rows) {
        const card = el('article', undefined, 'management-card');
        card.append(
          el('h3', row.activity_title),
          el(
            'p',
            `${row.student_name} · 尝试 ${row.attempt_no} · 活动版本 ${row.activity_version} · 提交版本 ${row.submission_version}`,
          ),
          el(
            'p',
            {
              UNSCORED: '未评分',
              MANUAL: '待简答评分',
              DRAFT: '评分草稿待发布',
              PUBLISHED: '已发布 · 成绩版本 ' + row.published_version,
            }[row.grading_state],
          ),
          el('small', row.membership_id),
          button(row.grading_state === 'PUBLISHED' ? '查看成绩／更正' : '打开评分', () =>
            review(row),
          ),
        );
        if (row.lab_notebook_id && fromCourse) {
          const report = el('a', '查看完整实验数据与版本', 'button secondary');
          report.href = `/zhiban/teacher/courses/${course}/classroom-plan?space=${tenant}&offering=${offering}#notebook-${row.lab_notebook_id}`;
          card.append(report);
        }
        list.append(card);
      }
      if (!data.rows.length) list.append(el('p', '暂无匹配的正式提交。'));
      const nav = el('nav', undefined, 'course-pagination');
      nav.setAttribute('aria-label', '评分名单分页');
      const prev = button('上一页评分', () => {
          if (!loading && page > 0) {
            page--;
            closeEditor();
            return load();
          }
        }),
        next = button('下一页评分', () => {
          if (!loading && data.nextCursor) {
            cursors[++page] = data.nextCursor;
            closeEditor();
            return load();
          }
        });
      prev.disabled = page === 0;
      next.disabled = !data.nextCursor;
      nav.append(prev, el('span', `第 ${page + 1} 页 · 本页 ${data.rows.length} 条`), next);
      root.append(nav);
    } catch (e) {
      if (!closed && generation === epoch) {
        pickerCleanup();
        closeEditor();
        root.replaceChildren(el('p', e.message, 'notice'), button('重新读取评分名单', load));
      }
    } finally {
      loading = false;
      modeBar.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    epoch++;
    controllers.forEach((c) => c.abort());
    pickerCleanup();
    bookCleanup?.();
    closeEditor();
    root.replaceChildren();
    message.textContent = '会话已变化，请返回工作台。';
    channel?.close();
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel) channel.onmessage = close;
  window.addEventListener('pagehide', close, { once: true });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  void (bookMode ? showBook() : load());
})();
