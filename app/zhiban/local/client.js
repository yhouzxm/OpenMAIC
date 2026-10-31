/* Same-origin Identity client. Session stays exclusively in the HttpOnly cookie. */
(() => {
  const root = document.getElementById('app');
  let legacyLogin = location.pathname === '/zhiban/login';
  let loginDestination = null,
    loginSpace = null;
  if (legacyLogin) {
    const entry = new URLSearchParams(location.search),
      names = [...entry.keys()];
    loginSpace = entry.get('space') ?? entry.get('tenant');
    loginDestination = entry.get('destination');
    if (
      names.some((k) => !['space', 'tenant', 'destination'].includes(k)) ||
      new Set(names).size !== names.length ||
      (entry.has('space') && entry.has('tenant')) ||
      (loginSpace !== null &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          loginSpace,
        )) ||
      (loginDestination !== null && !['admin', 'admin-users'].includes(loginDestination))
    ) {
      const back = node('a', '返回工作台');
      back.href = '/zhiban';
      root.replaceChildren(
        node('h1', '登录地址无效'),
        node('p', '请从工作台或管理员入口重新进入。'),
        back,
      );
      return;
    }
  }
  let generation = 0;
  let renderedContext = null;
  const contextKey = (identity, spaces) =>
    JSON.stringify([
      identity.userId,
      spaces,
      location.pathname,
      new URL(location.href).searchParams.get('space'),
      new URL(location.href).searchParams.get('offering'),
    ]);
  let pending = false;
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  class ApiError extends Error {
    constructor(status) {
      super('Identity request failed');
      this.status = status;
    }
  }
  async function api(route, body, csrf) {
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['x-zhiban-csrf'] = csrf;
    const aliasLogin =
      route === 'login' && typeof body?.userId === 'string' && body.userId.trim().startsWith('@');
    const payload = aliasLogin ? { identifier: body.userId, password: body.password } : body;
    const response = await (window.zhibanMemberPresentation?.read || fetch)(
      aliasLogin ? '/api/zhiban/login-identifiers/login' : `/api/zhiban/identity/${route}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new ApiError(response.status);
    return response.status === 204 ? null : response.json();
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action, className = 'button') {
    const element = node('button', text, className);
    element.type = 'button';
    element.onclick = action;
    return element;
  }
  function message(parent, text) {
    const element = node('p', text, 'notice');
    element.setAttribute('role', 'alert');
    parent.append(element);
    return element;
  }
  function login(notice) {
    document
      .querySelectorAll('.topbar .header-account,.topbar .header-exit')
      .forEach((item) => item.remove());
    const top = document.querySelector('.topbar');
    if (top) delete top.dataset.accountLoading;
    document.querySelectorAll('.topbar .nav-toggle').forEach((toggle) => toggle.remove());
    document.querySelector('.topbar-actions')?.remove();
    document.body.classList.remove('admin-portal');
    document.body.dataset.screen = 'login';
    root.replaceChildren();
    const layout = node('section', undefined, 'login-layout');
    const card = node('section', undefined, 'card login-card');
    card.append(
      node('div', '学', 'login-emblem'),
      node('h1', '智伴·创学'),
      node('p', '登录后进入教学与学习工作台', 'muted'),
    );
    if (notice) message(card, notice);
    const form = node('form');
    const idLabel = node('label', '账号 ID 或 @登录标识');
    const id = node('input');
    id.name = 'userId';
    id.id = 'userId';
    id.type = 'text';
    id.required = true;
    id.autocomplete = 'username';
    id.placeholder = '请输入账号 ID 或已确认的 @登录标识';
    idLabel.htmlFor = id.id;
    const passwordLabel = node('label', '密码');
    const password = node('input');
    password.name = 'password';
    password.id = 'password';
    password.type = 'password';
    password.required = true;
    password.autocomplete = 'current-password';
    passwordLabel.htmlFor = password.id;
    const passwordField = node('div', undefined, 'password-field');
    const visibility = button(
      '',
      () => setPasswordVisible(password.type === 'password'),
      'password-toggle',
    );
    visibility.setAttribute('aria-controls', password.id);
    function setPasswordVisible(visible) {
      password.type = visible ? 'text' : 'password';
      const label = visible ? '隐藏密码' : '显示密码';
      visibility.setAttribute('aria-label', label);
      visibility.setAttribute('aria-pressed', String(visible));
      visibility.title = label;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({
        viewBox: '0 0 24 24',
        width: '20',
        height: '20',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }))
        svg.setAttribute(key, value);
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute(
        'd',
        'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0' +
          (visible ? ' M3 3l18 18' : ''),
      );
      svg.append(path);
      visibility.replaceChildren(svg);
    }
    setPasswordVisible(false);
    passwordField.append(password, visibility);
    const submit = node('button', '登录并进入');
    submit.type = 'submit';
    submit.className = 'button primary';
    const help = node('p', undefined, 'form-help');
    const environment = document.documentElement.dataset.zhibanEnvironment;
    if (environment === 'local' || environment === 'test') {
      help.append(
        document.createTextNode(
          environment === 'local' ? '请使用本地体验账号登录。' : '请使用分配的测试账号登录。',
        ),
        document.createElement('br'),
      );
    }
    const firstSetup = node('a', '首次登录，设置密码');
    firstSetup.href = '/zhiban/activate-account';
    help.append(firstSetup);
    form.append(idLabel, id, passwordLabel, passwordField, submit, help);
    card.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      submit.disabled = true;
      visibility.disabled = true;
      setPasswordVisible(false);
      submit.textContent = '正在登录…';
      card.querySelectorAll('.notice').forEach((element) => element.remove());
      try {
        await api('login', { userId: id.value.trim(), password: password.value });
        password.value = '';
        channel?.postMessage('session-changed');
        await refresh();
      } catch (error) {
        password.value = '';
        message(
          card,
          error instanceof ApiError && error.status === 401
            ? '账号或密码不正确，请重试。'
            : error instanceof ApiError && error.status === 429
              ? '登录尝试较多，请稍后重试。'
              : '暂时无法登录，请稍后重试；如仍无法登录，请联系管理员。',
        );
      } finally {
        pending = false;
        submit.disabled = false;
        visibility.disabled = false;
        submit.textContent = '登录并进入';
      }
    };
    layout.append(card);
    root.append(layout);
  }
  async function logout() {
    if (pending) return;
    pending = true;
    try {
      const { csrfToken } = await api('csrf');
      await api('logout', {}, csrfToken);
      generation++;
      history.replaceState(null, '', '/zhiban');
      channel?.postMessage('session-changed');
      login('已安全退出。');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        generation++;
        login('登录已失效，请重新登录。');
      } else message(root, '退出未完成，请重试。');
    } finally {
      pending = false;
    }
  }
  function workspace(identity, spaces) {
    document.body.classList.remove('admin-portal');
    document.body.dataset.screen = 'workspace';
    renderedContext = contextKey(identity, spaces);
    root.replaceChildren();
    const query = new URL(location.href).searchParams.get('space');
    const current = spaces.find((space) => space.tenantId === query);
    const header = node('div', undefined, 'workspace-header');
    const title = node('div');
    title.append(
      node('p', 'MY WORKSPACE', 'eyebrow'),
      node('h1', current ? current.displayName : '你的工作台'),
    );
    header.append(title);
    const top = document.querySelector('.topbar');
    top.querySelector('.topbar-actions')?.remove();
    const topActions = node('div', undefined, 'topbar-actions');
    topActions.append(button('退出', logout, 'button secondary'));
    top.append(topActions);
    root.append(header);
    void (window.zhibanMemberPresentation?.read || fetch)('/api/zhiban/platform', {
      headers: { 'x-zhiban-request': 'identity-v1' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (r) => {
        if (r.ok && (await r.json()).platformAdmin && header.isConnected) {
          const a = node('a', '平台管理', 'button secondary');
          a.href = '/zhiban/platform';
          header.append(a);
        }
      })
      .catch(() => {});
    const account = node('p', `已登录 · ${identity.userId}`, 'account');
    root.append(account);
    if (query && !current) message(root, '该空间当前不可访问。请选择你已加入的空间。');
    if (spaces.length === 0) {
      const empty = node('section', undefined, 'card empty');
      empty.append(
        node('span', '○', 'empty-icon'),
        node('h2', '你还没有加入空间'),
        node('p', '加入空间后，相关课程和学习活动会出现在这里。', 'muted'),
        button('刷新空间', refresh, 'button secondary'),
      );
      root.append(empty);
      return;
    }
    const switcher = node('section', undefined, 'spaces');
    switcher.setAttribute('aria-label', '选择空间');
    for (const space of spaces) {
      const item = button(
        '',
        async () => {
          history.pushState(null, '', `/zhiban?space=${encodeURIComponent(space.tenantId)}`);
          await refresh();
        },
        `space-card ${current?.tenantId === space.tenantId ? 'selected' : ''}`,
      );
      item.setAttribute('aria-pressed', String(current?.tenantId === space.tenantId));
      item.append(
        node('span', space.displayName, 'space-name'),
        node('span', space.tenantCode, 'space-code'),
      );
      switcher.append(item);
    }
    root.append(node('h2', '我的空间', 'section-title'), switcher);
    if (!current) {
      root.append(node('p', '选择一个空间，进入工作台。', 'muted selection-help'));
      return;
    }

    if (window.zhibanWorkspace?.courseRoute(location.pathname)) {
      document.body.dataset.screen = 'course';
      const mount = node('section', undefined, 'course-mount');
      root.replaceChildren(mount);
      void window.zhibanAcademic.render(current.tenantId, mount);
      return;
    }
    const academic = node('section');
    const shell = node('div', undefined, 'role-shell');
    const sidebar = node('aside', undefined, 'role-sidebar');
    sidebar.setAttribute('aria-label', '角色导航');
    sidebar.id = 'workspace-navigation';
    const pane = node('div', undefined, 'role-main');
    // Move space/account controls into the sidebar without changing session authority.
    const switcherHeading = root.querySelector('.section-title');
    if (switcherHeading) switcherHeading.remove();
    account.remove();
    const profileLink = node('a', undefined, 'sidebar-profile');
    const avatar = node('span', undefined, 'sidebar-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const avatarIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    avatarIcon.setAttribute('viewBox', '0 0 24 24');
    avatarIcon.setAttribute('aria-hidden', 'true');
    const avatarPath = document.createElementNS(avatarIcon.namespaceURI, 'path');
    avatarPath.setAttribute('d', 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z');
    avatarIcon.append(avatarPath);
    avatar.append(avatarIcon);
    const profileName = node('span', identity.userId, 'sidebar-profile-name');
    profileLink.append(avatar, profileName);
    const unit = node('p', current.displayName, 'sidebar-unit');
    sidebar.append(profileLink, unit);
    if (spaces.length > 1) sidebar.append(switcher);
    else switcher.remove();
    const nav = node('nav', undefined, 'role-nav');
    nav.setAttribute('aria-label', '工作台导航');
    sidebar.insertBefore(node('p', '正在确认角色…', 'role-title'), unit);
    sidebar.append(nav);
    pane.append(academic);
    const toggle = button(
      '展开角色导航',
      () => {
        const open = shell.classList.toggle('nav-open');
        try {
          sessionStorage.setItem('zhiban-nav-open', String(open));
        } catch {}
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '收起角色导航' : '展开角色导航';
      },
      'button secondary nav-toggle',
    );
    toggle.setAttribute('aria-expanded', 'false');
    try {
      if (sessionStorage.getItem('zhiban-nav-open') === 'true') {
        shell.classList.add('nav-open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.textContent = '收起角色导航';
      }
    } catch {}
    toggle.setAttribute('aria-controls', sidebar.id);
    root.append(toggle, shell);
    shell.append(sidebar, pane);
    academic.addEventListener('workspace-context', (event) => {
      const roles = event.detail.roles || [];
      const role = roles.includes('ADMIN')
        ? 'ADMIN'
        : roles.includes('TEACHER')
          ? 'TEACHER'
          : roles.includes('STUDENT')
            ? 'STUDENT'
            : 'MEMBER';
      document.body.dataset.role = role;
      profileLink.href = `${role === 'STUDENT' ? '/zhiban/student/settings' : role === 'TEACHER' ? '/zhiban/teacher/profile' : '/zhiban/profile'}?tenant=${encodeURIComponent(current.tenantId)}`;
      void fetch(`/api/zhiban/profile/${encodeURIComponent(current.tenantId)}/me`, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok || !profileLink.isConnected) return;
          const profile = await response.json();
          profileName.textContent = profile.displayName || profile.formalName || identity.userId;
          if (profile.avatar?.png) {
            const image = node('img');
            image.src = `data:image/png;base64,${profile.avatar.png}`;
            image.alt = '';
            avatar.replaceChildren(image);
          }
        })
        .catch(() => {});
      const names = { ADMIN: '机构管理员', TEACHER: '教师', STUDENT: '学生', MEMBER: '空间成员' };
      sidebar.querySelector('.role-title').textContent = roles.length
        ? roles.map((r) => names[r]).join(' / ')
        : names.MEMBER;
      nav.replaceChildren();
      if (role === 'ADMIN' && window.zhibanAdminShell) {
        document.body.classList.add('admin-portal');
        document.querySelector('.topbar .brand').textContent = '智伴·创学管理后台';
        window.zhibanAdminShell.navigation(nav, current.tenantId);
        academic.addEventListener('management-context', (e) =>
          window.zhibanAdminShell.navigation(nav, current.tenantId, e.detail.section),
        );
        return;
      }
      if (role === 'STUDENT') {
        const a = node('a', '校内证书与学分', 'role-nav-item');
        a.href = '/zhiban/attainment?tenant=' + current.tenantId + '&mode=STUDENT';
        nav.append(a);
      }
      const entries =
        role === 'ADMIN'
          ? ['教学管理', '用户管理', '学籍管理', '权限管理']
          : role === 'TEACHER'
            ? ['我的课程', '学生成绩', '学习分析', 'AI 备课', '风险预警']
            : ['我的课程', '测评与成绩', '学习档案', '学习支持', 'AI 学习辅导'];
      entries.forEach((label, index) => {
        const item = node(
          'a',
          role === 'ADMIN' && label === '用户管理' ? '用户管理 · 学生目录' : label,
          'role-nav-item',
        );
        if (index === 0) {
          item.href = `/zhiban?space=${encodeURIComponent(current.tenantId)}`;
          item.setAttribute('aria-current', 'page');
        } else if (
          (role === 'TEACHER' && label === '学生成绩') ||
          (role === 'STUDENT' && label === '测评与成绩')
        ) {
          item.href = `/zhiban/${role.toLowerCase()}/grades?space=${current.tenantId}`;
        } else if (
          (role === 'TEACHER' && label === '学习分析') ||
          (role === 'STUDENT' && label === '学习档案')
        ) {
          item.href = `/zhiban/${role.toLowerCase()}/${role === 'TEACHER' ? 'profiles' : 'profile'}?space=${current.tenantId}`;
        } else if (
          (role === 'TEACHER' && label === '风险预警') ||
          (role === 'STUDENT' && label === '学习支持')
        ) {
          item.href = `/zhiban/${role.toLowerCase()}/risks?space=${current.tenantId}`;
        } else if (role === 'STUDENT' && label === 'AI 学习辅导') {
          item.href = `/zhiban/student/tools?space=${current.tenantId}`;
        } else if (role === 'TEACHER' && label === 'AI 备课') {
          item.href = `/zhiban/teacher/agents?space=${current.tenantId}`;
        } else if (role === 'ADMIN' && label === '用户管理') {
          item.href = `/zhiban/directory?tenant=${encodeURIComponent(current.tenantId)}`;
        } else {
          // Course tools remain on their authorized course rows until their global pages migrate.
          const hint = ['学生成绩', '学习分析', '测评与成绩', '学习档案', '学籍管理'].includes(
            label,
          )
            ? '从课程内进入'
            : '暂未开放';
          item.setAttribute('aria-disabled', 'true');
          item.append(node('small', hint));
        }
        nav.append(item);
      });
    });
    void window.zhibanAcademic.render(current.tenantId, academic);
  }
  async function refresh(preserve = false) {
    const preserveLearning =
      preserve === true &&
      !!root.querySelector('.learning-section[open], .management-root, .course-workspace');
    const version = ++generation;
    if (!preserveLearning) root.replaceChildren(node('div', '正在加载你的工作台…', 'loading'));
    try {
      const identity = await api('me');
      const spaces = [];
      let cursor = null;
      do {
        const page = await api(`spaces?limit=50${cursor ? `&afterMembershipId=${cursor}` : ''}`);
        spaces.push(...page.spaces);
        cursor = page.nextCursor;
        if (spaces.length > 1000) throw new Error('Space discovery limit exceeded');
      } while (cursor);
      if (legacyLogin) {
        legacyLogin = false;
        const destination = loginDestination;
        loginDestination = null;
        const query = loginSpace ? '?space=' + loginSpace : '';
        if (destination) {
          location.replace(
            (destination === 'admin' ? '/zhiban/admin' : '/zhiban/admin/users') + query,
          );
          return;
        }
        history.replaceState(null, '', '/zhiban' + query);
      }

      let unchanged = preserveLearning && contextKey(identity, spaces) === renderedContext;
      if (
        unchanged &&
        (root.querySelector('.management-root') || root.querySelector('.course-workspace'))
      ) {
        // Preserve an open form only while its current server-side course access still holds.
        const tenant = new URL(location.href).searchParams.get('space');
        const course = root.querySelector('.course-workspace');
        const query = course
          ? `?q=${encodeURIComponent(course.dataset.offering)}&limit=50`
          : '?limit=10';
        const response = await (window.zhibanMemberPresentation?.read || fetch)(
          `/api/zhiban/workspace/${tenant}/courses${query}`,
          {
            headers: { 'x-zhiban-request': 'identity-v1' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) throw new ApiError(response.status);
        const access = await response.json();
        unchanged = course
          ? access.mode === 'MEMBER' &&
            access.rows.some(
              (row) =>
                row.id === course.dataset.offering &&
                row.course_id === course.dataset.course &&
                row.mode === course.dataset.mode,
            )
          : access.mode === 'ADMIN';
      }
      if (version === generation && !unchanged) workspace(identity, spaces);
    } catch (error) {
      if (version !== generation) return;
      if (error instanceof ApiError && error.status === 401) login();
      else {
        root.replaceChildren(
          node(
            'section',
            '暂时无法连接工作台，请稍后重试；如仍无法访问，请联系管理员。',
            'card empty',
          ),
          button('重试', refresh, 'button primary'),
        );
      }
    }
  }
  if (channel)
    channel.onmessage = () => {
      void refresh();
    };
  window.addEventListener('popstate', () => {
    void refresh();
  });
  root.addEventListener('input', (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('.academic-form, .learning-attempt')
    )
      event.target.dataset.unsaved = 'true';
  });
  const hasUnsavedInput = () => root.querySelector('[data-unsaved]') !== null;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !pending && !hasUnsavedInput()) void refresh(true);
  });
  // Recheck idle expiry and membership visibility without retaining authority in browser storage.
  setInterval(() => {
    if (!document.hidden && !pending && !hasUnsavedInput()) void refresh(true);
  }, 60000);
  void refresh();
})();
