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
          const r = await fetch(`/api/zhiban/workspace/${tenant}/${kind}?${search}`, {
            headers: { 'x-zhiban-request': 'identity-v1' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: c.signal,
          });
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
      function roster(o, parent, names) {
        let query = '',
          size = '20',
          history = [null],
          page = 0,
          busy = false,
          epoch = 0,
          closed = false;
        const dispose = () => {
          closed = true;
          epoch++;
          names.clear();
        };
        children.add(dispose);
        async function read() {
          if (busy || closed || destroyed) return;
          busy = true;
          const version = ++epoch;
          parent.querySelectorAll('input,select,button').forEach((n) => (n.disabled = true));
          try {
            const result = await request('roster', {
              offering: o.id,
              q: query,
              limit: size,
              cursor: history[page],
            });
            if (closed || destroyed || version !== epoch || !parent.isConnected) return;
            parent.replaceChildren();
            names.clear();
            filterForm(parent, {
              searchLabel: '搜索学生名单',
              sizeLabel: '名单每页条数',
              query,
              size,
              submit: (v, l) => {
                if (busy) return;
                query = v;
                size = l;
                history = [null];
                page = 0;
                void read();
              },
            });
            const list = el('div', undefined, 'course-roster');
            parent.append(list);
            for (const row of result.rows) {
              names.set(row.membership_id, row.name || row.membership_id);
              const item = el('p');
              item.append(el('span', row.name || '未填写姓名'), el('small', row.membership_id));
              list.append(item);
            }
            if (!result.rows.length)
              list.append(
                el(
                  'p',
                  page ? '本页已无记录，可返回上一页或重新搜索。' : '暂无匹配学生。',
                  'muted',
                ),
              );
            const nav = el('nav', undefined, 'course-pagination');
            nav.setAttribute('aria-label', '学生名单分页');
            const prev = button('上一页学生', () => {
                if (!busy && page > 0) {
                  page--;
                  return read();
                }
              }),
              next = button('下一页学生', () => {
                if (!busy && result.nextCursor) {
                  history[++page] = result.nextCursor;
                  return read();
                }
              });
            prev.disabled = page === 0;
            next.disabled = !result.nextCursor;
            nav.append(prev, el('span', `第 ${page + 1} 页 · 本页 ${result.rows.length} 人`), next);
            parent.append(nav);
          } catch (e) {
            if (!closed && !destroyed && version === epoch) {
              parent.replaceChildren(el('p', e.message, 'notice'), button('重试学生名单', read));
            }
          } finally {
            busy = false;
          }
        }
        void read();
        return dispose;
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
        const listUrl = `${route.role === 'teacher' ? '/zhiban/teacher/courses' : '/zhiban'}?space=${tenant}`;
        const hero = el('header', undefined, 'course-hero');
        const heading = el('div', undefined, 'course-hero-copy');
        heading.append(
          link('← 返回我的课程', listUrl),
          el('h1', o.course_name),
          el(
            'p',
            `${o.name} · ${o.term_name} · ${o.status === 'OPEN' ? '开放' : '已关闭'} · 发布版本 ${o.course_version}`,
          ),
        );
        hero.append(heading);
        if (route.role === 'student') hero.append(el('div', '▤', 'course-hero-cover'));
        wrap.append(hero);
        const body = el('div', undefined, 'course-body');
        const nav = el('nav', undefined, 'course-inner-nav');
        nav.setAttribute('aria-label', '课程内导航');
        const items =
          route.role === 'teacher'
            ? [
                ['', '课程概览'],
                ['classrooms', '课堂与互动'],
                ['resources', '讲义与图片'],
                ['agents', 'AI 备课'],
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
                ['', '目录'],
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
          panel.append(el('h2', route.role === 'teacher' ? '课程概览' : '课程目录'));
          panel.append(el('p', o.course_description || '暂无课程简介。', 'course-description'));
          panel.append(
            el(
              'p',
              `教学班代码 ${o.code} · 当前教学班 ${o.name} · ${o.enrolled_count}/${o.capacity} 人`,
              'muted',
            ),
          );
          const outlineRoot = el('section');
          panel.append(outlineRoot);
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
          panel.append(
            link(route.role === 'teacher' ? '编辑讲义与图片' : '查看讲义与图片', contentUrl),
            link(
              route.role === 'teacher' ? '进入课堂与互动' : '进入学习活动',
              courseHref(
                route.role,
                o.course_id,
                tenant,
                o.id,
                route.role === 'teacher' ? 'classrooms' : 'coursework',
              ),
            ),
          );
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
        header.append(
          el('h2', globalClassroom ? '课堂入口 · 选择教学班' : '我的课程'),
          button('刷新课程', () => load()),
        );
        root.append(
          header,
          el('p', '选择课程进入工作区，查看教学内容与学习活动。', 'catalog-subtitle'),
        );
        filterForm(root, {
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
        const list = el('div', undefined, 'academic-grid workspace-courses');
        root.append(list);
        for (const o of data.rows) {
          const card = el('article', undefined, 'card academic-card');
          card.dataset.offering = o.id;
          const cover = el('div', undefined, 'course-cover');
          cover.setAttribute('aria-hidden', 'true');
          cover.append(el('span', '▤'), el('small', '智伴·创学'));
          card.append(
            cover,
            el('h3', o.course_name),
            el('h4', o.name, 'offering-name'),
            el(
              'p',
              `${o.mode === 'TEACHER' ? '任教' : '选课'} · ${o.course_name} · 发布版本 ${o.course_version} · ${o.term_name}`,
            ),
            el(
              'p',
              `${o.status === 'OPEN' ? '开放' : '已关闭'} · ${o.enrolled_count}/${o.capacity} 人`,
            ),
            el('p', o.course_description, 'muted'),
          );
          card.append(
            link(
              globalClassroom ? '进入课堂任务' : '进入课程工作区',
              courseHref(
                o.mode.toLowerCase(),
                o.course_id,
                tenant,
                o.id,
                globalClassroom ? (o.mode === 'TEACHER' ? 'classrooms' : 'coursework') : '',
              ),
            ),
            link(
              o.mode === 'TEACHER' ? '教学内容 · 编辑与预览' : '查看教学内容',
              `/zhiban/content?tenant=${tenant}&offering=${o.id}`,
            ),
          );
          if (o.mode === 'TEACHER')
            card.append(
              link('教师统计', `/zhiban/analytics?tenant=${tenant}&offering=${o.id}`),
              link('待评分与成绩', `/zhiban/grading?tenant=${tenant}&offering=${o.id}`),
            );
          else
            card.append(link('我的学习概览', `/zhiban/progress?tenant=${tenant}&offering=${o.id}`));
          const names = new Map();
          if (o.mode === 'TEACHER') {
            const details = el('details');
            details.append(el('summary', '学生名单（分页）'));
            const panel = el('div');
            details.append(panel);
            let initialized = false;
            details.addEventListener('toggle', () => {
              if (details.open && !initialized) {
                initialized = true;
                roster(o, panel, names);
              }
            });
            card.append(details);
          } else card.append(el('p', '我的选课：当前有效', 'muted'));
          if (window.zhibanLearning) {
            const details = el('details', undefined, 'learning-section');
            details.append(el('summary', '学习活动与提交'));
            const panel = el('div', undefined, 'learning-panel');
            details.append(panel);
            let initialized = false;
            details.addEventListener('toggle', () => {
              if (details.open && !initialized) {
                initialized = true;
                void window.zhibanLearning.render(tenant, o, panel, (id) => names.get(id) || id);
              }
            });
            card.append(details);
          }
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
