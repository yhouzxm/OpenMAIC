/* Shared bounded administration view; the server determines every permission. */
(() => {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  window.zhibanManagement = {
    mount(tenant, root, message, options = {}) {
      const el = (tag, text, cls) => {
        const n = document.createElement(tag);
        if (text !== undefined) n.textContent = text;
        if (cls) n.className = cls;
        return n;
      };
      const button = (text, fn) => {
        const b = el('button', text);
        b.type = 'button';
        b.addEventListener('click', () => void fn());
        return b;
      };
      const link = (text, href) => {
        const a = el('a', text, 'button secondary');
        a.href = href;
        return a;
      };
      const codes = {
        FORBIDDEN: '没有管理员权限或授权已失效',
        CONFLICT: '数据已变化，请刷新后重试',
        CAPACITY_FULL: '目标教学班容量已满',
        INVALID_STATE: '当前状态不允许此操作',
        INACTIVE_MEMBER: '成员不可用',
        NOT_FOUND: '记录不存在',
        INVALID_INPUT: '输入无效',
        INVALID_REQUEST: '请求内容无效或过长',
        UNAUTHENTICATED: '登录已失效，请返回工作台重新登录',
      };
      const auditLabels = {
        CREATE_TERM: '新建学期',
        CREATE_COURSE: '新建课程',
        EDIT_COURSE: '编辑课程',
        PUBLISH_COURSE: '发布课程',
        ARCHIVE_COURSE: '归档课程',
        CREATE_CLASS: '新建行政班',
        CLASS_MEMBER: '变更行政班成员',
        CLASS_HEAD_TEACHER: '设置／清除班主任',
        CREATE_OFFERING: '新建教学班',
        UPDATE_OFFERING: '修改教学班',
        PREPARE_TEACHER: '登记任教待授权',
        ASSIGN_TEACHER: '指定／恢复任教',
        END_TEACHER: '结束任教',
        ENROLL: '添加／恢复学生',
        WITHDRAW: '移出学生',
        TRANSFER: '转班',
      };
      let event = 'ALL',
        from = '',
        through = '';
      let section = options.section || 'offerings',
        catalogCleanup = () => {},
        offering = options.offering || null,
        q = '',
        state = options.offering ? 'ACTIVE' : 'ALL',
        limit = '20',
        cursors = [null],
        page = 0,
        busy = false,
        pending = null,
        generation = 0,
        picker = null,
        closed = false,
        readError = false;
      const controllers = new Set();
      const disabledControls = new Map();
      async function request(kind, filters = {}, command = null, key = null) {
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 10000);
        const headers = { 'x-zhiban-request': 'identity-v1' };
        try {
          if (command) {
            const csrf = await fetch('/api/zhiban/identity/csrf', {
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller.signal,
            });
            const value = await csrf.json();
            if (!csrf.ok)
              throw Object.assign(new Error(codes[value.error?.code] || '无法取得安全令牌'), {
                definitive: true,
              });
            headers['content-type'] = 'application/json';
            headers['x-zhiban-csrf'] = value.csrfToken;
            headers['x-zhiban-command'] = key;
          }
          if (closed) throw new Error('管理视图已关闭');
          const search = new URLSearchParams(
            Object.entries(filters).filter(([, v]) => v !== null && v !== undefined),
          );
          const response = await fetch(
            `/api/zhiban/management/${tenant}/${kind}${search.size ? '?' + search : ''}`,
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
            throw Object.assign(new Error(codes[data.error?.code] || '服务暂不可用'), {
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
        if (value)
          root.querySelectorAll('button,input,select').forEach((n) => {
            // Unknown-result retries must retain the state from before the first request.
            if (!disabledControls.has(n)) disabledControls.set(n, n.disabled);
            n.disabled = true;
          });
        else {
          for (const [n, wasDisabled] of disabledControls)
            if (n.isConnected) n.disabled = wasDisabled;
          disabledControls.clear();
        }
        picker?.setDisabled(value);
      }
      async function mutate(command, after = null) {
        if (busy || pending || closed) return;
        pending = { command, key: crypto.randomUUID(), after };
        await sendPending();
      }
      async function sendPending() {
        if (!pending || busy || closed) return;
        disable(true);
        message.replaceChildren(el('span', '正在提交…'));
        try {
          await request('commands', {}, pending.command, pending.key);
          if (closed) return;
          const after = pending.after;
          pending = null;
          if (after) after();
          disable(false);
          message.textContent = '操作已完成。';
          // A subsequent read failure cannot change a known COMMIT into an unknown result.
          await load();
        } catch (error) {
          if (closed) return;
          if (error.definitive) {
            pending = null;
            disable(false);
            message.textContent = error.message + '。请刷新名单。';
          } else {
            busy = false;
            message.replaceChildren(
              el('span', '结果待确认；保留原命令号重试，期间暂停其他操作。'),
              el('small', pending.key),
              button('按原命令号重试', sendPending),
            );
          }
        }
      }
      function reset() {
        cursors = [null];
        page = 0;
      }
      function filters(parent, kind, reload) {
        const form = el('form', undefined, 'management-filters');
        const label = {
          offerings: '教学班',
          enrollments: '学生',
          courses: '课程',
          terms: '学期',
          classes: '行政班',
          history: '操作历史',
        }[kind];
        const searchLabel = el('label', '搜索' + label),
          input = el('input');
        input.value = q;
        input.maxLength = 120;
        input.placeholder =
          kind === 'history'
            ? '操作人／涉及成员姓名或完整 ID、对象名称／编号／完整 ID、记录 ID'
            : kind === 'enrollments'
              ? '姓名或完整成员 ID'
              : '名称、编号或完整 ID';
        searchLabel.append(input);
        form.append(searchLabel);
        const stateLabel = el('label', kind === 'history' ? '操作类型' : '状态'),
          select = el('select');
        select.setAttribute('aria-label', kind === 'history' ? '操作类型' : '状态');
        for (const [v, text] of kind === 'history'
          ? [['ALL', '全部操作'], ...Object.entries(auditLabels)]
          : kind === 'offerings'
            ? [
                ['ALL', '全部'],
                ['OPEN', '开放'],
                ['CLOSED', '关闭'],
              ]
            : kind === 'courses'
              ? [
                  ['ALL', '全部'],
                  ['DRAFT', '草稿'],
                  ['PUBLISHED', '已发布'],
                  ['ARCHIVED', '已归档'],
                ]
              : kind !== 'enrollments'
                ? [['ALL', '全部']]
                : [
                    ['ACTIVE', '在班'],
                    ['WITHDRAWN', '已退班'],
                    ['ALL', '全部'],
                  ]) {
          const option = el('option', text);
          option.value = v;
          select.append(option);
        }
        select.value = kind === 'history' ? event : state;
        stateLabel.append(select);
        form.append(stateLabel);
        const dates = [];
        if (kind === 'history')
          for (const [label, value] of [
            ['开始日期（UTC）', from],
            ['结束日期（UTC）', through],
          ]) {
            const l = el('label', label),
              input = el('input');
            input.type = 'date';
            input.value = value;
            l.append(input);
            form.append(l);
            dates.push(input);
          }
        const sizeLabel = el('label', '每页条数'),
          size = el('select');
        size.setAttribute('aria-label', '每页条数');
        for (const v of ['10', '20', '50']) {
          const option = el('option', v);
          option.value = v;
          size.append(option);
        }
        size.value = limit;
        sizeLabel.append(size);
        form.append(sizeLabel);
        const submit = el('button', '搜索');
        submit.type = 'submit';
        form.append(submit);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (busy || pending || closed) return;
          q = input.value.trim();
          if (kind === 'history') {
            event = select.value;
            from = dates[0].value;
            through = dates[1].value;
            state = 'ALL';
          } else state = select.value;
          limit = size.value;
          reset();
          void reload();
        });
        parent.append(form);
      }
      function pagination(parent, data, reload) {
        const nav = el('nav', undefined, 'management-pagination');
        nav.setAttribute(
          'aria-label',
          section === 'history' && !offering ? '操作历史分页' : '名单分页',
        );
        const prev = button('上一页', () => {
            if (!busy && page > 0) {
              page--;
              return reload();
            }
          }),
          next = button('下一页', () => {
            if (!busy && data.nextCursor) {
              cursors[++page] = data.nextCursor;
              return reload();
            }
          });
        prev.disabled = page === 0;
        next.disabled = !data.nextCursor;
        nav.append(prev, el('span', `第 ${page + 1} 页 · 本页 ${data.rows.length} 条`), next);
        parent.append(nav);
      }
      function switchPage(id) {
        if (busy || pending || closed) return;
        offering = id;
        q = '';
        event = 'ALL';
        from = '';
        through = '';
        state = id ? 'ACTIVE' : 'ALL';
        reset();
        void load();
      }
      function clean() {
        catalogCleanup();
        catalogCleanup = () => {};
        picker?.destroy();
        picker = null;
        root.replaceChildren();
      }
      async function load() {
        if (busy || pending || closed) return;
        const epoch = ++generation;
        disable(true);
        try {
          const kind = offering ? 'enrollments' : section;
          const data = await request(kind, {
            q,
            state,
            limit,
            cursor: cursors[page],
            ...(offering ? { offering } : {}),
            ...(kind === 'history'
              ? { event, ...(from ? { from } : {}), ...(through ? { through } : {}) }
              : {}),
          });
          if (epoch !== generation || closed) return;
          clean();
          if (options.route) {
            window.history.replaceState(
              null,
              '',
              window.zhibanAdminShell.managementUrl(tenant, section, offering),
            );
          }
          root.dispatchEvent(
            new CustomEvent('management-context', { bubbles: true, detail: { section, offering } }),
          );
          const disposers = [];
          const retain = (fn) => {
            if (typeof fn === 'function') disposers.push(fn);
          };
          catalogCleanup = () => disposers.forEach((fn) => fn());
          if (readError) message.textContent = '';
          readError = false;
          const actions = el('div', undefined, 'management-actions');
          actions.append(
            button('刷新本页', load),
            link('学生目录', `/zhiban/directory?tenant=${tenant}`),
          );
          if (offering) actions.append(button('返回教学班列表', () => switchPage(null)));
          root.append(actions);
          const catalogActions = {
            tenant,
            request,
            mutate,
            blocked: () => busy || pending !== null || closed,
            create: (command) =>
              mutate(command, () => {
                q = command.code;
                state = 'ALL';
                reset();
              }),
          };
          if (!offering) {
            const nav = el('nav', undefined, 'management-actions');
            nav.setAttribute('aria-label', '教务分类');
            for (const [key, label] of [
              ['offerings', '教学班'],
              ['courses', '课程'],
              ['terms', '学期'],
              ['classes', '行政班'],
              ['history', '操作历史'],
            ]) {
              const b = button(label, () => {
                if (busy || pending || closed) return;
                section = key;
                switchPage(null);
              });
              if (kind === key) b.setAttribute('aria-current', 'page');
              nav.append(b);
            }
            root.append(nav);
            if (kind === 'offerings')
              retain(window.zhibanCatalog.createOffering(root, catalogActions));
            else if (kind !== 'history')
              retain(window.zhibanCatalog.createMaster(root, kind, catalogActions));
          }
          if (kind === 'history')
            root.append(
              el(
                'p',
                '仅显示本空间已完成的教务操作；操作人姓名使用当前目录名称，时间按 UTC 显示。',
                'muted',
              ),
            );
          if (data.offering) renderDetail(data.offering);
          filters(root, kind, load);
          const list = el('div', undefined, 'management-list');
          root.append(list);
          if (!data.rows.length)
            list.append(
              el('p', page ? '本页已无记录，可返回上一页或重新搜索。' : '暂无匹配记录。'),
            );
          for (const row of data.rows) {
            const card = el('article', undefined, 'management-card');
            list.append(card);
            if (kind === 'history') {
              const date = new Date(Number(row.occurred_at));
              card.append(
                el('h2', auditLabels[row.event_type] || '教务操作'),
                el(
                  'p',
                  Number.isFinite(date.getTime())
                    ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
                    : '时间不可用',
                ),
                el('p', '操作人：' + (row.actor_name || '未填写姓名')),
                el('small', row.actor_id),
              );
              if (row.member_id)
                card.append(
                  el('p', '涉及成员：' + (row.member_name || '未记录姓名')),
                  el('small', row.member_id),
                );
              if (row.object_name) card.append(el('p', '对象名称：' + row.object_name));
              if (row.object_code) card.append(el('p', '对象编号：' + row.object_code));
              if (row.target_id) card.append(el('small', '对象 ID：' + row.target_id));
              card.append(el('small', '记录 ID：' + row.id), el('p', '已完成', 'muted'));
            } else if (!offering && kind !== 'offerings') {
              retain(window.zhibanCatalog.master(card, kind, row, catalogActions));
            } else if (!offering) {
              card.append(
                el('h2', row.name),
                el('p', `${row.code} · ${row.course_name} · ${row.term_name}`),
                el(
                  'p',
                  `${row.status === 'OPEN' ? '开放' : '关闭'} · ${row.enrolled_count}/${row.capacity} 人`,
                ),
                el('small', row.id),
                button('管理学生名单', () => switchPage(row.id)),
                link('管理任教', `/zhiban/relationships?tenant=${tenant}&offering=${row.id}`),
              );
            } else {
              card.append(
                el('h3', row.name || '未填写姓名'),
                el('small', row.membership_id),
                el('p', row.status === 'ACTIVE' ? '在班' : '已退班'),
              );
              if (row.status === 'ACTIVE')
                card.append(
                  button('移出学生', () =>
                    mutate({ type: 'WITHDRAW', id: row.id, revision: row.revision }),
                  ),
                  button('转班', () => transfer(card, row)),
                );
              else
                card.append(
                  button('恢复入班', () =>
                    mutate({
                      type: 'ENROLL',
                      offeringId: offering,
                      membershipId: row.membership_id,
                      revision: row.revision,
                    }),
                  ),
                );
            }
          }
          window.zhibanAdminShell?.table(list, kind);
          pagination(root, data, load);
          disable(false);
        } catch (error) {
          if (epoch === generation && !closed) {
            disable(false);
            readError = true;
            message.textContent = `${error.message}。已完成的操作仍保留。`;
            if (section === 'history' && !offering) {
              root
                .querySelectorAll('.management-list,.management-pagination,.history-retry')
                .forEach((n) => n.remove());
              const retry = button('重试操作历史', load);
              retry.classList.add('history-retry');
              root.append(retry);
            } else if (!root.childElementCount) root.append(button('重试加载', load));
          }
        }
      }
      function renderDetail(o) {
        const card = el('section', undefined, 'management-card');
        card.append(
          el('h2', o.name),
          el('p', `${o.course_name} · ${o.term_name} · ${o.enrolled_count}/${o.capacity} 人`),
        );
        card.append(link('管理任教', `/zhiban/relationships?tenant=${tenant}&offering=${o.id}`));
        card.append(link('批量导入学生', `/zhiban/roster?tenant=${tenant}&offering=${o.id}`));
        const edit = el('details');
        edit.append(el('summary', '修改教学班'));
        const form = el('form');
        const values = {};
        for (const [key, label, type, value] of [
          ['name', '教学班名称', 'text', o.name],
          ['capacity', '容量', 'number', o.capacity],
        ]) {
          const l = el('label', label),
            input = el('input');
          input.type = type;
          input.value = value;
          input.required = true;
          if (type === 'number') {
            input.min = '1';
            input.max = '1000';
          } else input.maxLength = 120;
          l.append(input);
          form.append(l);
          values[key] = input;
        }
        const l = el('label', '教学班状态'),
          status = el('select');
        for (const [v, t] of [
          ['OPEN', '开放'],
          ['CLOSED', '关闭'],
        ]) {
          const option = el('option', t);
          option.value = v;
          status.append(option);
        }
        status.value = o.status;
        l.append(status);
        form.append(l);
        const save = el('button', '保存教学班');
        save.type = 'submit';
        form.append(save);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          void mutate({
            type: 'UPDATE_OFFERING',
            id: o.id,
            revision: o.revision,
            name: values.name.value.trim(),
            capacity: Number(values.capacity.value),
            status: status.value,
          });
        });
        edit.append(form);
        card.append(edit);
        const add = el('details');
        add.append(el('summary', '从学生目录添加一名学生'));
        const container = el('div');
        add.append(container);
        let loaded = false;
        add.addEventListener('toggle', () => {
          if (add.open && !loaded) {
            loaded = true;
            picker = window.zhibanDirectory.mount(tenant, container, { selection: true });
          }
        });
        add.append(
          button('添加已选学生', async () => {
            if (busy || pending || closed) return;
            const selected = picker?.selected() || [];
            if (selected.length !== 1) {
              message.textContent = '请选择一名学生；批量入班请使用批量导入入口。';
              return;
            }
            disable(true);
            try {
              const current = await request('enrollments', {
                offering: o.id,
                member: selected[0],
                state: 'ALL',
                limit: '10',
              });
              disable(false);
              const row = current.rows[0];
              if (row?.status === 'ACTIVE') {
                message.textContent = '该学生已在班。';
                return;
              }
              await mutate({
                type: 'ENROLL',
                offeringId: o.id,
                membershipId: selected[0],
                revision: row?.revision || null,
              });
            } catch (e) {
              disable(false);
              message.textContent = e.message;
            }
          }),
        );
        card.append(add);
        root.append(card);
      }
      async function transfer(card, row) {
        if (busy || pending || closed) return;
        root.querySelectorAll('.management-transfer').forEach((n) => n.remove());
        const panel = el('section', undefined, 'management-transfer');
        card.append(panel);
        let cursor = null,
          history = [null],
          index = 0,
          search = '',
          epoch = 0;
        async function targets() {
          const version = ++epoch;
          panel.replaceChildren(el('p', '正在读取可转入教学班…'));
          try {
            const data = await request('offerings', {
              source: offering,
              q: search,
              limit: '10',
              cursor,
            });
            if (version !== epoch || closed || !panel.isConnected) return;
            panel.replaceChildren(el('h4', '选择同课程、同学期的开放教学班'));
            const form = el('form'),
              l = el('label', '目标教学班搜索'),
              input = el('input');
            input.value = search;
            input.maxLength = 120;
            l.append(input);
            form.append(l);
            const b = el('button', '搜索目标');
            b.type = 'submit';
            form.append(b);
            form.addEventListener('submit', (e) => {
              e.preventDefault();
              if (busy || pending || closed) return;
              search = input.value.trim();
              history = [null];
              index = 0;
              cursor = null;
              void targets();
            });
            panel.append(form);
            for (const target of data.rows) {
              const b = button(
                `转入 ${target.name}（${target.enrolled_count}/${target.capacity}）`,
                async () => {
                  if (busy || pending || closed) return;
                  disable(true);
                  try {
                    const enrolled = await request('enrollments', {
                      offering: target.id,
                      member: row.membership_id,
                      state: 'ALL',
                      limit: '10',
                    });
                    disable(false);
                    await mutate({
                      type: 'TRANSFER',
                      id: row.id,
                      revision: row.revision,
                      targetOfferingId: target.id,
                      targetRevision: enrolled.rows[0]?.revision || null,
                    });
                  } catch (e) {
                    disable(false);
                    message.textContent = e.message;
                  }
                },
              );
              panel.append(b);
            }
            if (!data.rows.length) panel.append(el('p', '暂无可转入教学班。'));
            const prev = button('上一页目标', () => {
                if (!busy && index > 0) {
                  cursor = history[--index];
                  return targets();
                }
              }),
              next = button('下一页目标', () => {
                if (!busy && data.nextCursor) {
                  history[++index] = cursor = data.nextCursor;
                  return targets();
                }
              });
            prev.disabled = index === 0;
            next.disabled = !data.nextCursor;
            panel.append(
              prev,
              next,
              button('取消转班', () => {
                epoch++;
                panel.remove();
              }),
            );
          } catch (e) {
            if (panel.isConnected) {
              panel.replaceChildren(el('p', e.message), button('重试目标列表', targets));
            }
          }
        }
        await targets();
      }
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      function close() {
        if (closed) return;
        closed = true;
        generation++;
        controllers.forEach((c) => c.abort());
        pending = null;
        disabledControls.clear();
        clean();
        observer.disconnect();
        window.removeEventListener('pagehide', close);
        message.textContent = '会话已结束，请返回工作台重新登录。';
        channel?.close();
      }
      if (channel) channel.onmessage = close;
      window.addEventListener('pagehide', close, { once: true });
      const observer = new MutationObserver(() => {
        if (!root.isConnected) close();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      void load();
      return close;
    },
  };
})();
