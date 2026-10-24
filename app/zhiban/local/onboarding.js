(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('onboarding'),
    tenant = new URLSearchParams(location.search).get('tenant');
  const el = (tag, text, cls) => {
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
    label = (text, input) => {
      const l = el('label', text);
      l.append(input);
      return l;
    };
  if (!/^[0-9a-f-]{36}$/.test(tenant ?? '')) {
    root.textContent = '请从管理员工作台进入账户开通。';
    return;
  }
  const base = `/api/zhiban/onboarding/${tenant}/requests`,
    keys = new Map();
  let cursor = null,
    cursors = [null],
    page = 0,
    busy = false,
    blocked = false;
  root.append(
    el('h1', '普通账户开通'),
    el(
      'p',
      '提交申请后，由独立平台操作人核验并批准全局开户，再向本人交付一次性首密设置凭证。本页不创建密码、不代本人同意，也不自动赋予空间角色或课程权限。',
      'account-notice',
    ),
  );
  const alert = el('p');
  alert.setAttribute('role', 'alert');
  root.append(alert);
  const form = el('section', undefined, 'account-card'),
    name = el('input'),
    ref = el('input'),
    role = el('select');
  name.maxLength = 80;
  ref.maxLength = 120;
  name.setAttribute('aria-label', '新账户姓名');
  ref.setAttribute('aria-label', '受控名册引用');
  role.setAttribute('aria-label', '拟加入身份');
  role.append(
    new Option('学生（后续单独审批）', 'STUDENT'),
    new Option('教师（后续单独审批）', 'TEACHER'),
  );
  const create = button('提交开户申请', () =>
    act(async () => {
      await request({
        type: 'REQUEST_ACCOUNT',
        name: name.value,
        subjectReference: ref.value,
        requestedRole: role.value,
      });
      name.value = '';
      ref.value = '';
      await refresh();
    }),
  );
  form.append(
    el('h2', '新开户申请'),
    label('姓名', name),
    label('机构受控名册引用（不要填写身份证号或密码）', ref),
    label('拟加入身份', role),
    create,
  );
  root.append(form);
  const list = el('section'),
    pager = el('div'),
    prev = button('上一页', async () => {
      if (page) {
        cursor = cursors[--page];
        await act(refresh);
      }
    }),
    next = button('下一页', async () => {
      cursor = cursors[++page];
      await act(refresh);
    }),
    reload = button('刷新申请状态', () => act(refresh));
  pager.append(prev, next, reload);
  root.append(list, pager);
  async function request(payload = null) {
    const headers = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.timeout(12000);
    let intent, key;
    if (payload) {
      intent = JSON.stringify(payload);
      key = keys.get(intent) ?? crypto.randomUUID();
      keys.set(intent, key);
      const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store', signal });
      if (!r.ok) throw Object.assign(Error('登录已失效。'), { blocked: true });
      headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
      headers['content-type'] = 'application/json';
      headers['x-zhiban-command'] = key;
    }
    const r = await fetch(base + (cursor && !payload ? '?cursor=' + cursor : ''), {
        method: payload ? 'POST' : 'GET',
        headers,
        cache: 'no-store',
        signal,
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      }),
      data = await r.json();
    if (!r.ok) {
      if (r.status < 500 && intent) keys.delete(intent);
      throw Object.assign(
        Error(
          r.status === 409
            ? '申请已被撤回或平台已受理，请刷新后核对。'
            : r.status === 401 || r.status === 403
              ? '当前账户或管理员权限已失效。'
              : r.status === 400
                ? '请填写姓名、受控名册引用和拟加入身份。'
                : '请求结果不确定，请刷新核对或按原内容重试；不会重复批准开户。',
        ),
        { blocked: r.status === 401 || r.status === 403 },
      );
    }
    if (intent) keys.delete(intent);
    return data;
  }
  async function act(fn) {
    if (busy || blocked) return;
    busy = true;
    create.disabled = true;
    alert.textContent = '';
    try {
      await fn();
    } catch (e) {
      alert.textContent = e.message;
      if (e.blocked) {
        blocked = true;
        list.replaceChildren();
        form.hidden = true;
      }
    } finally {
      busy = false;
      create.disabled = blocked;
    }
  }
  async function refresh() {
    const data = await request();
    list.replaceChildren();
    const states = {
      REQUESTED: '等待平台独立核验',
      WITHDRAWN: '申请已撤回',
      APPROVED: '平台已批准，开户／交付准备中',
      READY: '首密凭证已交付，等待本人设置',
      CLAIMED: '本人已设置密码，可使用原登录入口',
      REVOKED: '未使用的首密凭证已撤销',
      EXPIRED: '首密凭证已过期，需平台重新授权交付',
    };
    for (const r of data.rows) {
      const item = el('article', undefined, 'account-card');
      item.append(
        el('h2', r.name),
        el('p', states[r.state] ?? r.state, 'account-status'),
        el(
          'p',
          `拟加入：${r.requested_role === 'TEACHER' ? '教师' : '学生'} · 名册引用：${r.subject_reference}`,
        ),
        el('p', `申请编号 ${r.id} · 版本 ${r.revision}`, 'account-meta'),
      );
      if (r.planned_user_id) item.append(el('p', '账户 ID：' + r.planned_user_id, 'account-meta'));
      if (r.expires_at)
        item.append(
          el(
            'p',
            '首密凭证期限：' + new Date(Number(r.expires_at)).toLocaleString('zh-CN'),
            'account-meta',
          ),
        );
      if (r.state === 'REQUESTED')
        item.append(
          button('撤回此申请', () =>
            act(async () => {
              await request({ type: 'WITHDRAW_REQUEST', id: r.id, revision: r.revision });
              await refresh();
            }),
          ),
        );
      if (r.state === 'CLAIMED') {
        const a = el('a', '继续已有账户的空间邀请与角色审批');
        a.href = `/zhiban/admin/members?tenant=${tenant}`;
        item.append(
          a,
          el(
            'p',
            '本人仍需有效入驻引用、明确同意及管理员激活；学生另需 Enrollment，教师另需相应作用域及任教关系。',
            'account-meta',
          ),
        );
      }
      list.append(item);
    }
    if (!data.rows.length) list.append(el('p', '当前没有开户申请。'));
    cursors[page + 1] = data.next;
    prev.disabled = page === 0;
    next.disabled = !data.next;
  }
  await act(refresh);
  root.setAttribute('aria-busy', 'false');
})();
