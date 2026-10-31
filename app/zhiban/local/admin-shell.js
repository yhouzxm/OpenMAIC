/* Shared administrator presentation. Server mode is checked before standalone views mount. */
(() => {
  // Independent page widgets authenticate the same session. Serialize only their
  // reads; every request still reaches server authorization, with no cached result.
  let readTail = Promise.resolve();
  function read(input, options = {}) {
    if (options.method && options.method !== 'GET') return fetch(input, options);
    const response = readTail.then(() => fetch(input, options));
    readTail = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }
  window.zhibanMemberPresentation = { read, spaceName };
  // Inline vector icons respect the existing CSP; no remote fonts or data URL images.
  const vectorPaths = {
    folder: ['M3 7V4h7l2 3h9v13H3Z'],
    bot: ['M5 8h14v12H5ZM12 3v5M2 12v5m20-5v5M9 12v3m6-3v3'],
    brand: [
      'M18 2a16 16 0 1 0 0 32 16 16 0 0 0 0-32',
      'm7 15 11-5 11 5-11 5-11-5',
      'M12 18v7c4 3 8 3 12 0v-7m5-3v9',
    ],
    user: ['M24 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'M10 40c0-17 28-17 28 0'],
    book: ['M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Z', 'M12 5v15'],
    chart: ['M4 3v17h17', 'M8 15V9m5 6V5m5 10v-4'],
    grid: ['M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z'],
  };
  function vector(kind, cls) {
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    svg.setAttribute(
      'viewBox',
      kind === 'brand' ? '0 0 36 36' : kind === 'user' ? '0 0 48 48' : '0 0 24 24',
    );
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', kind === 'user' ? '3' : '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of vectorPaths[kind]) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }
  function decorate() {
    if (!document.body.classList.contains('portal')) return;
    const top = document.querySelector('.topbar');
    document.querySelectorAll('.course-stat-icon').forEach((icon, i) => {
      if (!icon.querySelector('svg'))
        icon.replaceChildren(
          vector(['book', 'grid', 'folder', 'bot'][i % 4], 'course-stat-vector'),
        );
    });
    for (const nav of document.querySelectorAll('.course-inner-nav')) {
      if (nav.dataset.referenceLayout || !location.pathname.startsWith('/zhiban/teacher/courses/'))
        continue;
      nav.dataset.referenceLayout = 'true';
      const anchors = [...nav.querySelectorAll(':scope > a')];
      const key = (a) => new URL(a.href).pathname.split('/').slice(5).join('/');
      const order = [
        ['', '章节'],
        ['classrooms', '课堂与互动'],
        ['pbl', 'PBL 项目'],
        ['teachers', '课程教师'],
        ['students', '选课学生'],
        ['grades', '学生成绩'],
        ['analytics', '教学分析'],
        ['risk', '风险预警'],
        ['agents', '智能体中心'],
      ];
      const primary = new Set([...order.map(([k]) => k), 'settings']);
      for (const [k, title] of order) {
        const a = anchors.find((a) => key(a) === k);
        if (a) {
          a.textContent = title;
          nav.append(a);
        }
      }
      const extra = anchors.filter((a) => !primary.has(key(a)));
      if (extra.length) {
        const details = el('details', undefined, 'course-more-tools');
        details.append(el('summary', '更多课程工具'), ...extra);
        nav.append(details);
      }
      const settings = anchors.find((a) => key(a) === 'settings');
      if (settings) nav.append(settings);
    }
    if (top) {
      if (top.querySelector('.topbar-actions')) top.querySelector('.header-exit')?.remove();
      const context = new URLSearchParams(location.search);
      const tenant = context.get('tenant') || context.get('space');
      if (tenant && /^[a-f0-9-]{36}$/.test(tenant) && !top.dataset.accountLoading) {
        top.dataset.accountLoading = 'true';
        void read(`/api/zhiban/profile/${tenant}/me`, {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
        })
          .then(async (response) => {
            if (!response.ok || !top.isConnected) return;
            const info = await response.json();
            if (!top.querySelector('.header-account')) {
              const account = el(
                'a',
                info.displayName || info.formalName || '个人资料',
                'header-account',
              );
              account.href = `/zhiban/profile?tenant=${tenant}`;
              top.append(account);
            }
            if (
              ![...top.querySelectorAll('button')].some((button) => /退出/.test(button.textContent))
            ) {
              const exit = el('button', '退出', 'button secondary header-exit');
              exit.type = 'button';
              exit.onclick = async () => {
                exit.disabled = true;
                try {
                  const proof = await read('/api/zhiban/identity/csrf', {
                    headers: { 'x-zhiban-request': 'identity-v1' },
                    credentials: 'same-origin',
                    cache: 'no-store',
                  });
                  if (!proof.ok) throw Error();
                  const { csrfToken } = await proof.json();
                  const result = await fetch('/api/zhiban/identity/logout', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                      'x-zhiban-request': 'identity-v1',
                      'Content-Type': 'application/json',
                      'x-zhiban-csrf': csrfToken,
                    },
                    body: '{}',
                  });
                  if (!result.ok) throw Error();
                  location.assign('/zhiban');
                } catch {
                  exit.disabled = false;
                  exit.textContent = '重试退出';
                }
              };
              top.append(exit);
            }
          })
          .catch(() => {});
      }
      const profile = document.querySelector('.sidebar-profile');
      if (profile && profile.textContent.trim()) {
        let account = top.querySelector('.header-account');
        if (!account) {
          account = el('a', '', 'header-account');
          top.append(account);
        }
        if (account.textContent !== profile.textContent.trim())
          account.textContent = profile.textContent.trim();
        if (account.href !== profile.href) account.href = profile.href;
      }
      for (const toggle of document.querySelectorAll('.nav-toggle')) {
        if (!toggle.dataset.hamburger) {
          toggle.dataset.hamburger = 'true';
          toggle.setAttribute('aria-label', '打开或关闭导航菜单');
          const frame = document
            .getElementById(toggle.getAttribute('aria-controls'))
            ?.closest('.role-shell');
          if (frame && matchMedia('(max-width: 800px)').matches) {
            frame.classList.remove('nav-open');
            toggle.setAttribute('aria-expanded', 'false');
          }
        }
        if (toggle.parentElement !== top) top.append(toggle);
      }
      const course = document.querySelector('.course-workspace');
      if (course && !top.querySelector('.nav-toggle')) {
        const nav = course.querySelector('.course-inner-nav');
        if (nav) {
          nav.id ||= 'course-navigation';
          const toggle = el('button', '课程菜单', 'nav-toggle');
          toggle.type = 'button';
          toggle.dataset.hamburger = 'true';
          toggle.setAttribute('aria-label', '打开或关闭课程菜单');
          toggle.setAttribute('aria-controls', nav.id);
          toggle.setAttribute('aria-expanded', 'false');
          toggle.onclick = () =>
            toggle.setAttribute(
              'aria-expanded',
              String(course.classList.toggle('course-nav-open')),
            );
          top.append(toggle);
        }
      }
    }
    for (const brand of document.querySelectorAll('.topbar .brand'))
      if (!brand.querySelector('.portal-brand-icon'))
        brand.prepend(vector('brand', 'portal-brand-icon'));
    for (const title of document.querySelectorAll('.role-title'))
      if (
        !title.closest('.role-sidebar')?.querySelector('.sidebar-profile') &&
        !title.querySelector('.portal-user-icon')
      )
        title.prepend(vector('user', 'portal-user-icon'));
    for (const nav of document.querySelectorAll('.role-nav-item, .course-inner-nav a')) {
      if (nav.querySelector('.portal-nav-icon')) continue;
      const kind = /课程|讲义|资源|章节|目录/.test(nav.textContent)
        ? 'book'
        : /资料|账户|学生|任教/.test(nav.textContent)
          ? 'user'
          : /成绩|分析|风险/.test(nav.textContent)
            ? 'chart'
            : 'grid';
      nav.prepend(vector(kind, 'portal-nav-icon'));
    }
    for (const cover of document.querySelectorAll('.course-cover > span'))
      if (!cover.querySelector('svg')) cover.replaceChildren(vector('book', 'portal-cover-icon'));
    for (const avatar of document.querySelectorAll('.profile-avatar:not(:has(img))'))
      if (!avatar.querySelector('svg')) avatar.prepend(vector('user', 'portal-avatar-icon'));
  }
  decorate();
  document.addEventListener('click', (event) => {
    const item = event.target.closest?.('.role-nav a[href], .course-inner-nav a[href]');
    if (!item || event.defaultPrevented || !matchMedia('(max-width: 800px)').matches) return;
    document
      .querySelectorAll('.nav-open,.course-nav-open')
      .forEach((frame) => frame.classList.remove('nav-open', 'course-nav-open'));
    document
      .querySelectorAll('.topbar .nav-toggle')
      .forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
    try {
      sessionStorage.setItem('zhiban-nav-open', 'false');
    } catch {
      /* Navigation works without storage. */
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document
      .querySelectorAll('.nav-open,.course-nav-open')
      .forEach((frame) => frame.classList.remove('nav-open', 'course-nav-open'));
    document
      .querySelectorAll('.topbar .nav-toggle')
      .forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
  });
  const presentation = new MutationObserver(decorate);
  presentation.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => presentation.disconnect(), { once: true });
  const labels = {
    offerings: '教学班',
    courses: '课程',
    terms: '学期',
    classes: '行政班',
    history: '操作历史',
  };
  const params = new URLSearchParams(location.search);
  const tenant = params.get('tenant');
  if (location.pathname === '/zhiban/admin/accounts') document.body.dataset.adminPage = 'accounts';
  const page = document.body.dataset.adminPage;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const managementUrl = (tenant, section = 'offerings', offering = null) =>
    `/zhiban/management?tenant=${tenant}&section=${section}${offering ? '&offering=' + offering : ''}`;
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function navigation(nav, tenant, section = 'offerings', directory = false) {
    nav.replaceChildren();
    nav.setAttribute('aria-label', '管理员教务导航');
    nav.append(el('p', '教学管理', 'admin-nav-group'));
    for (const [key, title] of Object.entries(labels)) {
      const a = el('a', title, 'role-nav-item');
      a.href = managementUrl(tenant, key);
      a.dataset.adminSection = key;
      if (!directory && !['accounts', 'imports', 'onboarding'].includes(page) && key === section)
        a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    const attainment = el('a', '校内证书与跨班学分', 'role-nav-item');
    attainment.href = '/zhiban/attainment?tenant=' + tenant + '&mode=ADMIN';
    nav.append(attainment);
    const services = el('a', '服务与运行中心', 'role-nav-item');
    services.href = '/zhiban/admin/services?tenant=' + tenant;
    nav.append(services);
    const students = el('a', '学生目录', 'role-nav-item');
    students.href = `/zhiban/directory?tenant=${tenant}`;
    if (directory) students.setAttribute('aria-current', 'page');
    nav.append(el('p', '成员管理', 'admin-nav-group'), students);
    const accounts = el('a', '成员账户目录', 'role-nav-item');
    accounts.href = `/zhiban/admin/accounts?tenant=${tenant}`;
    if (page === 'accounts') accounts.setAttribute('aria-current', 'page');
    const profile = el('a', '个人资料与账户', 'role-nav-item');
    profile.href = `/zhiban/profile?tenant=${tenant}`;
    const onboarding = el('a', '普通账户开通', 'role-nav-item');
    onboarding.href = `/zhiban/admin/onboarding?tenant=${tenant}`;
    if (page === 'onboarding') onboarding.setAttribute('aria-current', 'page');
    const imports = el('a', '教务批量导入', 'role-nav-item');
    imports.href = `/zhiban/admin/import?tenant=${tenant}`;
    if (page === 'imports') imports.setAttribute('aria-current', 'page');
    nav.append(accounts, onboarding, imports, profile);
  }
  function table(list, kind) {
    const articles = [...list.children].filter((n) => n.tagName === 'ARTICLE');
    if (!articles.length) return;
    list.classList.add('admin-table');
    list.setAttribute('role', 'table');
    list.setAttribute('aria-label', (labels[kind] || '成员') + '列表');
    const titles =
      kind === 'history'
        ? ['操作', '对象与操作人', '状态']
        : ['名称 / 编号', '信息 / 状态', '操作'];
    const header = el('div', undefined, 'admin-table-head');
    header.setAttribute('role', 'row');
    for (const title of titles) {
      const cell = el('div', title);
      cell.setAttribute('role', 'columnheader');
      header.append(cell);
    }
    list.prepend(header);
    for (const article of articles) {
      const name = el('div'),
        info = el('div'),
        actions = el('div', undefined, 'admin-row-actions');
      const cells = [name, info, actions];
      cells.forEach((cell, i) => {
        cell.setAttribute('role', 'cell');
        cell.dataset.label = titles[i];
      });
      const children = [...article.children];
      for (const node of children) {
        if (/^H[23]$/.test(node.tagName)) name.append(node);
        else if (['BUTTON', 'A', 'DETAILS', 'FORM'].includes(node.tagName)) actions.append(node);
        else if (node.tagName === 'SMALL' && !name.querySelector('small')) name.append(node);
        else info.append(node);
      }
      if (kind === 'history') {
        const status = [...info.children].find((n) => n.textContent === '已完成');
        if (status) actions.append(status);
      }
      article.setAttribute('role', 'row');
      article.append(...cells);
    }
  }
  async function bootstrap() {
    if (!page) return true;
    const main = document.querySelector('main');
    main.hidden = true;
    const loading = el('p', '正在确认管理员权限…', 'loading');
    main.before(loading);
    try {
      if (!uuid.test(tenant ?? '') || params.getAll('tenant').length !== 1)
        throw Error('空间地址无效，请从工作台进入。');
      const r = await read(`/api/zhiban/workspace/${tenant}/courses?limit=10`, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok || (await r.json()).mode !== 'ADMIN')
        throw Error('当前身份没有管理员教务权限，请返回工作台。');
      document.body.classList.add('portal', 'admin-portal');
      const top = document.querySelector('.topbar');
      const brand = top.querySelector('.brand');
      brand.textContent = '智伴·创学管理后台';
      brand.href = `/zhiban?space=${tenant}`;
      top.querySelector('.local').textContent = '机构管理员';
      const frame = el('div', undefined, 'role-shell admin-frame');
      const side = el('aside', undefined, 'role-sidebar');
      side.setAttribute('aria-label', '管理员导航');
      side.id = 'admin-navigation';
      side.append(el('p', '机构管理员', 'role-title'));
      const nav = el('nav', undefined, 'role-nav');
      navigation(
        nav,
        tenant,
        params.get('section') || (params.get('classId') ? 'classes' : 'offerings'),
        page === 'directory',
      );
      side.append(nav);
      const panel = el('div', undefined, 'admin-main');
      const crumbs = el('div', undefined, 'admin-context');
      const back = el(
        'a',
        page === 'relationships' || page === 'roster' ? '← 返回原名录' : '← 返回工作台',
      );
      back.href =
        page === 'relationships' || page === 'roster'
          ? managementUrl(
              tenant,
              params.has('classId') ? 'classes' : 'offerings',
              params.get('offering'),
            )
          : `/zhiban?space=${tenant}`;
      crumbs.append(
        back,
        el(
          'span',
          '教学管理 / ' +
            {
              management: labels[params.get('section')] || '教学班',
              directory: '学生目录',
              accounts: '成员账户目录',
              onboarding: '普通账户开通',
              imports: '教务批量导入',
              relationships: params.has('classId') ? '行政班成员' : '任教关系',
              roster: '名册批量导入',
            }[page],
        ),
      );
      main.classList.add('admin-surface');
      main.hidden = false;
      const toggle = el('button', '展开管理导航', 'button secondary nav-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', side.id);
      toggle.onclick = () => {
        const open = frame.classList.toggle('nav-open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '收起管理导航' : '展开管理导航';
      };
      loading.replaceWith(toggle, frame);
      panel.append(crumbs, main);
      frame.append(side, panel);
      document.addEventListener('management-context', (event) => {
        navigation(nav, tenant, event.detail.section);
        const title = event.detail.offering ? '教学班学生名单' : labels[event.detail.section];
        crumbs.lastElementChild.textContent = '教学管理 / ' + title;
        if (page === 'management')
          main.querySelector('h1').textContent = title === '操作历史' ? title : title + '管理';
      });
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      if (channel)
        channel.onmessage = () => {
          channel.close();
          location.reload();
        };
      window.addEventListener('pagehide', () => channel?.close(), { once: true });
      return true;
    } catch (error) {
      main.remove();
      loading.textContent = error.message;
      loading.className = 'notice';
      const back = el('a', '返回工作台');
      back.href = '/zhiban';
      loading.after(back);
      return false;
    }
  }
  async function mountMemberNavigation() {
    const main = document.querySelector('main');
    const memberPages = [
      'profile-root',
      'global-grades',
      'global-support',
      'global-authoring',
      'global-tools',
      'attainment',
    ];
    const space = params.get('space') || params.get('tenant');
    if (page || !main || !memberPages.includes(main.id) || !uuid.test(space || '')) return;
    try {
      const headers = { 'x-zhiban-request': 'identity-v1' };
      const response = await read(`/api/zhiban/workspace/${space}/courses?limit=10`, {
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.mode !== 'MEMBER') return;
      const role = data.roles.includes('TEACHER')
        ? 'teacher'
        : data.roles.includes('STUDENT')
          ? 'student'
          : null;
      if (!role) return;
      document.body.classList.add('portal', 'member-shell-page');
      const frame = el('div', undefined, 'role-shell member-shell');
      const side = el('aside', undefined, 'role-sidebar');
      side.setAttribute('aria-label', '角色导航');
      side.id = 'member-navigation';
      const profile = el('a', undefined, 'sidebar-profile');
      profile.href = `/zhiban/${role === 'teacher' ? 'teacher/profile' : 'student/settings'}?tenant=${space}`;
      const avatar = el('span', undefined, 'sidebar-avatar');
      avatar.append(vector('user', 'sidebar-user-vector'));
      const name = el('span', '个人资料', 'sidebar-profile-name');
      profile.append(avatar, name);
      const unit = el('p', '正在读取单位…', 'sidebar-unit');
      side.append(profile, el('p', role === 'teacher' ? '教师' : '学生', 'role-title'), unit);
      void spaceName(space)
        .then((name) => {
          if (unit.isConnected) unit.textContent = name || '单位未登记';
        })
        .catch(() => {
          unit.textContent = '单位暂不可用';
        });
      const nav = el('nav', undefined, 'role-nav');
      nav.setAttribute('aria-label', '工作台导航');
      const entries =
        role === 'teacher'
          ? [
              ['我的课程', '/zhiban'],
              ['学生成绩', '/zhiban/teacher/grades'],
              ['学习分析', '/zhiban/teacher/profiles'],
              ['AI 备课', '/zhiban/teacher/agents'],
              ['风险预警', '/zhiban/teacher/risks'],
            ]
          : [
              ['校内证书与学分', '/zhiban/attainment'],
              ['我的课程', '/zhiban'],
              ['测评与成绩', '/zhiban/student/grades'],
              ['学习档案', '/zhiban/student/profile'],
              ['学习支持', '/zhiban/student/risks'],
              ['AI 学习辅导', '/zhiban/student/tools'],
            ];
      for (const [label, path] of entries) {
        const a = el('a', label, 'role-nav-item');
        a.href =
          path === '/zhiban/attainment'
            ? `${path}?tenant=${space}&mode=STUDENT`
            : `${path}?space=${space}`;
        if (location.pathname === path) a.setAttribute('aria-current', 'page');
        nav.append(a);
      }
      side.append(nav);
      const panel = el('div', undefined, 'role-main');
      const toggle = el('button', '展开角色导航', 'button secondary nav-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', side.id);
      toggle.setAttribute('aria-expanded', 'false');
      try {
        if (sessionStorage.getItem('zhiban-nav-open') === 'true') {
          frame.classList.add('nav-open');
          toggle.setAttribute('aria-expanded', 'true');
          toggle.textContent = '收起角色导航';
        }
      } catch {}
      toggle.onclick = () => {
        const open = frame.classList.toggle('nav-open');
        try {
          sessionStorage.setItem('zhiban-nav-open', String(open));
        } catch {}
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '收起角色导航' : '展开角色导航';
      };
      main.before(toggle, frame);
      frame.append(side, panel);
      panel.append(main);
      const profileResponse = await read(`/api/zhiban/profile/${space}/me`, {
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (profileResponse.ok) {
        const info = await profileResponse.json();
        name.textContent = info.displayName || info.formalName || '个人资料';
        if (info.avatar?.png) {
          const image = el('img');
          image.src = `data:image/png;base64,${info.avatar.png}`;
          image.alt = '';
          avatar.replaceChildren(image);
        }
      }
    } catch {
      /* Existing page supplies its own session and error handling. */
    }
  }
  const spaceNames = new Map();
  function spaceName(id) {
    if (!spaceNames.has(id))
      spaceNames.set(
        id,
        (async () => {
          let after = null;
          for (let page = 0; page < 20; page++) {
            const response = await read(
              '/api/zhiban/identity/spaces?limit=50' + (after ? '&afterMembershipId=' + after : ''),
              {
                headers: { 'x-zhiban-request': 'identity-v1' },
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(10000),
              },
            );
            if (!response.ok) {
              console.warn('ZHIBAN_SPACE_READ', response.status);
              throw Error('单位暂不可用');
            }
            const data = await response.json();
            const space = data.spaces.find((space) => space.tenantId === id);
            if (space) return space.displayName;
            if (!data.nextCursor) return '';
            after = data.nextCursor;
          }
          return '';
        })(),
      );
    return spaceNames.get(id);
  }
  void mountMemberNavigation();
  window.zhibanAdminShell = { ready: bootstrap(), navigation, table, managementUrl, labels };
})();
