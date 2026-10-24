/* Shared, paged, administrator-only directory. Selection is advisory and memory-only. */
(() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  window.zhibanDirectory = {
    mount(tenant, root, { selection = false } = {}) {
      let generation = 0,
        controller,
        externalDisabled = false,
        loading = false,
        index = 0,
        cursors = [null],
        next = null,
        query = { q: '', state: 'CURRENT', limit: '20' },
        destroyed = false;
      const selected = new Map();
      const form = el('form', undefined, 'directory-search'),
        qLabel = el('label', '姓名或完整成员 ID'),
        q = el('input');
      q.type = 'search';
      q.maxLength = 120;
      q.placeholder = '输入姓名或完整成员 ID';
      qLabel.append(q);
      const stateLabel = el('label', '目录范围'),
        state = el('select');
      for (const [value, text] of [
        ['CURRENT', '当前学生'],
        ['ALL', '包含历史学生'],
      ]) {
        const o = el('option', text);
        o.value = value;
        state.append(o);
      }
      stateLabel.append(state);
      const limitLabel = el('label', '每页人数'),
        limit = el('select');
      for (const n of [10, 20, 50]) {
        const o = el('option', String(n));
        o.value = String(n);
        o.selected = n === 20;
        limit.append(o);
      }
      limitLabel.append(limit);
      const search = el('button', '搜索学生', 'button');
      search.type = 'submit';
      form.append(qLabel, stateLabel, limitLabel, search);
      const notice = el('p', undefined, 'notice');
      notice.hidden = true;
      notice.setAttribute('role', 'alert');
      const selectedCount = el('p', undefined, 'directory-selected'),
        clear = el('button', '清空选择', 'button secondary');
      clear.type = 'button';
      clear.onclick = () => {
        if (externalDisabled || loading) return;
        selected.clear();
        paintSelection();
      };
      const summary = el('p', undefined, 'muted');
      summary.setAttribute('aria-live', 'polite');
      const rows = el('div', undefined, 'directory-table');
      const nav = el('nav', undefined, 'directory-pagination');
      nav.setAttribute('aria-label', '学生目录分页');
      const prev = el('button', '上一页', 'button secondary'),
        page = el('span'),
        following = el('button', '下一页', 'button secondary');
      prev.type = following.type = 'button';
      nav.append(prev, page, following);
      root.replaceChildren(form, notice);
      if (selection) root.append(selectedCount, clear);
      root.append(
        summary,
        rows,
        nav,
        el('p', '目录会实时变化；入班资格以导入预览和提交核验为准。', 'directory-note'),
      );
      function flags() {
        for (const n of [q, state, limit, search, clear]) n.disabled = externalDisabled || loading;
        prev.disabled = externalDisabled || loading || index === 0;
        following.disabled = externalDisabled || loading || !next;
        for (const c of rows.querySelectorAll('input'))
          c.disabled = externalDisabled || loading || c.dataset.allowed !== 'yes';
        root.setAttribute('aria-busy', String(loading));
      }
      function paintSelection() {
        selectedCount.textContent = '已选 ' + selected.size + ' / 50 名学生（跨页保留）';
        for (const c of rows.querySelectorAll('input')) c.checked = selected.has(c.value);
      }
      function render(students) {
        rows.replaceChildren();
        if (!students.length) {
          rows.append(
            el(
              'p',
              next ? '本页暂无符合条件的学生，可继续下一页。' : '未找到符合条件的学生。',
              'directory-empty',
            ),
          );
          return;
        }
        const table = el('table'),
          head = el('tr');
        for (const title of [
          ...(selection ? ['选择'] : []),
          '姓名',
          '成员 ID',
          '成员状态',
          '学生授权',
        ]) {
          const th = el('th', title);
          th.scope = 'col';
          head.append(th);
        }
        const thead = el('thead');
        thead.append(head);
        const tbody = el('tbody');
        for (const s of students) {
          const tr = el('tr');
          if (selection) {
            const td = el('td'),
              box = el('input');
            box.type = 'checkbox';
            box.value = s.membershipId;
            box.setAttribute(
              'aria-label',
              '选择 ' + (s.name || '未设置姓名') + ' · ' + s.membershipId,
            );
            const allowed = s.membershipStatus === 'ACTIVE' && s.studentGrantActive;
            box.dataset.allowed = allowed ? 'yes' : 'no';
            if (!allowed) selected.delete(s.membershipId);
            box.checked = selected.has(s.membershipId);
            box.onchange = () => {
              if (externalDisabled || loading) return;
              if (box.checked) {
                if (selected.size >= 50) {
                  box.checked = false;
                  notice.hidden = false;
                  notice.textContent = '最多选择 50 名学生，请先减少已选人数。';
                  return;
                }
                selected.set(s.membershipId, s.name);
              } else selected.delete(s.membershipId);
              paintSelection();
            };
            td.append(box);
            tr.append(td);
          }
          const states = {
            ACTIVE: '已启用',
            PENDING: '待启用',
            DISABLED: '已停用',
            LEFT: '已离开',
          };
          tr.append(
            el('td', s.name || '未设置姓名'),
            el('td', s.membershipId, 'directory-id'),
            el('td', states[s.membershipStatus] || s.membershipStatus),
            el('td', s.studentGrantActive ? '当前有效' : '当前无有效授权'),
          );
          tbody.append(tr);
        }
        table.append(thead, tbody);
        rows.append(table);
        paintSelection();
      }
      async function load(cursor, target, history) {
        if (destroyed) return;
        const current = ++generation;
        controller?.abort();
        controller = new AbortController();
        const requestController = controller;
        const timer = setTimeout(() => requestController.abort(), 10000);
        loading = true;
        notice.hidden = true;
        rows.replaceChildren();
        summary.textContent = '正在读取学生目录…';
        flags();
        try {
          const params = new URLSearchParams(query);
          if (cursor) params.set('cursor', cursor);
          const r = await fetch(
            '/api/zhiban/directory/' + encodeURIComponent(tenant) + '?' + params,
            {
              headers: { 'x-zhiban-request': 'identity-v1' },
              credentials: 'same-origin',
              cache: 'no-store',
              signal: requestController.signal,
            },
          );
          if (current !== generation || destroyed) return;
          if (!r.ok) {
            if (r.status === 401 || r.status === 403) selected.clear();
            throw Error(
              r.status === 401
                ? '登录已失效，请返回工作台。'
                : r.status === 403
                  ? '当前身份没有学生目录权限。'
                  : r.status === 400
                    ? '查询条件或分页位置无效，请重新搜索。'
                    : '学生目录暂不可用，请重新搜索。',
            );
          }
          const data = await r.json();
          if (current !== generation || destroyed || !root.isConnected) return;
          index = target;
          cursors = history;
          next = data.nextCursor;
          render(data.students);
          summary.textContent = '本页 ' + data.students.length + ' 名学生';
          page.textContent = '第 ' + (index + 1) + ' 页';
        } catch (e) {
          if (current !== generation || destroyed) return;
          rows.replaceChildren();
          next = null;
          notice.hidden = false;
          notice.textContent = e instanceof Error ? e.message : '学生目录读取失败。';
          summary.textContent = '未显示学生数据';
          paintSelection();
        } finally {
          clearTimeout(timer);
          if (current === generation && !destroyed) {
            loading = false;
            flags();
          }
        }
      }
      form.onsubmit = (e) => {
        e.preventDefault();
        if (externalDisabled || loading) return;
        query = { q: q.value.trim(), state: state.value, limit: limit.value };
        index = 0;
        cursors = [null];
        next = null;
        void load(null, 0, [null]);
      };
      prev.onclick = () => {
        if (!externalDisabled && !loading && index > 0)
          void load(cursors[index - 1], index - 1, cursors.slice(0, index));
      };
      following.onclick = () => {
        if (!externalDisabled && !loading && next)
          void load(next, index + 1, [...cursors.slice(0, index + 1), next]);
      };
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      function destroy() {
        destroyed = true;
        generation++;
        controller?.abort();
        selected.clear();
        root.replaceChildren();
        channel?.close();
        window.removeEventListener('pagehide', destroy);
      }
      if (channel)
        channel.onmessage = () => {
          destroy();
          const p = el('p', '登录状态已变化，请返回工作台。', 'notice');
          p.setAttribute('role', 'alert');
          root.append(p);
        };
      window.addEventListener('pagehide', destroy);
      paintSelection();
      void load(null, 0, [null]);
      return {
        selected: () => [...selected.keys()],
        setDisabled(value) {
          externalDisabled = value;
          flags();
        },
        destroy,
      };
    },
  };
})();
