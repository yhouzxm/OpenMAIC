/* Read-only bounded course workspace. A listed course is never an authorization capability. */
(() => {
  // Context is navigation only; server queries still decide course access.
  const returnLink = document.querySelector('[data-workspace-return]');
  const context = new URLSearchParams(location.search);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const routePattern =
    /^\/zhiban\/(teacher|student)\/courses\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(classrooms|resources|students|grades|analytics|introduction|coursework|discussions))?$/;
  const courseRoute = (path) => {
    const m = routePattern.exec(path);
    if (!m) return null;
    const allowed =
      m[1] === 'teacher'
        ? ['', 'classrooms', 'resources', 'students', 'grades', 'analytics', 'discussions']
        : ['', 'introduction', 'coursework', 'resources', 'grades', 'discussions'];
    return allowed.includes(m[3] ?? '')
      ? { role: m[1], courseId: m[2], section: m[3] ?? '' }
      : null;
  };
  const courseHref = (role, courseId, tenant, offering, section = '') =>
    `/zhiban/${role}/courses/${courseId}${section ? '/' + section : ''}?space=${tenant}&offering=${offering}`;
  if (returnLink && uuid.test(context.get('tenant') ?? '')) {
    const query = new URLSearchParams({ space: context.get('tenant') });
    if (uuid.test(context.get('offering') ?? '')) query.set('offering', context.get('offering'));
    const role = context.get('role'),
      course = context.get('course');
    if (
      ['teacher', 'student'].includes(role) &&
      uuid.test(course ?? '') &&
      uuid.test(context.get('offering') ?? '')
    ) {
      returnLink.href = courseHref(
        role,
        course,
        context.get('tenant'),
        context.get('offering'),
        'resources',
      );
      returnLink.textContent = '返回课程工作区';
    } else {
      returnLink.href = '/zhiban?' + query;
      returnLink.textContent = '返回课程工作台';
    }
  }
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = el('button', text, 'button secondary');
    b.type = 'button';
    b.addEventListener('click', () => void fn());
    return b;
  };
  const link = (text, url) => {
    const a = el('a', text, 'button secondary');
    a.href = url;
    return a;
  };
  const errors = {
    UNAUTHENTICATED: '登录已失效，请重新登录。',
    FORBIDDEN: '当前身份或课程关系已变化，请刷新空间。',
    INVALID_INPUT: '查询条件无效，请重新搜索。',
  };
  window.zhibanWorkspace = {
    courseRoute,
    async render(tenant, root) {
      let q = '',
        state = 'ALL',
        limit = '20',
        cursors = [null],
        index = 0,
        generation = 0,
        destroyed = false,
        loading = false,
        observer = null,
        channel = null;
      const controllers = new Set(),
        children = new Set();
      async function request(kind, filters) {
        const c = new AbortController();
        controllers.add(c);
        const timer = setTimeout(() => c.abort(), 10000);
        try {
          const search = new URLSearchParams(
            Object.entries(filters).filter(([, v]) => v !== null && v !== undefined),
          );
          const r = await (window.zhibanMemberPresentation?.read || fetch)(
            `/api/zhiban/workspace/${tenant}/${kind}?${search}`,
            {
              headers: { 'x-zhiban-request': 'identity-v1' },
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
            },
          );
          const data = await r.json();
          if (!r.ok)
            throw Object.assign(
              new Error(errors[data.error?.code] || '课程暂时无法读取，请稍后重试。'),
              { status: r.status },
            );
          return data;
        } finally {
          clearTimeout(timer);
          controllers.delete(c);
        }
      }
      function clear() {
        children.forEach((fn) => fn());
        children.clear();
        root.replaceChildren();
      }
      function destroy() {
        if (destroyed) return;
        destroyed = true;
        generation++;
        controllers.forEach((c) => c.abort());
        clear();
        observer?.disconnect();
        channel?.close();
        window.removeEventListener('pagehide', destroy);
      }
      function filterForm(
        parent,
        { searchLabel, sizeLabel, statusLabel, query, size, status, submit },
      ) {
        const f = el('form', undefined, 'course-filters');
        const label = el('label', searchLabel),
          input = el('input');
        input.value = query;
        input.maxLength = 120;
        input.setAttribute('aria-label', searchLabel);
        label.append(input);
        f.append(label);
        const sizeSelect = el('select'),
          sl = el('label', sizeLabel);
        sizeSelect.setAttribute('aria-label', sizeLabel);
        for (const v of ['10', '20', '50']) {
          const o = el('option', v);
          o.value = v;
          sizeSelect.append(o);
        }
        sizeSelect.value = size;
        sl.append(sizeSelect);
        let stateSelect = null;
        if (statusLabel) {
          const st = el('label', statusLabel);
          stateSelect = el('select');
          stateSelect.setAttribute('aria-label', statusLabel);
          for (const [v, t] of [
            ['ALL', '全部'],
            ['OPEN', '开放'],
            ['CLOSED', '关闭'],
          ]) {
            const o = el('option', t);
            o.value = v;
            stateSelect.append(o);
          }
          stateSelect.value = status;
          st.append(stateSelect);
          f.append(st);
        }
        f.append(sl);
        const b = el('button', '搜索', 'button secondary');
        b.type = 'submit';
        f.append(b);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          submit(input.value.trim(), sizeSelect.value, stateSelect?.value);
        });
        parent.append(f);
        return f;
      }
      async function drawCourse(route) {
        const offering = context.get('offering');
        // This extra field forces a full activity-page navigation; it never supplies authority.
        const taskNavigation =
          context.getAll('classroomTask').length === 1 &&
          uuid.test(context.get('classroomTask') ?? '') &&
          context.getAll('classroomAttempt').length === 1 &&
          uuid.test(context.get('classroomAttempt') ?? '') &&
          route.role === 'student' &&
          route.section === 'coursework' &&
          /^#classroom-activity-[0-9a-f-]{36}-[1-9][0-9]{0,14}-[0-9a-f-]{36}$/.test(location.hash);
        const jointNavigation =
          taskNavigation &&
          ['jointResource', 'jointPublication', 'jointDispatch'].every(
            (k) => context.getAll(k).length === 1 && uuid.test(context.get(k) ?? ''),
          );
        if (
          !uuid.test(offering ?? '') ||
          context.getAll('offering').length !== 1 ||
          context.getAll('space').length !== 1 ||
          [...context.keys()].some(
            (k) =>
              ![
                'space',
                'offering',
                ...(taskNavigation ? ['classroomTask', 'classroomAttempt'] : []),
                ...(jointNavigation ? ['jointResource', 'jointPublication', 'jointDispatch'] : []),
              ].includes(k),
          )
        ) {
          clear();
          root.append(
            el('p', '课程地址无效，请从课程列表进入。', 'notice'),
            link('返回我的课程', `/zhiban?space=${tenant}`),
          );
          return;
        }
        const data = await request('courses', { q: offering, limit: '50' });
        if (destroyed || !root.isConnected) return;
        root.dispatchEvent(
          new CustomEvent('workspace-context', { detail: { roles: data.roles || [] } }),
        );
        const mode = route.role.toUpperCase();
        const o =
          data.mode === 'MEMBER'
            ? data.rows.find(
                (row) =>
                  row.id === offering && row.course_id === route.courseId && row.mode === mode,
              )
            : null;
        if (!o) {
          clear();
          root.append(
            el('p', '当前课程不可访问，或课程关系已变化。', 'notice'),
            link('返回我的课程', `/zhiban?space=${tenant}`),
          );
          return;
        }
        clear();
        const wrap = el('section', undefined, `course-workspace ${route.role}-course`);
        wrap.dataset.offering = o.id;
        wrap.dataset.course = o.course_id;
        wrap.dataset.mode = mode;
        const listUrl = `/zhiban?space=${tenant}`;
        const hero = el('header', undefined, 'course-hero');
        const heading = el('div', undefined, 'course-hero-copy');
        heading.append(
          link('← 返回', listUrl),
          el('h1', o.course_name),
          el('p', `课程代码：${o.code}　学期：${o.term_name}`),
        );
        hero.append(heading);
        const titleBadges = el('span', undefined, 'course-title-badges');
        titleBadges.append(
          el('span', o.status === 'OPEN' ? '进行中' : '已结束', 'course-status'),
          el('span', route.role === 'teacher' ? '授课教师' : '学生', 'course-role'),
        );
        heading.querySelector('h1').append(titleBadges);
        if (route.role === 'teacher') {
          const settings = el('a', '课程设置', 'button secondary course-settings-link');
          settings.href = `/zhiban/teacher/courses/${o.course_id}/settings?space=${tenant}&offering=${o.id}`;
          hero.append(settings);
        }

        if (route.role === 'student') hero.append(el('div', '▤', 'course-hero-cover'));
        wrap.append(hero);
        const body = el('div', undefined, 'course-body');
        const nav = el('nav', undefined, 'course-inner-nav');
        nav.setAttribute('aria-label', '课程内导航');
        const items =
          route.role === 'teacher'
            ? [
                ['', '章节'],
                ['classrooms', '课堂与互动'],
                ['pbl', 'PBL 项目'],
                ['resources', '课程资源'],
                ['agents', '智能体中心'],
                ['learning-center', '学习中心'],
                ['discussions', '课程讨论'],
                ['students', '选课学生'],
                ['teachers', '任教名单'],
                ['settings', '课程设置'],
                ['grades', '学生成绩'],
                ['analytics', '教学分析'],
                ['remediation', '补救计划'],
                ['risk', '风险规则与审阅'],
                ['concepts', '概念纠错'],
                ['learning-profile', '学习证据画像'],
                ['tutor', 'AI 学习辅导'],
              ]
            : [
                ['', '章节'],
                ['introduction', '课程简介'],
                ['coursework', '学习活动'],
                ['resources', '课程资源'],
                ['learning-center', '学习中心'],
                ['discussions', '课程讨论'],
                ['grades', '学习成绩'],
                ['reminders', '站内提醒'],
                ['remediation', '补救任务'],
                ['concepts', '概念纠错'],
                ['learning-profile', '学习证据画像'],
                ['tools', 'AI 学习辅导'],
              ];
        for (const [section, title] of items) {
          const a = el('a', title);
          a.href = courseHref(route.role, o.course_id, tenant, o.id, section);
          if (section === route.section) a.setAttribute('aria-current', 'page');
          nav.append(a);
        }
        const panel = el('section', undefined, 'course-panel');
        panel.setAttribute('aria-label', '课程内容');
        body.append(nav, panel);
        wrap.append(body);
        root.append(wrap);
        const contentUrl = courseHref(route.role, o.course_id, tenant, o.id, 'resources');
        if (route.section === '') {
          const stats = el('div', undefined, 'course-overview-stats');
          panel.append(stats);
          const slots = [];
          for (const [title, part, icon] of [
            ['课堂与场景', route.role === 'teacher' ? 'classrooms' : 'coursework', '▤'],
            ['PBL 项目', 'pbl', '◇'],
            ['课程资源', 'resources', '▱'],
            ['启用智能体', route.role === 'teacher' ? 'agents' : 'tools', '♧'],
          ]) {
            const card = el('a', undefined, 'course-stat');
            card.href = courseHref(route.role, o.course_id, tenant, o.id, part);
            const count = el('strong', '—');
            const copy = el('div');
            copy.append(el('span', title), count);
            card.append(el('span', icon, 'course-stat-icon'), copy);
            stats.append(card);
            slots.push(count);
          }
          const readStat = async (path, slot, select) => {
            try {
              const r = await (window.zhibanMemberPresentation?.read || fetch)(path, {
                headers: { 'x-zhiban-request': 'identity-v1' },
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(10000),
              });
              if (!r.ok) return;
              const v = await r.json();
              if (!destroyed && stats.isConnected) slot.textContent = select(v);
            } catch {
              /* An unavailable statistic never becomes a fabricated zero. */
            }
          };
          void (async () => {
            await readStat(
              `/api/zhiban/learning/${tenant}/offerings/${o.id}/classrooms`,
              slots[0],
              (v) => String(v.sessions.length),
            );
            await readStat(
              `/api/zhiban/pbl/${tenant}/offerings/${o.id}`,
              slots[1],
              (v) => String(v.rows.length) + (v.next ? '+' : ''),
            );
            await readStat(
              `/api/zhiban/tutor/${tenant}/offerings/${o.id}?mode=${mode}`,
              slots[3],
              (v) => (v.policy.enabled ? '1' : '0'),
            );
          })();
          const outlineRoot = el('section');
          panel.append(outlineRoot);
          outlineRoot.addEventListener('outline-summary', (e) => {
            slots[2].textContent = e.detail.resources === null ? '—' : String(e.detail.resources);
          });
          if (window.zhibanCurriculum) {
            const cleanup = await window.zhibanCurriculum.render(
              tenant,
              o,
              outlineRoot,
              route.role,
              (section) => courseHref(route.role, o.course_id, tenant, o.id, section),
            );
            if (typeof cleanup === 'function') children.add(cleanup);
          }
        } else if (route.section === 'discussions') {
          const cleanup = await window.zhibanDiscussion.render(tenant, o, panel);
          if (typeof cleanup === 'function') children.add(cleanup);
        } else if (['classrooms', 'coursework'].includes(route.section)) {
          panel.append(el('h2', route.role === 'teacher' ? '课堂与互动' : '学习活动'));
          panel.append(el('p', '当前教学班的文字活动与提交记录。', 'muted'));
          if (window.zhibanClassrooms) {
            const classroomRoot = el('section');
            panel.append(classroomRoot);
            const done = await window.zhibanClassrooms.render(
              tenant,
              o,
              classroomRoot,
              route.role,
              (part) => courseHref(route.role, o.course_id, tenant, o.id, part),
            );
            children.add(done);
          }
          const taskContext =
            /^#classroom-activity-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(
              location.hash,
            );
          if (taskContext)
            panel.append(
              link(
                '返回本次课堂',
                courseHref(
                  route.role,
                  o.course_id,
                  tenant,
                  o.id,
                  route.role === 'teacher' ? 'classrooms' : 'coursework',
                ) +
                  '#classroom-' +
                  taskContext[3],
              ),
            );
          const activityRoot = el('section', undefined, 'course-activities');
          panel.append(activityRoot);
          if (window.zhibanLearning) {
            const cleanup = await window.zhibanLearning.render(tenant, o, activityRoot, (id) => id);
            if (typeof cleanup === 'function') children.add(cleanup);
          }
        } else if (route.section === 'introduction') {
          panel.append(
            el('h2', '课程简介'),
            el('p', o.course_description || '暂无课程简介。', 'course-description'),
          );
          panel.append(el('p', `${o.name} · ${o.term_name}`, 'muted'));
        } else if (route.section === 'students') {
          panel.append(el('h2', '选课学生'));
          const list = el('section', undefined, 'course-student-list');
          panel.append(list);
          let cursors = [null],
            page = 0,
            closed = false;
          children.add(() => {
            closed = true;
          });
          const read = async () => {
            list.replaceChildren(el('p', '正在读取学生名单…', 'muted'));
            try {
              const data = await request('roster', {
                offering: o.id,
                limit: '20',
                cursor: cursors[page],
              });
              if (destroyed || closed || !list.isConnected) return;
              list.replaceChildren();
              for (const row of data.rows)
                list.append(el('p', row.name || row.membership_id, 'course-student-row'));
              if (!data.rows.length) list.append(el('p', '当前页没有学生。', 'muted'));
              const pager = el('nav', undefined, 'course-pagination');
              pager.setAttribute('aria-label', '选课学生分页');
              pager.append(el('span', `第 ${page + 1} 页 · 本页 ${data.rows.length} 人`));
              const previous = button('上一页学生', () => {
                if (page > 0) {
                  page--;
                  void read();
                }
              });
              previous.disabled = page === 0;
              const next = button('下一页学生', () => {
                if (data.nextCursor) {
                  cursors[++page] = data.nextCursor;
                  void read();
                }
              });
              next.disabled = !data.nextCursor;
              pager.prepend(previous);
              pager.append(next);
              list.append(pager);
            } catch (e) {
              if (!destroyed && !closed)
                list.replaceChildren(el('p', e.message, 'notice'), button('重试名单', read));
            }
          };
          void read();
        }
      }
      function draw(data) {
        clear();
        const globalClassroom =
          window.zhibanClassrooms &&
          [
            '/zhiban/classroom',
            '/zhiban/teacher/classrooms',
            '/zhiban/student/classrooms',
          ].includes(location.pathname);
        const header = el('div', undefined, 'workspace-header');
        header.append(el('h2', globalClassroom ? '课堂入口 · 选择教学班' : '我的课程'));
        root.append(header);
        const catalogFilters = filterForm(root, {
          searchLabel: '搜索我的课程',
          sizeLabel: '课程每页条数',
          statusLabel: '课程状态',
          query: q,
          size: limit,
          status: state,
          submit: (v, l, s) => {
            if (loading) return;
            q = v;
            limit = l;
            state = s;
            index = 0;
            cursors = [null];
            void load();
          },
        });
        catalogFilters.id = 'catalog-filters';
        const searchLabel = catalogFilters.querySelector('label');
        const searchInput = searchLabel.querySelector('input');
        searchInput.setAttribute('form', catalogFilters.id);
        searchInput.placeholder = '课程名称 / 课程代码';
        searchLabel.classList.add('catalog-search');
        header.append(searchLabel);
        const subtitle = el('p', '选择课程进入教学工作区', 'catalog-subtitle');
        header.insertBefore(subtitle, searchLabel);
        const list = el('div', undefined, 'academic-grid workspace-courses');
        root.append(list);
        for (const o of data.rows) {
          const card = el('article', undefined, 'card academic-card course-list-card');
          card.dataset.offering = o.id;
          const cover = el('a', undefined, 'course-cover');
          cover.setAttribute('aria-hidden', 'true');
          cover.append(el('span', '▤'), el('small', '智伴·创学'));
          const summary = el('div', undefined, 'course-list-summary');
          const titleRow = el('div', undefined, 'course-list-title');
          titleRow.append(el('h3', o.course_name));
          const roleBadge = el(
            'span',
            o.mode === 'TEACHER' ? '任课教师' : '已选课程',
            'course-role-badge',
          );
          titleRow.append(roleBadge);
          summary.append(
            titleRow,
            el('p', `课程代码：${o.code || '—'}`, 'course-list-meta'),
            el('p', `学期：${o.term_name}`, 'course-list-meta'),
          );
          const stateBadge = el(
            'span',
            o.status === 'OPEN' ? '进行中' : '已结束',
            `course-state-badge ${o.status === 'OPEN' ? 'is-open' : ''}`,
          );
          titleRow.append(stateBadge);
          const enter = link(
            globalClassroom ? '进入课堂任务' : '进入课程工作区 →',
            courseHref(
              o.mode.toLowerCase(),
              o.course_id,
              tenant,
              o.id,
              globalClassroom ? (o.mode === 'TEACHER' ? 'classrooms' : 'coursework') : '',
            ),
          );
          enter.classList.add('course-enter-link');
          cover.href = enter.href;
          cover.removeAttribute('aria-hidden');
          cover.setAttribute('aria-label', `进入${o.course_name}`);
          const titleLink = el('a', o.course_name);
          titleLink.href = enter.href;
          titleRow.querySelector('h3').replaceChildren(titleLink);
          card.append(cover, summary, enter);
          list.append(card);
          if (context.get('offering') === o.id) {
            const learning = card.querySelector('details.learning-section');
            if (learning) learning.open = true;
          }
        }
        if (!data.rows.length)
          list.append(
            el(
              'p',
              index
                ? '本页已无可访问课程，可返回上一页或重新搜索。'
                : '暂无可访问课程。管理员指定任教或添加有效选课后，课程会出现在这里。',
              'muted',
            ),
          );
        const nav = el('nav', undefined, 'course-pagination');
        nav.setAttribute('aria-label', '课程分页');
        const prev = button('上一页课程', () => {
            if (!loading && index > 0) {
              index--;
              return load();
            }
          }),
          next = button('下一页课程', () => {
            if (!loading && data.nextCursor) {
              cursors[++index] = data.nextCursor;
              return load();
            }
          });
        prev.disabled = index === 0;
        next.disabled = !data.nextCursor;
        nav.append(prev, el('span', `第 ${index + 1} 页 · 本页 ${data.rows.length} 门`), next);
        root.append(nav);
      }
      async function load() {
        if (destroyed || loading) return true;
        loading = true;
        const epoch = ++generation;
        root.querySelectorAll('button,input,select').forEach((n) => (n.disabled = true));
        try {
          const route = courseRoute(location.pathname);
          if (route) {
            await drawCourse(route);
            return true;
          }
          const data = await request('courses', { q, state, limit, cursor: cursors[index] });
          if (destroyed || epoch !== generation || !root.isConnected) return true;
          root.dispatchEvent(
            new CustomEvent('workspace-context', { detail: { roles: data.roles } }),
          );
          if (data.mode === 'ADMIN') {
            clear();
            const admin = el('section', undefined, 'management-root'),
              message = el('p', undefined, 'management-message'),
              content = el('section');
            message.setAttribute('role', 'status');
            message.setAttribute('aria-live', 'polite');
            admin.append(
              el('h2', '教务管理'),
              el('p', '课程、学期、行政班、教学班、学生名单与操作历史。支持搜索和分页。', 'muted'),
              message,
              content,
            );
            root.append(admin);
            children.add(window.zhibanManagement.mount(tenant, content, message));
            return true;
          }
          draw(data);
          return true;
        } catch (e) {
          if (!destroyed && epoch === generation && root.isConnected) {
            clear();
            const p = el('p', e.message, 'notice');
            p.setAttribute('role', 'alert');
            root.append(
              p,
              button('重试课程', () => load()),
            );
          }
          return true;
        } finally {
          loading = false;
        }
      }
      root.replaceChildren(el('p', '正在加载我的课程…', 'muted'));
      await load();
      if (!root.isConnected) {
        destroy();
        return true;
      }
      channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      if (channel)
        channel.onmessage = () => {
          destroy();
          if (root.isConnected) root.append(el('p', '登录状态已变化，请返回工作台。', 'notice'));
        };
      window.addEventListener('pagehide', destroy, { once: true });
      observer = new MutationObserver(() => {
        if (!root.isConnected) destroy();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return true;
    },
  };
})();
