/* Existing Identity protocol only: no business proxy or persisted password. */
(() => {
  const q = new URLSearchParams(location.search),
    tenant = q.get('tenant'),
    join = location.pathname === '/zhiban/join',
    root = document.getElementById('member-root');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  let actor = null,
    current = null,
    busy = false,
    pending = null,
    dead = false,
    subject = q.get('member'),
    admission = q.get('admission') || '',
    context = null;
  if (!join) document.body.dataset.adminPage = 'accounts';
  const controllers = new Set();
  const notice = el('p');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const button = (text, run) => {
    const b = el('button', text, 'button secondary');
    b.type = 'button';
    b.onclick = async () => {
      try {
        await run();
      } catch (e) {
        notice.textContent = e.message;
      }
    };
    b.disabled = busy;
    return b;
  };
  function input(parent, label, type = 'text', value = '') {
    const l = el('label', label),
      i = el('input');
    i.type = type;
    i.value = value;
    i.setAttribute('aria-label', label);
    if (type === 'password') {
      i.autocomplete = 'current-password';
      i.maxLength = 1024;
    }
    l.append(i);
    parent.append(l);
    return i;
  }
  function lock() {
    root
      .querySelectorAll('button,input,select')
      .forEach((n) => (n.disabled = busy || (pending && n.dataset.intentInput === 'true')));
  }
  async function api(path, body, key) {
    const c = new AbortController();
    controllers.add(c);
    const timer = setTimeout(() => c.abort(), 30000);
    try {
      const h = { 'x-zhiban-request': 'identity-v1' };
      if (body !== undefined) {
        const s = await fetch('/api/zhiban/identity/csrf', {
          credentials: 'same-origin',
          headers: h,
          signal: c.signal,
        });
        if (!s.ok)
          throw Object.assign(Error('安全令牌不可用；请核对登录后重试。'), {
            status: s.status,
            beforeSend: true,
          });
        h['x-zhiban-csrf'] = (await s.json()).csrfToken;
        h['Content-Type'] = 'application/json';
        if (key) h[path.includes('/management/') ? 'x-zhiban-command' : 'idempotency-key'] = key;
      }
      const r = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: h,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: c.signal,
      });
      const v = await r.json();
      if (!r.ok)
        throw Object.assign(
          Error(
            {
              401: '登录已失效，请重新登录。',
              403: '权限、本人密码或当前状态不允许此操作。',
              404: '目标不可访问或入驻引用无效。',
              409: '版本或批准已变化，请读取最新状态重新核对。',
              429: '请求过于频繁，请稍后重试。',
              503: '服务或入驻来源未就绪。',
            }[r.status] || '请求未完成',
          ),
          { status: r.status },
        );
      return v;
    } finally {
      clearTimeout(timer);
      controllers.delete(c);
    }
  }
  const base = `/api/zhiban/identity/tenants/${tenant}`;
  function envelope(p) {
    return {
      actorMembershipId: actor.membershipId,
      expectedActorRevision: p.actorRevision,
      expectedActorAuthorizationVersion: p.actorAuthorizationVersion,
      expectedTenantRevision: p.tenantRevision,
    };
  }
  async function spaces() {
    let cursor = null;
    do {
      const v = await api(
        '/api/zhiban/identity/spaces?limit=50' + (cursor ? '&afterMembershipId=' + cursor : ''),
      );
      actor = v.spaces.find((s) => s.tenantId === tenant) || actor;
      cursor = v.nextCursor;
    } while (!actor && cursor);
    if (!actor) throw Error('当前没有本空间管理资格。');
  }
  async function readPoint(id = subject, purpose = null) {
    if (!actor) await spaces();
    const v = await api(
      `${base}/memberships/${id}?actorMembershipId=${actor.membershipId}${purpose ? '&consentPurpose=' + purpose : ''}`,
    );
    let next = v.nextGrantCursor;
    const grants = [...v.grants];
    while (next) {
      const p = await api(
        `${base}/memberships/${id}?actorMembershipId=${actor.membershipId}&afterGrantId=${next}`,
      );
      if (
        p.revision !== v.revision ||
        p.authorizationVersion !== v.authorizationVersion ||
        p.actorRevision !== v.actorRevision ||
        p.actorAuthorizationVersion !== v.actorAuthorizationVersion ||
        p.tenantRevision !== v.tenantRevision
      )
        throw Error('授权分页期间状态已变化，请重新读取。');
      grants.push(...p.grants);
      next = p.nextGrantCursor;
      if (grants.length > 256) throw Error('授权数量超过页面管理范围，请受控处理。');
    }
    return { ...v, grants };
  }
  async function load() {
    if (join) {
      context = await api(`${base}/consent-context?admissionId=${admission}`);
    } else if (subject) {
      current = await readPoint(subject);
      if (['PENDING', 'DISABLED', 'LEFT'].includes(current.status))
        current = await readPoint(
          subject,
          { PENDING: 'ACTIVATE', DISABLED: 'REACTIVATE', LEFT: 'REJOIN' }[current.status],
        );
    } else {
      await spaces();
      subject = actor.membershipId;
      current = await readPoint(actor.membershipId);
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    lock();
    try {
      await load();
      if (!dead) {
        draw();
        notice.textContent = '已读取当前状态。';
      }
    } catch (e) {
      notice.textContent = e.message;
      if (e.status === 401) login();
      else if (!current && !context) {
        root.replaceChildren(
          el('h1', join ? '加入请求暂不可确认' : '成员信息暂不可访问'),
          notice,
          button(join ? '使用被邀请者账号登录' : '重新登录', () => login()),
        );
      }
    } finally {
      busy = false;
      lock();
    }
  }
  function allowedGrants() {
    return current.grants.every(
      (g) =>
        (g.roleCode === 'STUDENT' && g.scope.type === 'SELF') ||
        (g.roleCode === 'TENANT_ADMIN' && g.scope.type === 'TENANT') ||
        (g.roleCode === 'TEACHER' && ['CLASS', 'COURSE'].includes(g.scope.type)),
    );
  }
  async function execute(path, body, password, key = crypto.randomUUID(), intent = null) {
    if (busy) return;
    busy = true;
    lock();
    const secret = password?.value || '';
    if (password) password.value = '';
    try {
      const v = await api(
        path,
        body.password === undefined ? body : { ...body, password: secret },
        key,
      );
      pending = null;
      if (path.endsWith('/admin-transfer')) {
        current = null;
        root.replaceChildren(
          el('h1', '管理员授权交接已提交'),
          el('p', '已原子授予接任者并撤销本人所选管理员授权；请返回工作台核对当前空间资格。'),
          notice,
        );
        notice.textContent = '操作已确认：' + v.commandId;
        const back = el('a', '返回工作台', 'button secondary');
        back.href = '/zhiban';
        root.append(back);
        return;
      }
      if (v.effects?.[0]?.membershipId && !join) subject = v.effects[0].membershipId;
      await load();
      draw();
      notice.textContent = path.includes('/management/')
        ? '任教关系已登记；还须匹配的教师授权才能访问课程。'
        : '操作已确认：' + v.commandId;
    } catch (e) {
      if (!e.beforeSend && (!e.status || e.status >= 500)) {
        pending = {
          path,
          needsPassword: Object.hasOwn(body, 'password'),
          body: Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'password')),
          key,
          intent,
        };
        draw();
        notice.textContent = '结果待确认。密码已清空；请读取当前版本后，按原安全意图确认。';
      } else {
        if (pending) {
          pending.refusal = true;
          draw();
        }
        notice.textContent = e.message;
        if (e.status === 401) login();
      }
    } finally {
      busy = false;
      lock();
    }
  }
  function login() {
    root.replaceChildren(el('h1', '登录后确认加入'), notice);
    const f = el('form', undefined, 'academic-form'),
      uid = input(f, '账号 ID'),
      pw = input(f, '密码', 'password');
    const b = el('button', '登录并读取加入请求', 'button primary');
    b.type = 'submit';
    f.append(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      lock();
      try {
        const r = await fetch('/api/zhiban/identity/login', {
          method: 'POST',
          headers: { 'x-zhiban-request': 'identity-v1', 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ userId: uid.value, password: pw.value }),
          signal: AbortSignal.timeout(15000),
        });
        pw.value = '';
        if (!r.ok) throw Error('登录未完成，请核对账号。');
        actor = null;
        current = null;
        context = null;
        pending = null;
        await load();
        draw();
      } catch (e) {
        pw.value = '';
        notice.textContent = e.message;
      } finally {
        busy = false;
        lock();
      }
    };
    root.append(f);
  }
  function draw() {
    if (dead) return;
    root.replaceChildren(el('h1', join ? '确认加入本空间' : '空间成员管理'), notice);
    const back = el('a', join ? '返回工作台' : '返回成员账户目录', 'button secondary');
    back.href = join ? '/zhiban' : `/zhiban/admin/accounts?tenant=${tenant}`;
    root.append(back);
    if (join) {
      if (!context) return;
      if (pending) {
        root.append(
          button('重新读取并确认本人同意', async () => {
            try {
              await load();
              await execute(
                pending.path,
                {
                  ...pending.body,
                  expectedMemberRevision: context.expectedMemberRevision,
                  expectedAuthorizationVersion: context.expectedAuthorizationVersion,
                },
                null,
                pending.key,
              );
            } catch (e) {
              notice.textContent = e.message;
            }
          }),
        );
        return;
      }
      root.append(
        el(
          'p',
          `加入目的：${context.purpose} · 截止：${new Date(context.expiresAt).toLocaleString()}`,
        ),
        el('p', '同意只记录本人意愿；需管理员重新审批激活，不会自动获得角色。'),
      );
      root.append(
        button('本人同意该加入请求', () =>
          execute(
            base + '/consents',
            {
              admissionId: admission,
              expectedMemberRevision: context.expectedMemberRevision,
              expectedAuthorizationVersion: context.expectedAuthorizationVersion,
            },
            null,
          ),
        ),
      );
      return;
    }
    if (!current) return;
    const panel = el('section', undefined, 'academic-form');
    panel.append(
      el('h2', '当前空间成员'),
      el('p', `成员ID：${current.membershipId}`),
      el('p', `UserId：${current.userId} · 状态：${current.status}`),
      el('p', `修订：${current.revision} · 授权版本：${current.authorizationVersion}`),
    );
    const target = input(panel, '目标成员ID', 'text', subject || '');
    panel.append(
      button('读取目标成员', async () => {
        if (pending) return;
        subject = target.value;
        await refresh();
      }),
    );
    for (const g of current.grants) {
      const row = el(
        'p',
        `${g.roleCode} / ${g.scope.type}${g.scope.scopeId ? ' / ' + g.scope.scopeId : ''} · ${g.validUntil ? new Date(g.validUntil).toLocaleString() : '长期'} · ${g.grantId}`,
      );
      if (subject !== actor.membershipId && !pending)
        row.append(
          button('撤销授权 ' + g.grantId, () =>
            mutate('revoke-grant', { revokeGrantId: g.grantId }, pw),
          ),
        );
      panel.append(row);
    }
    panel.append(
      el(
        'p',
        '教师授权按精确课程或教学班生效，另须当前任教关系。先登记任教关系，再授予教师角色；行政班不是教学班。',
      ),
    );
    const pw = input(panel, '操作人当前密码', 'password');
    const grantSelect = el('select');
    grantSelect.setAttribute('aria-label', '授予角色');
    for (const [v, t] of [
      ['STUDENT', '学生（SELF）'],
      ['TEACHER_CLASS', '教师（指定教学班）'],
      ['TEACHER_COURSE', '教师（指定课程）'],
      ['TENANT_ADMIN', '空间管理员（TENANT，仅他人）'],
    ]) {
      const o = el('option', t);
      o.value = v;
      grantSelect.append(o);
    }
    panel.append(grantSelect);
    grantSelect.dataset.intentInput = 'true';
    const until = input(panel, '授权截止时间（留空长期）', 'datetime-local');
    until.dataset.intentInput = 'true';
    const resourcePanel = el('section', undefined, 'management-card');
    resourcePanel.hidden = true;
    const search = input(resourcePanel, '任教教学班搜索'),
      selected = el('select');
    selected.setAttribute('aria-label', '任教教学班');
    selected.dataset.intentInput = 'true';
    let offeringRows = [],
      resourceCursor = null,
      selectedOffering = null;
    const describe = el('p', '课程范围仍要求逐教学班存在任教关系；登记关系不自动授予教师角色。');
    async function findOfferings(after = null) {
      const data = await api(
        `/api/zhiban/management/${tenant}/offerings?` +
          new URLSearchParams({
            q: search.value.trim(),
            limit: '20',
            state: 'OPEN',
            ...(after ? { cursor: after } : {}),
          }),
      );
      offeringRows = data.rows;
      resourceCursor = data.nextCursor;
      selectedOffering = null;
      selected.replaceChildren(el('option', '请选择任教教学班'));
      for (const row of offeringRows) {
        const o = el('option', `${row.name} · ${row.course_name || row.course_id}`);
        o.value = row.id;
        selected.append(o);
      }
      if (!offeringRows.length) notice.textContent = '本页没有开放教学班。';
    }
    selected.onchange = () => {
      selectedOffering = offeringRows.find((r) => r.id === selected.value) || null;
    };
    search.dataset.intentInput = 'true';
    resourcePanel.append(
      button('搜索任教教学班', () => findOfferings()),
      selected,
      button('下一页任教教学班', () => resourceCursor && findOfferings(resourceCursor)),
      describe,
      button('登记任教待授权', async () => {
        if (pending) return;
        if (!selectedOffering) throw Error('请先选择教学班。');
        if (!confirm('登记当前成员的任教关系；没有匹配教师角色时仍不能教学。确认继续？')) return;
        const data = await api(
          `/api/zhiban/management/${tenant}/assignments?` +
            new URLSearchParams({
              offering: selectedOffering.id,
              member: current.membershipId,
              state: 'ALL',
              limit: '10',
            }),
        );
        const old = data.rows[0];
        if (old?.status === 'ACTIVE') {
          notice.textContent = '任教关系已登记；请核对并授予匹配的教师角色。';
          return;
        }
        await execute(
          `/api/zhiban/management/${tenant}/commands`,
          {
            type: 'PREPARE_TEACHER',
            offeringId: selectedOffering.id,
            membershipId: current.membershipId,
            revision: old ? String(old.revision) : null,
          },
          null,
        );
      }),
    );
    panel.append(resourcePanel);
    grantSelect.onchange = () => {
      resourcePanel.hidden = !grantSelect.value.startsWith('TEACHER_');
    };
    const specs = () => {
      const teacher = grantSelect.value.startsWith('TEACHER_');
      if (teacher && !selectedOffering)
        throw Error('请先搜索并选择任教教学班；授权时服务器重新核验真实任教关系。');
      const deadline = until.value ? new Date(until.value).getTime() : null;
      if (
        deadline !== null &&
        (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > 8640000000000000)
      )
        throw Error('授权截止必须是有效的未来时间；留空表示长期。');
      return [
        {
          roleCode: teacher ? 'TEACHER' : grantSelect.value,
          scope: teacher
            ? {
                type: grantSelect.value === 'TEACHER_COURSE' ? 'COURSE' : 'CLASS',
                scopeId:
                  grantSelect.value === 'TEACHER_COURSE'
                    ? selectedOffering.course_id
                    : selectedOffering.id,
              }
            : { type: grantSelect.value === 'STUDENT' ? 'SELF' : 'TENANT', scopeId: null },
          validUntil: deadline,
        },
      ];
    };
    if (pending) {
      const proposal = pending.body.targets
        ? pending.body.targets.flatMap((t) => (t.grant ? [t.grant] : []))
        : (pending.body.grants ?? (pending.body.grant ? [pending.body.grant] : []));
      panel.append(
        el(
          'p',
          '待确认原操作：' +
            (pending.body.type === 'PREPARE_TEACHER'
              ? '登记任教关系'
              : {
                  invitations: '邀请成员',
                  activate: '激活成员',
                  disable: '停用成员',
                  reactivate: '恢复成员',
                  rejoin: '重新加入',
                  grant: '授予角色',
                  'revoke-grant': '撤销授权',
                  'replace-grants': '替换授权',
                  'admin-transfer': '原子交接管理员',
                }[pending.path.split('/').pop()] || '成员变更') +
            '；拟授予：' +
            (proposal
              .map(
                (g) =>
                  g.roleCode +
                  '/' +
                  g.scope.type +
                  (g.validUntil ? ' 截止 ' + new Date(g.validUntil).toLocaleString() : ' 长期'),
              )
              .join('、') || '无新增角色') +
            (pending.body.revokeGrantId ? '；撤销授权 ' + pending.body.revokeGrantId : ''),
        ),
      );
      panel.append(
        el('p', '当前暂停其他修改，请输入本人密码后确认原操作结果。'),
        button('读取当前版本并确认原操作', async () => {
          try {
            if (pending.path.endsWith('/admin-transfer'))
              throw Error('交接结果待由现任管理员核对；本页不自动重放或恢复本人权限。');
            if (pending.path.includes('/management/')) {
              await execute(pending.path, pending.body, null, pending.key, pending.intent);
              return;
            }
            const invitation = pending.path.endsWith('/invitations');
            const fresh = await readPoint(invitation ? actor.membershipId : subject);
            const b = {
              ...pending.body,
              ...envelope(fresh),
              ...(invitation
                ? {}
                : {
                    expectedRevision: fresh.revision,
                    expectedAuthorizationVersion: fresh.authorizationVersion,
                  }),
              ...(pending.needsPassword ? { password: '' } : {}),
            };
            await execute(
              pending.path,
              b,
              pending.needsPassword ? pw : null,
              pending.key,
              pending.intent,
            );
          } catch (e) {
            notice.textContent = e.message;
          }
        }),
      );
      if (pending.refusal)
        panel.append(
          button('结束旧确认并读取当前事实', async () => {
            const key = pending.key;
            pending = null;
            await refresh();
            notice.textContent =
              '旧命令 ' + key + ' 未能确认；当前事实已刷新，请另行核对审批，不代表旧操作失败。';
          }),
        );
    } else if (subject !== actor.membershipId) {
      if (current.status === 'ACTIVE') {
        panel.append(
          button('停用本空间成员', () => {
            if (confirm('停用后该成员无法访问本空间；历史作答与成绩保留。'))
              return mutate('disable', { reason: 'ADMIN_REQUEST' }, pw);
          }),
          button('授予所选角色', () => mutate('grant', { grant: specs()[0] }, pw)),
        );
        if (allowedGrants())
          panel.append(
            button('以所选角色替换全部授权', () => {
              if (confirm('完整替换当前展示的全部授权，确认继续？'))
                return mutate('replace-grants', { grants: specs() }, pw);
            }),
          );
      } else if (['PENDING', 'DISABLED', 'LEFT'].includes(current.status)) {
        panel.append(
          el(
            'p',
            current.consent
              ? '本人同意已就绪，请核对并审批。'
              : '尚无当前有效的本人同意；请先取得受控入驻引用并交本人确认。',
          ),
        );
        if (current.consent && allowedGrants())
          panel.append(
            button(
              current.status === 'PENDING' ? '激活并授予所选角色' : '恢复并重新授予所选角色',
              () => {
                const action = { PENDING: 'activate', DISABLED: 'reactivate', LEFT: 'rejoin' }[
                  current.status
                ];
                return mutate(
                  action,
                  {
                    admissionId: current.consent.admissionId,
                    consentId: current.consent.consentId,
                    ...(action === 'reactivate' ? { mode: 'REPLACE_GRANTS' } : {}),
                    grants: specs(),
                  },
                  pw,
                );
              },
            ),
          );
      }
    }
    if (!pending && current.membershipId === actor.membershipId) {
      const authority = current.grants.filter(
        (g) => g.roleCode === 'TENANT_ADMIN' && g.scope.type === 'TENANT',
      );
      if (authority.length === 1) {
        const successor = input(panel, '接任成员ID');
        panel.append(
          el(
            'p',
            '原子交接会给接任者授予空间管理员，并撤销本人当前唯一的管理员授权；不删除其他角色。',
          ),
          button('原子交接管理员授权', async () => {
            try {
              if (!uuid.test(successor.value) || successor.value === actor.membershipId)
                throw Error('请填写其他当前成员ID。');
              const to = await readPoint(successor.value);
              if (to.status !== 'ACTIVE' || to.userId === current.userId)
                throw Error('接任者须为其他有效成员。');
              if (!confirm('确认原子交接并撤销本人管理员授权？')) return;
              const target = (p, action, extra) => ({
                userId: p.userId,
                membershipId: p.membershipId,
                action,
                expectedRevision: p.revision,
                expectedAuthorizationVersion: p.authorizationVersion,
                ...extra,
              });
              await execute(
                base + '/admin-transfer',
                {
                  ...envelope(current),
                  targets: [
                    target(to, 'ROLE_GRANT', {
                      grant: {
                        roleCode: 'TENANT_ADMIN',
                        scope: { type: 'TENANT', scopeId: null },
                        validUntil: authority[0].validUntil,
                      },
                    }),
                    target(current, 'ROLE_REVOKE', { revokeGrantId: authority[0].grantId }),
                  ],
                  password: '',
                },
                pw,
              );
            } catch (e) {
              notice.textContent = e.message;
            }
          }),
        );
      }
    }
    panel.append(button('读取最新成员状态', refresh));
    root.append(panel);
    if (!pending) {
      const inv = el('section', undefined, 'academic-form');
      inv.append(
        el('h2', '邀请已注册账户'),
        el('p', '只接收受控命令行已登记的入驻引用，不搜索全局用户或直接开户。'),
      );
      const ref = input(inv, '已登记入驻引用'),
        pass = input(inv, '邀请操作人当前密码', 'password');
      inv.append(
        button('创建待确认邀请', async () => {
          if (!uuid.test(ref.value)) {
            notice.textContent = '请填写有效的入驻引用。';
            return;
          }
          const own = await readPoint(actor.membershipId);
          await execute(
            base + '/invitations',
            { ...envelope(own), admissionId: ref.value, password: '' },
            pass,
          );
          if (subject) {
            const a = el('a', '打开本人加入确认页', 'button secondary');
            a.href = `/zhiban/join?tenant=${tenant}&admission=${ref.value}`;
            root.append(a);
          }
        }),
      );
      root.append(inv);
    }
  }
  async function mutate(action, extra, pw) {
    if (busy || pending) return;
    const body = {
      ...envelope(current),
      expectedRevision: current.revision,
      expectedAuthorizationVersion: current.authorizationVersion,
      ...extra,
      password: '',
    };
    return execute(`${base}/memberships/${subject}/${action}`, body, pw, undefined, {
      action,
      extra,
    });
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      root.replaceChildren(el('p', '会话已变化，请重新读取当前身份。'));
      location.reload();
    };
  window.addEventListener('beforeunload', (e) => {
    if (pending || busy) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  root.addEventListener('click', (e) => {
    if ((busy || pending) && e.target.closest('a')) {
      e.preventDefault();
      notice.textContent = '请先确认当前操作结果。';
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      dead = true;
      channel?.close();
      for (const c of controllers) c.abort();
      root.querySelectorAll('input[type=password]').forEach((i) => (i.value = ''));
    },
    { once: true },
  );
  if (!uuid.test(tenant || '') || (join && !uuid.test(admission))) {
    notice.textContent = '空间或入驻引用无效。';
    root.replaceChildren(notice);
  } else
    document.addEventListener(
      'DOMContentLoaded',
      async () => {
        if (!join && window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
        await refresh();
      },
      { once: true },
    );
})();
