(async () => {
  const root = document.getElementById('login-identifiers-root'),
    base = '/api/zhiban/login-identifiers/me';
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  let busy = false,
    uncertain = false,
    data = null;
  const notice = el('p');
  notice.setAttribute('role', 'status');
  const back = el('a', '返回原工作台', 'button secondary');
  const context = new URLSearchParams(location.search);
  const tenant = context.get('tenant');
  const validContext =
    [...context.keys()].length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenant ?? '');
  back.href = validContext ? `/zhiban/profile?tenant=${tenant}` : '/zhiban';
  if (validContext) back.textContent = '返回个人资料与账户';
  const password = el('input');
  password.type = 'password';
  password.autocomplete = 'current-password';
  password.setAttribute('aria-label', '确认登录标识的当前密码');
  const label = el('label', '当前密码（仅用于本人确认或停用标识）');
  label.append(password);
  const list = el('section');
  const refresh = el('button', '核对登录标识', 'button secondary');
  refresh.type = 'button';
  root.replaceChildren(
    el('h1', '本人登录标识'),
    back,
    el(
      'p',
      '平台提名后，由你核对绑定到本人的 @标识并用当前密码确认。确认新标识会停用原标识；UserId 始终保留，密码、空间角色及课程权限不会因此改变。学号、工号和联系邮箱不自动用于登录。',
    ),
    notice,
    refresh,
    label,
    list,
  );
  async function request(value) {
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (value) {
      const c = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
      if (!c.ok) throw Error('登录失效或安全令牌不可用。');
      headers['content-type'] = 'application/json';
      headers['x-zhiban-csrf'] = (await c.json()).csrfToken;
    }
    const r = await fetch(base, {
      method: value ? 'POST' : 'GET',
      headers,
      cache: 'no-store',
      ...(value ? { body: JSON.stringify(value) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok)
      throw Object.assign(
        Error(
          r.status === 401
            ? '请先从原入口登录本人账户。'
            : r.status === 403
              ? '当前密码、本人资格或提名来源未通过核验。'
              : r.status === 409
                ? '标识状态或版本已改变，请先核对当前结果。'
                : r.status === 503
                  ? '登录标识暂不可用或结果不确定。'
                  : '操作未完成。',
        ),
        { uncertain: r.status >= 500 },
      );
    return r.json();
  }
  function draw() {
    list.replaceChildren();
    if (!data) return;
    list.append(el('p', '本人 UserId：' + data.userId));
    if (!data.names.length)
      list.append(el('p', '尚无平台提名或已绑定标识；可以继续使用 UserId 登录。'));
    const states = {
      PENDING: '等待本人确认',
      ACTIVE: '当前可用于登录',
      RETIRED: '已停用，名称仍保留给原本人',
      EXPIRED: '提名已过期，需平台重新提名',
      STALE: '账户版本已变化，需平台重新提名',
    };
    for (const r of data.names) {
      const card = el('article', undefined, 'learning-activity');
      card.append(
        el('h2', r.alias),
        el('p', (states[r.state] ?? r.state) + ' · 版本 ' + r.revision),
      );
      if (r.state === 'PENDING')
        card.append(el('p', '提名期限：' + new Date(Number(r.expires_at)).toLocaleString('zh-CN')));
      for (const [action, title] of [
        ['ACCEPT', '确认绑定此登录标识'],
        ['RETIRE', r.state === 'ACTIVE' ? '停用此登录标识' : '拒绝此提名'],
      ]) {
        if (r.state === 'RETIRED' || (action === 'ACCEPT' && r.state !== 'PENDING')) continue;
        const b = el('button', title, 'button secondary');
        b.type = 'button';
        b.disabled = busy || uncertain;
        b.onclick = () => act(r, action);
        card.append(b);
      }
      list.append(card);
    }
  }
  function lock() {
    password.disabled = busy || uncertain;
    refresh.disabled = busy;
    draw();
  }
  async function load() {
    if (busy) return;
    busy = true;
    lock();
    try {
      data = await request();
      uncertain = false;
      notice.textContent = '已核对本人当前状态。';
    } catch (e) {
      data = null;
      notice.textContent = e.message;
    } finally {
      busy = false;
      lock();
    }
  }
  async function act(r, action) {
    if (busy || uncertain) return;
    if (!password.value) {
      notice.textContent = '请输入本人当前密码。';
      return;
    }
    if (
      !confirm(
        `${action === 'ACCEPT' ? '确认绑定' : '停用／拒绝'} ${r.alias}？UserId 登录保持可用。`,
      )
    )
      return;
    busy = true;
    lock();
    try {
      await request({ action, alias: r.alias, revision: r.revision, password: password.value });
      password.value = '';
      data = await request();
      notice.textContent = '操作已确认。';
    } catch (e) {
      password.value = '';
      uncertain = true;
      notice.textContent = e.message + ' 密码已清空，请先核对当前结果；不会自动重试。';
    } finally {
      busy = false;
      lock();
    }
  }
  refresh.onclick = load;
  await load();
})();
