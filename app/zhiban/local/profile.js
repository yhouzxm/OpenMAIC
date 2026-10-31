/* Business profile and directory UI; credentials stay in the frozen Identity endpoint. */
(() => {
  const params = new URLSearchParams(location.search);
  let tenant = params.get('tenant');
  const members = location.pathname === '/zhiban/admin/accounts';
  if (members) document.body.dataset.adminPage = 'accounts';
  const root = document.getElementById('profile-root');
  let base = `/api/zhiban/profile/${tenant}`;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  let dead = false,
    busy = false,
    pending = null,
    current,
    page,
    cursor = [null],
    index = 0,
    q = '',
    state = 'ACTIVE',
    role = 'ALL',
    limit = '20';
  let ownDraft = null,
    unitName = '',
    baseline = '',
    edits = new Map();
  const notice = el('p');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const controllers = new Set();
  const dirty = () =>
    (ownDraft && JSON.stringify(ownDraft) !== baseline) ||
    [...edits.values()].some((e) => JSON.stringify(e.draft) !== e.baseline);
  const leave = () => {
    if (busy || pending) {
      notice.textContent = '请先确认当前操作结果。';
      return false;
    }
    return !dirty() || confirm('有未保存的资料修改，确认放弃并离开？');
  };
  async function request(url, command, key) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { 'x-zhiban-request': 'identity-v1' };
      if (command) {
        const csrf = await (window.zhibanMemberPresentation?.read || fetch)(
          '/api/zhiban/identity/csrf',
          {
            credentials: 'same-origin',
            headers,
            signal: controller.signal,
          },
        );
        if (!csrf.ok)
          throw Object.assign(Error('登录或安全令牌不可用。'), {
            definitive: csrf.status >= 400 && csrf.status < 500,
          });
        headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
        headers['Content-Type'] = 'application/json';
        if (key) headers['x-zhiban-command'] = key;
      }
      const response = await (window.zhibanMemberPresentation?.read || fetch)(url, {
        method: command ? 'POST' : 'GET',
        headers,
        body: command ? JSON.stringify(command) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok)
        throw Object.assign(
          Error(
            {
              UNAUTHENTICATED: '登录已失效，请返回工作台重新登录。',
              FORBIDDEN: '当前无权访问本空间资料或成员目录。',
              NOT_FOUND: '目标成员不属于当前空间。',
              CONFLICT: '资料已改变或业务编号重复；请核对后重试。',
              INVALID_INPUT: '请检查资料；头像须为不超过96×96、12 KiB的完整PNG。',
              INVALID_REQUEST: '请求或密码不符合要求。',
              SERVICE_UNAVAILABLE: '资料服务暂不可用或尚未启用。',
            }[data?.error?.code] ?? '操作暂未完成。',
          ),
          { definitive: response.status >= 400 && response.status < 500, status: response.status },
        );
      return data;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  const ownValues = (v) =>
    Object.fromEntries(['displayName', 'email', 'qq', 'wechat', 'bio'].map((k) => [k, v[k]]));
  function avatarView(value, name) {
    const frame = el('span', undefined, 'profile-avatar');
    if (value?.png) {
      const image = el('img');
      image.src = 'data:image/png;base64,' + value.png;
      image.alt = name + '的头像';
      image.width = image.height = 72;
      frame.append(image);
    } else frame.append(el('span', '暂无头像'));
    return frame;
  }
  async function load() {
    if (members)
      page = await request(
        base +
          '/members?' +
          new URLSearchParams({
            q,
            state,
            role,
            limit,
            ...(cursor[index] ? { cursor: cursor[index] } : {}),
          }),
      );
    else {
      current = await request(base + '/me');
      unitName = (await window.zhibanMemberPresentation?.spaceName(tenant).catch(() => '')) || '';
      if (!ownDraft) {
        ownDraft = ownValues(current);
        baseline = JSON.stringify(ownDraft);
      }
    }
  }
  async function refresh() {
    if (busy || pending || dead) return;
    busy = true;
    lock();
    try {
      await load();
      if (!dead) {
        draw();
        notice.textContent = '';
      }
    } catch (e) {
      if (!dead) {
        if ([401, 403].includes(e.status)) {
          current = null;
          page = null;
          ownDraft = null;
          edits.clear();
          draw();
        }
        notice.textContent = e.message;
        if (![401, 403].includes(e.status)) notice.append(button('重试', refresh));
      }
    } finally {
      busy = false;
      lock();
    }
  }
  async function save(command, retry = false) {
    if (busy || dead || (pending && !retry)) return;
    pending ??= { command, key: crypto.randomUUID() };
    const work = pending;
    busy = true;
    lock();
    notice.textContent = '正在确认保存…';
    try {
      await request(base + (members ? '/members' : '/me'), work.command, work.key);
      pending = null;
      if (members) edits.delete(work.command.membershipId);
      else if (work.command.type !== 'SAVE_AVATAR') ownDraft = null;
      await load();
      if (!dead) {
        draw();
        notice.textContent = '已保存。';
      }
    } catch (e) {
      if (dead) return;
      if (e.definitive) pending = null;
      draw();
      notice.textContent =
        e.message + (pending ? ' 结果未知，请按原命令重试；输入已保留。' : ' 输入已保留。');
      if (!pending && ![401, 403].includes(e.status)) notice.append(button('重新加载', refresh));
    } finally {
      busy = false;
      lock();
    }
  }
  const button = (text, fn, blocked = false) => {
    const b = el('button', text, 'button secondary');
    b.type = 'button';
    b.dataset.blocked = String(blocked);
    b.onclick = () => void fn();
    return b;
  };
  const field = (form, title, value, update, max = 120, multiline = false) => {
    const l = el('label', title),
      input = el(multiline ? 'textarea' : 'input');
    input.setAttribute('aria-label', title);
    input.value = value ?? '';
    input.maxLength = max;
    if (multiline) input.rows = 4;
    input.oninput = () => update(input.value);
    l.append(input);
    form.append(l);
    return input;
  };
  function lock() {
    root.querySelectorAll('button,input,textarea,select').forEach((n) => {
      n.disabled = busy || !!pending || n.dataset.blocked === 'true';
      if (n.dataset.retry) n.disabled = busy || !pending;
    });
  }
  function security(parent) {
    const panel = el('details', undefined, 'academic-form');
    panel.append(el('summary', '账户安全'));
    panel.append(el('p', '修改密码或退出全部会话需验证当前密码，完成后请重新登录。'));
    const identifiers = el('a', '登录标识设置', 'button secondary');
    identifiers.href = `/zhiban/login-identifiers?tenant=${tenant}`;
    panel.append(identifiers);
    const form = el('form'),
      password = field(form, '当前密码', '', () => {}, 1024),
      fresh = field(form, '新密码（至少15个字符）', '', () => {}, 1024),
      confirmation = field(form, '再次输入新密码', '', () => {}, 1024);
    password.type = fresh.type = confirmation.type = 'password';
    password.autocomplete = 'current-password';
    fresh.autocomplete = confirmation.autocomplete = 'new-password';
    password.required = fresh.required = confirmation.required = true;
    const submit = el('button', '修改本人密码并退出', 'button primary');
    submit.type = 'submit';
    form.append(submit);
    const done = () => {
      password.value = fresh.value = confirmation.value = '';
      channel?.postMessage('session-changed');
      location.assign('/zhiban');
    };
    const action = async (change) => {
      if (busy || pending) return;
      if (dirty()) {
        notice.textContent = '请先保存或放弃资料修改，再操作账户安全。';
        return;
      }
      if (
        !password.value ||
        (change && (fresh.value !== confirmation.value || [...fresh.value].length < 15))
      ) {
        notice.textContent = '请填写当前密码；新密码须至少15个字符且两次输入一致。';
        return;
      }
      busy = true;
      lock();
      try {
        if (change) {
          const v = await request('/api/zhiban/identity/password');
          await request('/api/zhiban/identity/password', {
            password: password.value,
            newPassword: fresh.value,
            expectedCredentialRevision: v.credentialRevision,
          });
        } else await request('/api/zhiban/identity/logout-all', { password: password.value });
        done();
      } catch (e) {
        password.value = fresh.value = confirmation.value = '';
        notice.textContent =
          e.message + ' 密码已从表单清空；结果不明时请重新登录核实，不自动重放。';
      } finally {
        busy = false;
        lock();
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (form.reportValidity()) void action(true);
    };
    panel.append(
      form,
      button('验证当前密码并退出全部会话', () => action(false)),
    );
    parent.append(panel);
  }
  function draw() {
    if (dead) return;
    root.replaceChildren(el('h1', members ? '成员账户目录' : '个人设置'), notice);
    const toolbar = el('div', undefined, 'profile-toolbar');
    if (pending) {
      const retry = button('按原命令重试', () => save(pending.command, true));
      retry.dataset.retry = 'true';
      toolbar.append(retry);
    } else if (members) toolbar.append(button('刷新目录', refresh));
    if (members) root.append(toolbar);
    if (!members && current) {
      const overview = el('div', undefined, 'profile-overview');
      const identity = el('section', undefined, 'profile-identity');
      identity.append(el('h2', '基本信息'));
      const identityFields = el('div', undefined, 'profile-basic-rows');
      const roleNames = {
        ADMIN: '机构管理员',
        TENANT_ADMIN: '机构管理员',
        TEACHER: '教师',
        STUDENT: '学生',
      };
      const basicRow = (title, value) => {
        const row = el('div', undefined, 'profile-basic-row');
        row.append(el('span', title, 'profile-row-label'), el('span', value, 'profile-row-value'));
        return row;
      };
      const nameRow = basicRow('姓名', current.formalName || current.displayName || '未登记');
      identityFields.append(nameRow);
      identity.append(identityFields);
      const avatar = el('section', undefined, 'profile-avatar-panel');
      avatar.append(
        avatarView(current.avatar, current.displayName),
        el('p', '支持 PNG，最大 96×96 像素、12 KiB。'),
      );
      const avatarLabel = el('label', '选择PNG头像'),
        avatarInput = el('input');
      avatarInput.type = 'file';
      avatarInput.accept = 'image/png';
      avatarLabel.append(avatarInput);
      avatarLabel.hidden = true;
      avatar.append(avatarLabel);
      const uploadAvatar = async () => {
        const file = avatarInput.files?.[0];
        if (!file || file.size > 12288 || file.type !== 'image/png') {
          notice.textContent = '请选择12 KiB以内的PNG；像素最大96×96。';
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (dead || busy || pending) return;
        await save({
          type: 'SAVE_AVATAR',
          revision: current.avatar?.revision ?? null,
          png: btoa(String.fromCharCode(...bytes)),
        });
      };
      avatarInput.addEventListener('change', () => void uploadAvatar());
      const uploadButton = button('上传头像', () => avatarInput.click());
      uploadButton.classList.add('primary');
      uploadButton.title = '支持 PNG，最大 96×96 像素、12 KiB。';
      avatar.append(uploadButton);
      if (current.avatar?.png)
        avatar.append(
          button('移除本人头像', () =>
            save({ type: 'SAVE_AVATAR', revision: current.avatar.revision, png: null }),
          ),
        );
      const avatarRow = el('div', undefined, 'profile-basic-row profile-avatar-row');
      avatarRow.append(el('span', '当前头像', 'profile-row-label'), avatar);
      identityFields.append(avatarRow);
      for (const [title, value] of [
        [
          '平台角色',
          current.roles.map((r) => roleNames[r.roleCode] || r.roleCode).join(' / ') || '空间成员',
        ],
        [
          '人员编号',
          [current.studentNo, current.employeeNo].filter(Boolean).join(' / ') || '未登记',
        ],
        ['所属单位', unitName || '未登记'],
      ])
        identityFields.append(basicRow(title, value));
      overview.append(identity);
      root.append(overview);
      const form = el('form', undefined, 'academic-form profile-editor');
      form.append(el('h2', '账号绑定'));
      const fields = el('div', undefined, 'profile-fields');
      form.append(fields);
      for (const [key, title, max] of [
        ['displayName', '显示名', 120],
        ['email', '联系邮箱', 254],
        ['qq', 'QQ', 32],
        ['wechat', '微信', 100],
        ['bio', '个人简介', 2000],
      ])
        field(
          fields,
          title,
          ownDraft[key],
          (v) => {
            ownDraft[key] = v;
          },
          max,
          key === 'bio',
        ).required = key === 'displayName';
      const submit = el('button', '保存个人资料', 'button primary');
      submit.type = 'submit';
      form.append(submit);
      form.onsubmit = (e) => {
        e.preventDefault();
        if (form.reportValidity())
          void save({ type: 'SAVE_PROFILE', revision: current.revision, ...ownDraft });
      };
      root.append(form);
      security(root);
      if (toolbar.childNodes.length) root.append(toolbar);
      root.append(notice);
    }
    if (members && page) {
      root.append(
        el(
          'p',
          '维护本空间正式档案；空间成员和任教授权另行审批。普通开户从“普通账户开通”申请。全局停用影响该账户的所有空间，只能由独立平台处理；这里不能启停全局账户或重置他人密码。',
        ),
      );
      root.append(
        el(
          'p',
          page.globalStatusAsOf
            ? `状态更新于 ${new Date(page.globalStatusAsOf).toLocaleString('zh-CN')}，平台操作后可刷新目录查看。`
            : '全局状态尚未查证。',
        ),
      );
      const filters = el('form', undefined, 'course-filters');
      let search = q;
      field(filters, '搜索成员', q, (v) => {
        search = v;
      });
      const select = (label, value, values) => {
        const l = el('label', label),
          n = el('select');
        n.setAttribute('aria-label', label);
        for (const [v, text] of values) {
          const o = el('option', text);
          o.value = v;
          n.append(o);
        }
        n.value = value;
        l.append(n);
        filters.append(l);
        return n;
      };
      const status = select('成员状态', state, [
        ['ACTIVE', '有效成员'],
        ['ALL', '全部状态'],
        ['PENDING', '待激活'],
        ['DISABLED', '已停用'],
        ['LEFT', '已离开'],
      ]);
      const kind = select('成员角色', role, [
        ['ALL', '全部角色'],
        ['STUDENT', '学生'],
        ['TEACHER', '教师'],
        ['TENANT_ADMIN', '管理员'],
        ['MEMBER', '无当前角色'],
      ]);
      const size = select('成员每页条数', limit, [
        ['10', '10'],
        ['20', '20'],
        ['50', '50'],
      ]);
      const query = el('button', '查询成员', 'button primary');
      query.type = 'submit';
      filters.append(query);
      filters.onsubmit = async (e) => {
        e.preventDefault();
        if (!leave()) return;
        edits.clear();
        q = search;
        state = status.value;
        role = kind.value;
        limit = size.value;
        cursor = [null];
        index = 0;
        await refresh();
      };
      root.append(filters);
      const list = el('section');
      list.setAttribute('aria-label', '成员账户列表');
      root.append(list);
      for (const row of page.rows) {
        const card = el('article', undefined, 'learning-activity');
        card.dataset.memberId = row.membershipId;
        card.append(avatarView(row.avatar, row.displayName || row.formalName || '成员'));
        card.append(
          el('h2', row.formalName || row.displayName || '未填写姓名'),
          el(
            'p',
            `显示名：${row.displayName || '未填写'} · ${row.status} · ${row.roles.join(' / ') || '无当前角色'}`,
          ),
          el('p', `成员ID：${row.membershipId}`),
          el('p', `UserId 登录账号：${row.userId}`),
          el(
            'p',
            `登录标识：${page.loginIdentifiersAvailable ? row.loginAlias || '未绑定（仍可用 UserId 登录）' : '未查证'}`,
          ),
          el('p', `学号：${row.studentNo || '未登记'} · 工号：${row.employeeNo || '未登记'}`),
          el(
            'p',
            row.globalStatus === 'DISABLED'
              ? '全局账户：已停用，所有空间均无法登录或继续访问。本空间成员与历史记录仍保留；恢复请联系独立平台操作人。'
              : row.globalStatus === 'ACTIVE'
                ? '全局账户：有效；实际访问仍需当前空间成员、角色及课程权限。'
                : '全局账户：状态未查证，不能据此判断可以登录或访问。',
          ),
        );
        const manage = el('a', '管理空间成员', 'button secondary');
        manage.href = `/zhiban/admin/members?tenant=${tenant}&member=${row.membershipId}`;
        card.append(manage);
        const details = el('details', undefined, 'academic-form');
        details.append(el('summary', '维护正式档案'));
        const form = el('form');
        if (!edits.has(row.membershipId)) {
          const draft = {
            formalName: row.formalName,
            studentNo: row.studentNo,
            employeeNo: row.employeeNo,
          };
          edits.set(row.membershipId, { draft, baseline: JSON.stringify(draft) });
        }
        const edit = edits.get(row.membershipId);
        for (const [key, label, max] of [
          ['formalName', '正式姓名', 120],
          ['studentNo', '学号（不作登录）', 64],
          ['employeeNo', '工号（不作登录）', 64],
        ])
          field(
            form,
            label,
            edit.draft[key],
            (v) => {
              edit.draft[key] = v;
            },
            max,
          ).required = key === 'formalName';
        const saveButton = el('button', '保存正式档案', 'button primary');
        saveButton.type = 'submit';
        form.append(saveButton);
        form.onsubmit = (e) => {
          e.preventDefault();
          if (form.reportValidity()) void saveRecord();
        };
        const saveRecord = () =>
          save({
            type: 'SAVE_DIRECTORY',
            membershipId: row.membershipId,
            revision: row.revision,
            ...edit.draft,
          });
        details.append(form);
        card.append(details);
        list.append(card);
      }
      if (!page.rows.length)
        list.append(
          el('p', page.nextCursor ? '当前页没有匹配成员，请继续查看下一页。' : '没有匹配的成员。'),
        );
      const nav = el('nav', undefined, 'course-pagination');
      nav.setAttribute('aria-label', '成员账户分页');
      const move = async (n) => {
        if (!leave()) return;
        edits.clear();
        index = n;
        await refresh();
      };
      nav.append(
        button('上一页成员', () => move(index - 1), index === 0),
        el('span', `第 ${index + 1} 页 · 本页 ${page.rows.length} 人`),
        button(
          '下一页成员',
          () => {
            cursor[index + 1] = page.nextCursor;
            return move(index + 1);
          },
          !page.nextCursor,
        ),
      );
      root.append(nav);
    }
    lock();
  }
  const click = (e) => {
    const control = e.target.closest?.('a[href],button');
    if (!control || (root.contains(control) && control.tagName !== 'A') || (!dirty() && !pending))
      return;
    if (!leave()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else {
      ownDraft = null;
      edits.clear();
    }
  };
  const unload = (e) => {
    if (dirty() || pending) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  function destroy() {
    if (dead) return;
    dead = true;
    controllers.forEach((c) => c.abort());
    channel?.close();
    document.removeEventListener('click', click, true);
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('pagehide', destroy);
    root.replaceChildren(el('p', '会话已变化，请返回工作台重新登录。'));
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel) channel.onmessage = destroy;
  document.addEventListener('click', click, true);
  window.addEventListener('beforeunload', unload);
  window.addEventListener('pagehide', destroy, { once: true });
  async function start() {
    const legacy = ['/zhiban/student/settings', '/zhiban/teacher/profile'].includes(
      location.pathname,
    );
    const names = [...params.keys()];
    const validId = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v ?? '');
    const entryError = (message) => {
      const back = el('a', '返回工作台登录或选择空间', 'button secondary');
      back.href = '/zhiban' + (validId(tenant) ? '?space=' + tenant : '');
      root.replaceChildren(el('h1', '个人资料与账户'), el('p', message), back);
    };
    if (
      names.some((k) => !(legacy ? ['tenant', 'space'] : ['tenant']).includes(k)) ||
      new Set(names).size !== names.length ||
      (params.has('tenant') && params.has('space'))
    ) {
      entryError('空间地址无效，请从工作台进入。');
      return;
    }
    tenant = params.get('tenant') ?? (legacy ? params.get('space') : null);
    if (members && tenant === null) {
      entryError('空间地址无效，请从工作台进入。');
      return;
    }
    if (tenant !== null && !validId(tenant)) {
      entryError('空间地址无效，请从工作台进入。');
      return;
    }
    const enter = (id) => {
      if (dead) return;
      tenant = id;
      base = `/api/zhiban/profile/${tenant}`;
      if (legacy || !params.has('tenant'))
        history.replaceState(null, '', `/zhiban/profile?tenant=${tenant}`);
      draw();
      void refresh();
    };
    if (tenant !== null) {
      enter(tenant);
      return;
    }
    try {
      let after = null;
      const spaces = [];
      do {
        const page = await request(
          '/api/zhiban/identity/spaces?limit=50' + (after ? '&afterMembershipId=' + after : ''),
        );
        spaces.push(...page.spaces);
        after = page.nextCursor;
        if (spaces.length > 1000) throw Error('空间数量超过当前选择上限，请从工作台进入。');
      } while (after && !dead);
      if (dead) return;
      if (spaces.length === 1) {
        enter(spaces[0].tenantId);
        return;
      }
      entryError(
        spaces.length
          ? '请选择要修改本人资料的空间。'
          : '当前没有可用空间，请从工作台核对成员状态。',
      );
      for (const space of spaces) {
        if (validId(space.tenantId))
          root.append(
            button(space.displayName + ' · ' + space.tenantCode, () => enter(space.tenantId)),
          );
      }
    } catch (e) {
      if (!dead) entryError(e.message);
    }
  }
  void start();
})();
