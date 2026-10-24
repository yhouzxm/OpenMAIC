/* Legacy navigation only. No cached role or URL parameter supplies admin authority. */
(async () => {
  const root = document.getElementById('admin-entry'),
    input = new URLSearchParams(location.search);
  const users = location.pathname === '/zhiban/admin/users';
  const validPath = ['/zhiban/admin', '/zhiban/admin/users'].includes(location.pathname);
  const uuid = (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v ?? '');
  let tenant = input.get('space') ?? input.get('tenant'),
    dead = false,
    busy = false;
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
  function show(message, login = false) {
    if (dead) return;
    const notice = el('p', message);
    notice.setAttribute('role', 'alert');
    root.replaceChildren(
      el('h1', users ? '成员账户目录入口' : '管理员工作台入口'),
      notice,
      link('返回工作台', '/zhiban' + (uuid(tenant) ? '?space=' + tenant : '')),
    );
    if (login) {
      const q = new URLSearchParams({ destination: users ? 'admin-users' : 'admin' });
      if (uuid(tenant)) q.set('space', tenant);
      root.append(link('登录后继续访问', '/zhiban/login?' + q));
    }
  }
  async function get(path) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok)
        throw Object.assign(
          Error(
            response.status === 401
              ? '请先登录本人账户。'
              : response.status === 403
                ? '当前空间不可访问，请从工作台核对成员状态。'
                : '入口暂不可用，请重试。',
          ),
          { status: response.status },
        );
      return await response.json();
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function recover(e) {
    if (!dead) {
      show(e.message, e.status === 401);
      const retry = el('button', '重新核对入口');
      retry.type = 'button';
      retry.onclick = () => void start();
      root.append(retry);
    }
  }
  async function enter(space) {
    if (dead || busy) return;
    busy = true;
    tenant = space.tenantId;
    root.querySelectorAll('button').forEach((n) => (n.disabled = true));
    try {
      const data = await get(`/api/zhiban/workspace/${tenant}/courses?limit=10`);
      if (dead) return;
      if (data.mode !== 'ADMIN') {
        show('当前空间不具备管理员权限，请返回本人工作台。');
        return;
      }
      location.replace(
        users ? `/zhiban/admin/accounts?tenant=${tenant}` : `/zhiban?space=${tenant}`,
      );
    } catch (e) {
      recover(e);
    } finally {
      busy = false;
    }
  }
  async function start() {
    if (dead || busy) return;
    const names = [...input.keys()];
    if (
      !validPath ||
      names.some((k) => !['space', 'tenant'].includes(k)) ||
      new Set(names).size !== names.length ||
      (input.has('space') && input.has('tenant')) ||
      (tenant !== null && !uuid(tenant))
    ) {
      show('管理员入口地址无效，请从工作台进入。');
      return;
    }
    busy = true;
    root.replaceChildren(el('p', '正在核对当前会话与空间…'));
    try {
      const spaces = [];
      let after = null;
      do {
        const data = await get(
          '/api/zhiban/identity/spaces?limit=50' + (after ? '&afterMembershipId=' + after : ''),
        );
        spaces.push(...data.spaces);
        after = data.nextCursor;
        if (spaces.length > 1000) throw Error('空间数量超过选择上限，请从工作台进入。');
      } while (after && !dead);
      if (dead) return;
      busy = false;
      if (tenant) {
        const space = spaces.find((s) => s.tenantId === tenant);
        if (space) await enter(space);
        else show('当前空间不可访问，请从工作台核对成员状态。');
      } else if (spaces.length === 1) await enter(spaces[0]);
      else {
        show(spaces.length ? '请选择管理员操作所在空间。' : '当前没有可访问空间，请返回工作台。');
        for (const space of spaces)
          if (uuid(space.tenantId)) {
            const b = el('button', space.displayName + ' · ' + space.tenantCode);
            b.type = 'button';
            b.onclick = () => void enter(space);
            root.append(b);
          }
      }
    } catch (e) {
      recover(e);
    } finally {
      busy = false;
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  const destroy = () => {
    dead = true;
    controllers.forEach((c) => c.abort());
    channel?.close();
    root.replaceChildren(
      el('p', '会话已变化，请返回工作台重新进入。'),
      link('返回工作台', '/zhiban'),
    );
  };
  if (channel) channel.onmessage = destroy;
  window.addEventListener('pagehide', destroy, { once: true });
  await start();
})();
