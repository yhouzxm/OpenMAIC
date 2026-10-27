/* Shared administrator presentation. Server mode is checked before standalone views mount. */
(() => {
  // Inline vector icons respect the existing CSP; no remote fonts or data URL images.
  const vectorPaths = {
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
    for (const brand of document.querySelectorAll('.topbar .brand'))
      if (!brand.querySelector('.portal-brand-icon'))
        brand.prepend(vector('brand', 'portal-brand-icon'));
    for (const title of document.querySelectorAll('.role-title'))
      if (!title.querySelector('.portal-user-icon'))
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
      const r = await fetch(`/api/zhiban/workspace/${tenant}/courses?limit=10`, {
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
  window.zhibanAdminShell = { ready: bootstrap(), navigation, table, managementUrl, labels };
})();
