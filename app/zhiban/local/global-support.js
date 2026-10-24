/* Navigation only; original Workspace and governed evidence/support APIs remain authoritative. */
(async () => {
  const root = document.getElementById('global-support');
  const route = /^\/zhiban\/(teacher|student)\/(profiles|profile|risks)$/.exec(location.pathname);
  const role = route?.[1];
  const kind = route?.[2] === 'risks' ? 'support' : 'profile';
  const validRoute =
    role === 'teacher'
      ? ['profiles', 'risks'].includes(route?.[2])
      : ['profile', 'risks'].includes(route?.[2]);
  const globalPath = `/zhiban/${role}/${kind === 'support' ? 'risks' : role === 'teacher' ? 'profiles' : 'profile'}`;
  const title = kind === 'profile' ? '学习证据画像入口' : '风险与学习支持入口';
  const input = new URLSearchParams(location.search);
  const uuid = (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v ?? '');
  let tenant = input.get('space') ?? input.get('tenant'),
    course = input.get('courseId');
  let dead = false,
    busy = false,
    key,
    q = '',
    state = 'ALL',
    limit = '20',
    cursors = [null],
    index = 0;
  const controllers = new Set();
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const link = (text, href) => {
    const n = el('a', text);
    n.href = href;
    n.className = 'button secondary';
    return n;
  };
  const button = (text, fn, disabled = false) => {
    const n = el('button', text);
    n.type = 'button';
    n.disabled = disabled;
    n.onclick = () => void fn();
    return n;
  };
  const back = () =>
    link('返回当前空间工作台', '/zhiban' + (uuid(tenant) ? '?space=' + tenant : ''));
  function error(text) {
    if (!dead) root.replaceChildren(el('h1', title), el('p', text), back());
  }
  async function get(path) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(path, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!r.ok)
        throw Error(
          r.status === 401
            ? '请先返回工作台登录。'
            : r.status === 403
              ? '当前空间或课程关系已变化，请返回工作台核对。'
              : '画像与支持入口暂不可用，请重试。',
        );
      return await r.json();
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function remember() {
    try {
      sessionStorage.setItem(key, JSON.stringify({ q, state, limit, cursors, index }));
    } catch {
      /* Storage is optional and never an authorization source. */
    }
  }
  async function load() {
    if (dead || busy) return;
    busy = true;
    root.querySelectorAll('button,input,select').forEach((n) => (n.disabled = true));
    try {
      const params = new URLSearchParams({ q, state, limit });
      if (cursors[index]) params.set('cursor', cursors[index]);
      const data = await get(`/api/zhiban/workspace/${tenant}/courses?${params}`);
      if (dead) return;
      if (data.mode !== 'MEMBER' || !data.roles.includes(role.toUpperCase())) {
        error('当前身份不具备此画像与支持入口的角色，请返回工作台。');
        return;
      }
      const rows = data.rows.filter(
        (row) => row.mode === role.toUpperCase() && (!course || row.course_id === course),
      );
      root.replaceChildren(
        el('h1', title),
        back(),
        el(
          'p',
          role === 'teacher'
            ? '选择任教教学班进入证据画像、私有规则审阅及人工支持。'
            : '选择在读教学班进入本人已公开的学习观察、纠错、提醒及补救任务。',
        ),
      );
      root.append(
        el(
          'p',
          '维度继续 REVIEW；只呈现可追溯证据与人工发布的支持，不计算能力分、排名或自动诊断。',
        ),
      );
      if (course)
        root.append(
          el('p', '当前按旧链接指定课程筛选教学班。'),
          link('显示全部课程', `${globalPath}?space=${tenant}`),
        );
      const form = el('form');
      form.className = 'course-filters';
      const label = el('label', '搜索课程或教学班'),
        search = el('input');
      search.value = q;
      search.maxLength = 120;
      label.append(search);
      form.append(label);
      const select = (title, values, current) => {
        const l = el('label', title),
          s = el('select');
        for (const [value, text] of values) {
          const o = el('option', text);
          o.value = value;
          s.append(o);
        }
        s.setAttribute('aria-label', title);
        s.value = current;
        l.append(s);
        form.append(l);
        return s;
      };
      const statuses = select(
          '教学班状态',
          [
            ['ALL', '全部'],
            ['OPEN', '开放'],
            ['CLOSED', '关闭'],
          ],
          state,
        ),
        size = select(
          '画像与支持入口每页条数',
          [
            ['10', '10'],
            ['20', '20'],
            ['50', '50'],
          ],
          limit,
        );
      const submit = el('button', '查询画像与支持课程');
      submit.type = 'submit';
      form.append(submit);
      form.onsubmit = (e) => {
        e.preventDefault();
        if (busy) return;
        q = search.value.trim();
        state = statuses.value;
        limit = size.value;
        cursors = [null];
        index = 0;
        void load();
      };
      root.append(form, button('刷新画像与支持课程', load));
      const list = el('section');
      list.setAttribute('aria-label', '可访问的画像与支持课程');
      root.append(list);
      for (const row of rows) {
        const card = el('article');
        card.className = 'learning-activity';
        card.append(
          el('h2', row.course_name),
          el('p', `${row.name} · ${row.term_name} · ${row.status === 'OPEN' ? '开放' : '关闭'}`),
          link(
            kind === 'profile' ? '进入课程学习画像' : '进入课程学习支持',
            `/zhiban/${role}/courses/${row.course_id}/${kind === 'profile' ? (role === 'teacher' ? 'profiles' : 'analysis') : role === 'teacher' ? 'risks' : 'support'}?space=${tenant}&offering=${row.id}${course ? '&hubCourse=' + course : ''}`,
          ),
        );
        list.append(card);
      }
      if (!rows.length)
        list.append(
          el(
            'p',
            data.nextCursor
              ? '当前页没有匹配的画像与支持课程，可继续下一页。'
              : '暂无匹配的可访问画像与支持课程。',
          ),
        );
      root.append(
        button(
          '上一页画像与支持课程',
          () => {
            index--;
            void load();
          },
          index === 0,
        ),
        el('span', `第 ${index + 1} 页 · 本页 ${rows.length} 个教学班`),
        button(
          '下一页画像与支持课程',
          () => {
            cursors[index + 1] = data.nextCursor;
            index++;
            void load();
          },
          !data.nextCursor || index >= 99,
        ),
      );
      remember();
    } catch (e) {
      if (!dead) {
        error(e.message);
        root.append(
          button('重试画像与支持课程', () => {
            cursors = [null];
            index = 0;
            return load();
          }),
        );
      }
    } finally {
      busy = false;
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  function destroy() {
    dead = true;
    controllers.forEach((c) => c.abort());
    channel?.close();
    root.replaceChildren(el('p', '会话已变化，请返回工作台重新进入。'), back());
  }
  if (channel) channel.onmessage = destroy;
  window.addEventListener('pagehide', destroy, { once: true });
  if (
    !validRoute ||
    [...input.keys()].some((k) => !['tenant', 'space', 'courseId'].includes(k)) ||
    new Set(input.keys()).size !== [...input.keys()].length ||
    (input.has('tenant') && input.has('space')) ||
    (tenant !== null && !uuid(tenant)) ||
    (course !== null && !uuid(course))
  ) {
    error('画像与支持入口地址无效，请从工作台进入。');
    return;
  }
  async function enter(space) {
    if (dead) return;
    tenant = space.tenantId;
    key = `zhiban-support:${space.membershipId}:${role}:${kind}:${course ?? 'all'}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (
        saved &&
        typeof saved.q === 'string' &&
        saved.q.length <= 120 &&
        ['ALL', 'OPEN', 'CLOSED'].includes(saved.state) &&
        ['10', '20', '50'].includes(saved.limit) &&
        Array.isArray(saved.cursors) &&
        saved.cursors.length <= 100 &&
        saved.cursors[0] === null &&
        saved.cursors.every(
          (x) => x === null || (typeof x === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(x)),
        ) &&
        Number.isInteger(saved.index) &&
        saved.index >= 0 &&
        saved.index < saved.cursors.length
      ) {
        ({ q, state, limit, cursors, index } = saved);
      }
    } catch {
      /* Ignore invalid local navigation state. */
    }
    const params = new URLSearchParams({ space: tenant });
    if (course) params.set('courseId', course);
    history.replaceState(null, '', `${globalPath}?${params}`);
    await load();
  }
  try {
    const spaces = [];
    let after = null;
    do {
      const data = await get(
        '/api/zhiban/identity/spaces?limit=50' + (after ? '&afterMembershipId=' + after : ''),
      );
      spaces.push(...data.spaces);
      after = data.nextCursor;
      if (spaces.length > 1000) throw Error('空间数量超过当前上限，请从工作台进入。');
    } while (after && !dead);
    if (dead) return;
    if (tenant) {
      const space = spaces.find((s) => s.tenantId === tenant);
      if (!space) {
        error('当前空间不可访问，请返回工作台。');
        return;
      }
      await enter(space);
    } else if (spaces.length === 1) await enter(spaces[0]);
    else {
      error(spaces.length ? '请选择查看学习证据与支持的空间。' : '当前没有可访问空间。');
      for (const space of spaces)
        if (uuid(space.tenantId))
          root.append(button(space.displayName + ' · ' + space.tenantCode, () => enter(space)));
    }
  } catch (e) {
    error(e.message);
  }
})();
