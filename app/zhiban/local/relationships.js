(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('relationship-content'),
    message = document.getElementById('relationship-message'),
    params = new URLSearchParams(location.search);
  const tenant = params.get('tenant'),
    offering = params.get('offering'),
    classId = params.get('classId'),
    uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !tenant ||
    !uuid.test(tenant) ||
    (offering === null) === (classId === null) ||
    (offering !== null && !uuid.test(offering)) ||
    (classId !== null && !uuid.test(classId)) ||
    [...params.keys()].some(
      (k) => !['tenant', 'offering', 'classId'].includes(k) || params.getAll(k).length !== 1,
    )
  ) {
    message.textContent = '页面地址无效，请从分页教务管理进入。';
    return;
  }
  const kind = offering ? 'assignments' : 'class-members',
    target = offering ? { offering } : { classId };
  document.getElementById('relationship-title').textContent = offering
    ? '任教关系管理'
    : '行政班成员与班主任';
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = el('button', text, 'button secondary');
    b.type = 'button';
    b.addEventListener('click', () => void fn());
    return b;
  };
  const blocked = () => busy || pending !== null || closed;
  const errors = {
    FORBIDDEN: '无管理权限或成员不可用',
    UNAUTHENTICATED: '登录已失效，请返回工作台',
    CONFLICT: '数据已变化，请刷新后重试',
    INVALID_STATE: '当前状态不允许操作',
    INACTIVE_MEMBER: '成员或所需身份已失效',
    INVALID_INPUT: '输入无效',
    NOT_FOUND: '记录不存在',
    INVALID_REQUEST: '请求内容无效',
  };
  let q = '',
    state = 'ACTIVE',
    limit = '20',
    cursors = [null],
    index = 0,
    busy = false,
    pending = null,
    closed = false,
    generation = 0,
    studentPicker = null,
    cleanupPicker = () => {},
    detail = null;
  const controllers = new Set();
  async function api(route, filters = {}, command = null, key = null) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    const headers = { 'x-zhiban-request': 'identity-v1' };
    try {
      if (command) {
        const proof = await fetch('/api/zhiban/identity/csrf', {
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await proof.json();
        if (!proof.ok)
          throw Object.assign(new Error(errors[json.error?.code] || '安全令牌不可用'), {
            definitive: true,
          });
        headers['content-type'] = 'application/json';
        headers['x-zhiban-csrf'] = json.csrfToken;
        headers['x-zhiban-command'] = key;
      }
      const search = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== null && v !== undefined),
      );
      const response = await fetch(
        `/api/zhiban/management/${tenant}/${route}${search.size ? '?' + search : ''}`,
        {
          method: command ? 'POST' : 'GET',
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          ...(command ? { body: JSON.stringify(command) } : {}),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(errors[data.error?.code] || '服务暂不可用'), {
          definitive: response.status >= 400 && response.status < 500,
        });
      return data;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function disable(value) {
    busy = value;
    root.querySelectorAll('input,button,select').forEach((n) => (n.disabled = value));
    studentPicker?.setDisabled(value);
  }
  async function mutate(command) {
    if (blocked()) return;
    pending = { command, key: crypto.randomUUID() };
    await send();
  }
  async function send() {
    if (!pending || busy || closed) return;
    disable(true);
    message.textContent = '正在提交…';
    try {
      await api('commands', {}, pending.command, pending.key);
      pending = null;
      disable(false);
      message.textContent = '操作已完成。';
      await load();
    } catch (e) {
      if (closed) return;
      if (e.definitive) {
        pending = null;
        disable(false);
        message.textContent = e.message + '。请刷新名单。';
      } else {
        busy = false;
        message.replaceChildren(
          el('p', '结果待确认，其他操作已暂停，请保留当前页面并按原命令号确认。'),
          el('small', pending.key),
          button('按原命令号重试', send),
        );
      }
    }
  }
  function input(form, label, value = '') {
    const l = el('label', label),
      n = el('input');
    n.value = value;
    n.maxLength = 120;
    l.append(n);
    form.append(l);
    return n;
  }
  function select(form, label, options, value) {
    const l = el('label', label),
      n = el('select');
    n.setAttribute('aria-label', label);
    for (const [v, t] of options) {
      const o = el('option', t);
      o.value = v;
      n.append(o);
    }
    n.value = value;
    l.append(n);
    form.append(l);
    return n;
  }
  function clear() {
    studentPicker?.destroy();
    studentPicker = null;
    cleanupPicker();
    cleanupPicker = () => {};
    root.replaceChildren();
  }
  async function prepare(member) {
    if (blocked()) return;
    disable(true);
    try {
      const page = await api(kind, { ...target, member, state: 'ALL', limit: '10' });
      if (closed) return;
      const row = page.rows[0];
      disable(false);
      if ((offering && row?.status === 'ACTIVE') || (!offering && row?.active)) {
        message.textContent = '该成员已在当前关系中。';
        return;
      }
      await mutate(
        offering
          ? {
              type: 'ASSIGN_TEACHER',
              offeringId: offering,
              membershipId: member,
              revision: row?.revision || null,
            }
          : {
              type: 'CLASS_MEMBER',
              classId,
              membershipId: member,
              active: true,
              revision: row?.revision || null,
            },
      );
    } catch (e) {
      if (!closed) {
        disable(false);
        message.textContent = e.message;
      }
    }
  }
  function teachers(parent) {
    const details = el('details', undefined, 'management-card');
    details.append(el('summary', offering ? '搜索并指定任教教师' : '搜索并设置班主任'));
    parent.append(details);
    const form = el('form', undefined, 'management-filters'),
      search = input(form, '教师搜索'),
      size = select(
        form,
        '教师每页条数',
        [
          ['10', '10'],
          ['20', '20'],
          ['50', '50'],
        ],
        '10',
      ),
      submit = el('button', '搜索教师', 'button');
    submit.type = 'submit';
    form.append(submit);
    details.append(
      el('p', '仅显示本空间当前教师候选；提交时重新检查成员、权限与版本。', 'muted'),
      form,
    );
    const results = el('div', undefined, 'teacher-results');
    details.append(results);
    let query = '',
      pageSize = '10',
      cursor = null,
      history = [null],
      page = 0,
      loading = false,
      epoch = 0,
      started = false,
      destroyed = false;
    cleanupPicker = () => {
      destroyed = true;
      epoch++;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (blocked() || loading) return;
      query = search.value.trim();
      pageSize = size.value;
      cursor = null;
      history = [null];
      page = 0;
      void read();
    });
    async function read() {
      if (blocked() || destroyed) return;
      loading = true;
      const version = ++epoch;
      form.querySelectorAll('input,button,select').forEach((n) => (n.disabled = true));
      results.replaceChildren(el('p', '正在搜索教师…'));
      try {
        const data = await api('teachers', { ...target, q: query, limit: pageSize, cursor });
        if (destroyed || closed || version !== epoch || !results.isConnected) return;
        results.replaceChildren();
        for (const row of data.rows) {
          const card = el('article', undefined, 'management-option');
          card.append(
            el('span', row.name || '未填写姓名'),
            el('small', row.membership_id),
            button(
              offering ? '指定任教' : '设为班主任',
              () =>
                !blocked() &&
                (offering
                  ? prepare(row.membership_id)
                  : mutate({
                      type: 'CLASS_HEAD_TEACHER',
                      id: classId,
                      revision: detail.revision,
                      membershipId: row.membership_id,
                    })),
            ),
          );
          results.append(card);
        }
        if (!data.rows.length)
          results.append(
            el('p', data.nextCursor ? '本页无匹配教师，可继续下一页。' : '暂无匹配教师。'),
          );
        const nav = el('nav', undefined, 'management-pagination');
        nav.setAttribute('aria-label', '教师搜索分页');
        const prev = button('上一页教师', () => {
            if (!blocked() && !loading && page > 0) {
              cursor = history[--page];
              return read();
            }
          }),
          next = button('下一页教师', () => {
            if (!blocked() && !loading && data.nextCursor) {
              history[++page] = cursor = data.nextCursor;
              return read();
            }
          });
        prev.disabled = page === 0;
        next.disabled = !data.nextCursor;
        window.zhibanAdminShell?.table(list, kind);
        nav.append(prev, el('span', `第 ${page + 1} 页 · 本页 ${data.rows.length} 条`), next);
        results.append(nav);
      } catch (e) {
        if (!destroyed && !closed && version === epoch)
          results.replaceChildren(el('p', e.message), button('重试教师搜索', read));
      } finally {
        if (!destroyed && version === epoch) {
          loading = false;
          form.querySelectorAll('input,button,select').forEach((n) => (n.disabled = blocked()));
        }
      }
    }
    details.addEventListener('toggle', () => {
      if (details.open && !started && !blocked()) {
        started = true;
        void read();
      }
    });
  }
  function students(parent) {
    const details = el('details', undefined, 'management-card');
    details.append(el('summary', '从学生目录添加行政班成员'));
    const container = el('div');
    details.append(container);
    let mounted = false;
    details.addEventListener('toggle', () => {
      if (details.open && !mounted && !blocked()) {
        mounted = true;
        studentPicker = window.zhibanDirectory.mount(tenant, container, { selection: true });
      }
    });
    details.append(
      button('添加已选成员', () => {
        if (blocked()) return;
        const ids = studentPicker?.selected() || [];
        if (ids.length !== 1) {
          message.textContent = '请选择一名学生后添加。';
          return;
        }
        return prepare(ids[0]);
      }),
    );
    parent.append(details);
  }
  async function load() {
    if (blocked()) return;
    const epoch = ++generation;
    disable(true);
    try {
      const data = await api(kind, { ...target, q, state, limit, cursor: cursors[index] });
      if (epoch !== generation || closed) return;
      clear();
      detail = offering ? data.offering : data.classInfo;
      const back = el('a', '返回分页教务管理', 'button secondary');
      back.href = window.zhibanAdminShell.managementUrl(
        tenant,
        classId ? 'classes' : 'offerings',
        offering,
      );
      root.append(back, button('刷新关系', load));
      const header = el('section', undefined, 'management-card');
      header.append(el('h2', detail.name), el('p', detail.code));
      if (classId) {
        header.append(
          el('p', '班主任：' + (detail.head_teacher_name || detail.head_teacher_id || '未指定')),
        );
        if (detail.head_teacher_id)
          header.append(
            button('清除班主任', () =>
              mutate({
                type: 'CLASS_HEAD_TEACHER',
                id: classId,
                revision: detail.revision,
                membershipId: null,
              }),
            ),
          );
        header.append(
          el('p', '行政班成员与教学班选课独立维护，添加成员不会自动入教学班。', 'muted'),
        );
      } else
        header.append(
          el('p', '任教关系与教师授权共同决定访问；指定任教不会授予或扩大角色权限。', 'muted'),
        );
      root.append(header);
      teachers(root);
      if (classId) students(root);
      const filters = el('form', undefined, 'management-filters'),
        query = input(filters, offering ? '搜索任教关系' : '搜索班级成员', q),
        status = select(
          filters,
          '关系状态',
          offering
            ? [
                ['ACTIVE', '任教中'],
                ['ENDED', '已结束'],
                ['ALL', '全部'],
              ]
            : [
                ['ACTIVE', '在班'],
                ['INACTIVE', '已移出'],
                ['ALL', '全部'],
              ],
          state,
        ),
        size = select(
          filters,
          '关系每页条数',
          [
            ['10', '10'],
            ['20', '20'],
            ['50', '50'],
          ],
          limit,
        ),
        search = el('button', '搜索关系', 'button');
      search.type = 'submit';
      filters.append(search);
      filters.addEventListener('submit', (e) => {
        e.preventDefault();
        if (blocked()) return;
        q = query.value.trim();
        state = status.value;
        limit = size.value;
        index = 0;
        cursors = [null];
        void load();
      });
      root.append(filters);
      const list = el('div', undefined, 'relationship-list management-list');
      root.append(list);
      for (const row of data.rows) {
        const card = el('article', undefined, 'management-card'),
          active = offering ? row.status === 'ACTIVE' : row.active;
        card.append(
          el('h3', row.name || '未填写姓名'),
          el('small', row.membership_id),
          el('p', offering ? (active ? '任教中' : '已结束') : active ? '在班' : '已移出'),
          button(
            offering
              ? active
                ? '结束任教'
                : '重新指定任教'
              : active
                ? '移出行政班'
                : '恢复班级成员',
            () =>
              mutate(
                offering
                  ? active
                    ? { type: 'END_TEACHER', id: row.id, revision: row.revision }
                    : {
                        type: 'ASSIGN_TEACHER',
                        offeringId: offering,
                        membershipId: row.membership_id,
                        revision: row.revision,
                      }
                  : {
                      type: 'CLASS_MEMBER',
                      classId,
                      membershipId: row.membership_id,
                      active: !active,
                      revision: row.revision,
                    },
              ),
          ),
        );
        list.append(card);
      }
      if (!data.rows.length)
        list.append(el('p', index ? '本页已无记录，请返回上一页或重新搜索。' : '暂无关系记录。'));
      const nav = el('nav', undefined, 'management-pagination');
      nav.setAttribute('aria-label', '关系分页');
      const prev = button('上一页', () => {
          if (!blocked() && index > 0) {
            index--;
            return load();
          }
        }),
        next = button('下一页', () => {
          if (!blocked() && data.nextCursor) {
            cursors[++index] = data.nextCursor;
            return load();
          }
        });
      window.zhibanAdminShell?.table(list, kind);
      nav.append(prev, el('span', `第 ${index + 1} 页 · 本页 ${data.rows.length} 条`), next);
      root.append(nav);
      disable(false);
      prev.disabled = index === 0;
      next.disabled = !data.nextCursor;
    } catch (e) {
      if (epoch === generation && !closed) {
        disable(false);
        message.textContent = e.message + '。已完成的操作保留。';
        if (!root.childElementCount) root.append(button('重试加载', load));
      }
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  function close() {
    closed = true;
    generation++;
    controllers.forEach((c) => c.abort());
    clear();
    message.textContent = '登录状态已变化，请返回工作台。';
    channel?.close();
  }
  if (channel) channel.onmessage = close;
  window.addEventListener('pagehide', close, { once: true });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  void load();
})();
