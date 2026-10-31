/* Signed control manifests select all targets/roles; this page never supplies authority. */
(async () => {
  const root = document.getElementById('platform-root');
  const el = (t, text) => {
    const n = document.createElement(t);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  async function call(path, value) {
    const h = { 'x-zhiban-request': 'identity-v1' };
    if (value) {
      h['Content-Type'] = 'application/json';
      h['x-zhiban-csrf'] = (await call('/api/zhiban/identity/csrf')).csrfToken;
    }
    const r = await fetch(path, {
      method: value ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: h,
      body: value ? JSON.stringify(value) : undefined,
    });
    if (!r.ok)
      throw Error(
        r.status === 401
          ? '请先登录本人账户。'
          : r.status === 403
            ? '当前账户没有平台管理权限，或批准已失效。'
            : '当前操作未完成，请核对批准配置后重试。',
      );
    return r.status === 204 ? null : r.json();
  }
  try {
    const state = await call('/api/zhiban/platform');
    root.replaceChildren(el('h1', '平台管理'), el('p', '已登录平台管理员：' + state.userId));
    const a = el('a', '进入教学工作台');
    a.href = '/zhiban';
    a.className = 'button secondary';
    root.append(a);
    const profile = el('a', '账户资料与密码');
    profile.href = '/zhiban/profile';
    profile.className = 'button secondary';
    root.append(profile);
    root.append(
      el('p', '教学空间、账户与管理员任命按受控批准执行；未创建空间时，教学工作台显示空状态。'),
    );
    if (!state.controlCommandsEnabled) {
      root.append(el('p', '受控管理批准尚未配置，请由部署负责人交付批准文件。'));
      return;
    }
    const form = el('form'),
      label = (text, type) => {
        const l = el('label', text),
          i = el('input');
        i.type = type;
        i.required = true;
        l.append(i);
        form.append(l);
        return i;
      };
    const ref = label('批准编号', 'text'),
      password = label('本人当前密码', 'password');
    ref.maxLength = 96;
    password.maxLength = 1024;
    password.autocomplete = 'current-password';
    const details = el('details'),
      summary = el('summary', '执行已登记的批准命令');
    details.append(summary);
    const command = el('textarea');
    command.setAttribute('aria-label', '批准命令 JSON');
    command.rows = 8;
    command.maxLength = 8192;
    details.append(command);
    form.append(details);
    const register = el('button', '登记批准'),
      execute = el('button', '执行批准命令'),
      notice = el('p');
    notice.setAttribute('role', 'status');
    register.type = execute.type = 'button';
    register.className = 'button secondary';
    execute.className = 'button primary';
    form.append(register, execute, notice);
    root.append(form);
    let busy = false;
    async function work(which) {
      if (busy) return;
      busy = true;
      register.disabled = execute.disabled = true;
      const secret = password.value;
      password.value = '';
      try {
        const result =
          which === 'register'
            ? await call('/api/zhiban/platform/approvals/register', {
                approvalRef: ref.value,
                password: secret,
              })
            : await call('/api/zhiban/platform/commands/execute', {
                command: JSON.parse(command.value),
                password: secret,
              });
        notice.textContent = '操作已完成。请回工作台刷新空间。';
        const out = el('pre', JSON.stringify(result, null, 2));
        notice.replaceChildren(el('span', '操作已完成。'), out);
      } catch (e) {
        notice.textContent = e.message;
      } finally {
        busy = false;
        register.disabled = execute.disabled = false;
      }
    }
    register.onclick = () => work('register');
    execute.onclick = () => work('execute');
    form.onsubmit = (e) => e.preventDefault();
  } catch (e) {
    root.replaceChildren(el('h1', '平台管理'), el('p', e.message));
    const a = el('a', '登录');
    a.href = '/zhiban';
    root.append(a);
  }
})();
