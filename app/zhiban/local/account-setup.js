(async () => {
  const root = document.getElementById('account-setup'),
    el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    },
    button = (text, fn) => {
      const b = el('button', text);
      b.type = 'button';
      b.onclick = fn;
      return b;
    },
    label = (text, n) => {
      const l = el('label', text);
      l.append(n);
      return l;
    };
  let context = null,
    busy = false;
  root.append(
    el('h1', '新账户首次设密'),
    el(
      'p',
      '仅使用平台独立交付给你的一次性凭证，由你自己设置密码。不要把凭证或密码发给管理员、聊天或他人；此入口不能重置已有密码。',
      'account-notice',
    ),
  );
  const alert = el('p');
  alert.setAttribute('role', 'alert');
  root.append(alert);
  const ticket = el('input');
  ticket.autocomplete = 'off';
  ticket.type = 'password';
  ticket.setAttribute('aria-label', '一次性首密凭证');
  const inspect = button('核验本人首密凭证', async () =>
    act(async () => {
      context = await request({ type: 'INSPECT', ticket: ticket.value.trim() });
      render();
    }),
  );
  root.append(label('平台交付的一次性凭证', ticket), inspect);
  const details = el('section', undefined, 'account-card');
  details.hidden = true;
  root.append(details);
  const password = el('input'),
    confirmation = el('input');
  for (const n of [password, confirmation]) {
    n.type = 'password';
    n.autocomplete = 'new-password';
    n.maxLength = 1024;
  }
  password.setAttribute('aria-label', '本人新密码');
  confirmation.setAttribute('aria-label', '再次输入新密码');
  const form = el('div');
  const set = button('确认设置本人密码', async () =>
    act(async () => {
      if (!context || context.state !== 'READY') throw Error('请重新核验凭证状态。');
      if (password.value !== confirmation.value) throw Error('两次密码不一致。');
      if ([...password.value].length < 15) throw Error('密码至少15个字符，请使用不常见的长密码。');
      const payload = {
        type: 'SET_PASSWORD',
        ticket: ticket.value.trim(),
        revision: context.revision,
        proof: context.proof,
        password: password.value,
        confirmPassword: confirmation.value,
      };
      password.value = '';
      confirmation.value = '';
      try {
        const r = await request(payload);
        context = { ...context, state: r.state };
        ticket.value = '';
        render();
        alert.textContent = '密码已设置，请使用下方账户 ID 和本人密码登录。';
      } catch (e) {
        context = null;
        form.hidden = true;
        throw Error(
          e.message + ' 密码已清空。请重新核验：若显示已设置，直接登录；若仍待设置，再明确提交。',
        );
      }
    }),
  );
  form.append(
    label('本人新密码（至少15个字符）', password),
    label('再次输入新密码', confirmation),
    set,
    el(
      'p',
      '密码只用于本次设置，不保存在浏览器存储。提交结果不确定时不会自动重发或代设其他密码。',
      'account-meta',
    ),
  );
  async function request(payload) {
    const r = await fetch('/api/zhiban/onboarding/claim', {
        method: 'POST',
        headers: { 'x-zhiban-request': 'identity-v1', 'content-type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 403
          ? '凭证已失效、过期或相关批准／账户状态已变化，请联系独立平台操作人。'
          : r.status === 409
            ? '凭证状态已变化，请重新核验，不能覆盖已有密码。'
            : r.status === 400
              ? '凭证格式或密码不符合要求，请核对。'
              : r.status === 429
                ? '请求过于频繁，请稍后再试。'
                : '设置结果暂不能确认。',
      );
    return data;
  }
  async function act(fn) {
    if (busy) return;
    busy = true;
    inspect.disabled = true;
    set.disabled = true;
    alert.textContent = '';
    try {
      await fn();
    } catch (e) {
      alert.textContent = e.message;
    } finally {
      password.value = '';
      confirmation.value = '';
      busy = false;
      inspect.disabled = false;
      set.disabled = false;
    }
  }
  function render() {
    details.hidden = false;
    details.replaceChildren(
      el('h2', context.name),
      el('p', '登录账户 ID', 'account-meta'),
      el('div', context.userId, 'account-id'),
      el('p', '凭证期限：' + new Date(context.expiresAt).toLocaleString('zh-CN'), 'account-meta'),
    );
    form.hidden = context.state !== 'READY';
    if (context.state === 'READY') details.append(form);
    else {
      details.append(el('p', '本人密码已设置。此凭证不能再次设密。'));
      const a = el('a', '返回原登录入口');
      a.href = '/zhiban';
      details.append(a);
    }
  }
  // Existing session is not silently replaced by anonymous setup.
  const h = { 'x-zhiban-request': 'identity-v1' };
  try {
    const current = await fetch('/api/zhiban/identity/me', {
      headers: h,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!current.ok && current.status !== 401) throw Error('无法确认当前登录状态。');
    if (current.ok) {
      inspect.disabled = true;
      ticket.disabled = true;
      const note = el('section', undefined, 'account-notice'),
        logout = button('退出当前账户后首次设密', async () => {
          try {
            const c = await fetch('/api/zhiban/identity/csrf', { headers: h, cache: 'no-store' });
            if (!c.ok) throw Error('无法确认当前登录状态。');
            const token = (await c.json()).csrfToken;
            const r = await fetch('/api/zhiban/identity/logout', {
              method: 'POST',
              headers: { ...h, 'content-type': 'application/json', 'x-zhiban-csrf': token },
              body: '{}',
            });
            if (!r.ok) throw Error('退出未完成，请重试。');
            note.remove();
            inspect.disabled = false;
            ticket.disabled = false;
          } catch (e) {
            alert.textContent = e.message;
          }
        });
      note.append(
        el('p', '此浏览器已登录账户。请先退出，再为新账户设置首密；退出不会更改现有密码。'),
        logout,
      );
      root.prepend(note);
    }
  } catch {
    inspect.disabled = true;
    ticket.disabled = true;
    alert.textContent = '暂不能确认登录状态，请刷新后再试。';
  }
})();
