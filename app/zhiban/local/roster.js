/* CSV contains existing tenant Membership IDs only; preview token is kept in memory. */
(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('roster'),
    params = new URLSearchParams(location.search),
    tenant = params.get('tenant'),
    offering = params.get('offering');
  const base =
    '/api/zhiban/roster/' +
    encodeURIComponent(tenant) +
    '/offerings/' +
    encodeURIComponent(offering);
  let generation = 0,
    controller,
    plan = null,
    busy = false,
    csrf = null,
    picker = null;
  const codes = {
    INVALID_ID: '成员 ID 格式无效',
    DUPLICATE: '文件内重复',
    REJOIN_MANUALLY: '曾退班，请在工作台单独恢复',
    INACTIVE_MEMBER: '当前不是可入班的有效学生',
    FORBIDDEN: '成员不可用或当前权限已失效',
    INVALID_STATE: '课程或教学班不允许加入',
    CAPACITY_FULL: '教学班容量不足',
    CONFLICT: '预览已过期、数据已变更或批次正在执行',
    UNAVAILABLE: '暂不可用，请核验原批次结果',
    INVALID_INPUT: '请检查 CSV 列名、编码、行数与 ID 格式',
  };
  const states = {
    READY: '可新增',
    SKIP: '已在班 · 跳过',
    BLOCKED: '需处理',
    IMPORTED: '已导入',
    SKIPPED: '已跳过',
    FAILED: '未成功',
    UNKNOWN: '结果待核验',
    NOT_ATTEMPTED: '尚未执行',
  };
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function button(text, fn) {
    const b = el('button', text, 'button');
    b.type = 'button';
    b.onclick = fn;
    return b;
  }
  function alert(text) {
    let n = root.querySelector('[role="alert"]');
    if (!n) {
      n = el('p', undefined, 'notice');
      n.setAttribute('role', 'alert');
      root.prepend(n);
    }
    n.textContent = text;
  }
  async function api(path, payload) {
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (payload !== undefined) {
      if (!csrf) {
        const r = await fetch('/api/zhiban/identity/csrf', {
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!r.ok) throw Error('登录已失效，请返回工作台。');
        csrf = (await r.json()).csrfToken;
      }
      headers['Content-Type'] = 'application/json';
      headers['x-zhiban-csrf'] = csrf;
    }
    const r = await fetch(path, {
      method: payload === undefined ? 'GET' : 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const value = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 401
          ? '登录已失效，请返回工作台。'
          : codes[value.error?.code] || '请求未完成，请返回工作台检查当前名单。',
      );
    return value;
  }
  function rowsTable(rows) {
    const wrap = el('div', undefined, 'roster-table'),
      table = el('table'),
      head = el('tr');
    for (const title of ['行号', '成员 ID', '姓名', '结果', '说明']) {
      const th = el('th', title);
      th.scope = 'col';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      for (const value of [
        r.line,
        r.membershipId,
        r.name || '—',
        states[r.status],
        codes[r.code] || '—',
      ])
        tr.append(el('td', String(value)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }
  async function load() {
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    const timer = setTimeout(() => currentController.abort(), 20000);
    root.replaceChildren(el('p', '正在核验管理员权限…', 'muted'));
    root.setAttribute('aria-busy', 'true');
    plan = null;
    picker?.destroy();
    csrf = null;
    try {
      const info = await api(base);
      if (version !== generation) return;
      root.replaceChildren();
      const infoText = (data) =>
        '当前在班 ' +
        data.enrolled +
        ' / ' +
        data.capacity +
        ' 人。导入已加入本空间的学生，最多 50 行；不创建账户、修改姓名或授予角色。';
      const infoSummary = el('p', infoText(info), 'muted');
      root.append(
        el('p', '教务管理', 'eyebrow'),
        el('h1', info.name),
        el('p', '批量导入学生名册', 'subtitle'),
        infoSummary,
      );
      const link = el('a', '下载 CSV 模板');
      link.href = '/zhiban/roster-template.csv';
      link.download = 'zhiban-roster.csv';
      root.append(link);
      const section = el('section', undefined, 'card roster-input');
      const directory = el('details'),
        summary = el('summary', '从已有学生生成 CSV');
      directory.append(summary);
      const pickerRoot = el('div');
      directory.append(pickerRoot);
      section.append(directory);
      const fileLabel = el('label', '上传 UTF-8 CSV'),
        file = el('input');
      file.type = 'file';
      file.accept = '.csv,text/csv';
      fileLabel.append(file);
      section.append(fileLabel);
      const csvLabel = el('label', 'CSV 名册'),
        csv = el('textarea');
      csv.rows = 8;
      csv.placeholder = 'membershipId\n已有学生的成员 ID';
      csvLabel.append(csv);
      section.append(csvLabel);
      const previewArea = el('section'),
        resultsArea = el('section');
      previewArea.setAttribute('aria-live', 'polite');
      resultsArea.setAttribute('aria-live', 'polite');
      function invalidate() {
        plan = null;
        previewArea.replaceChildren();
        resultsArea.replaceChildren();
      }
      const generate = button('填入所选学生', () => {
        if (busy) return;
        csv.value = 'membershipId\n' + picker.selected().join('\n') + '\n';
        invalidate();
      });
      directory.append(generate);
      csv.oninput = invalidate;
      file.onchange = async () => {
        if (busy) return;
        invalidate();
        const f = file.files?.[0];
        if (!f) return;
        const before = generation;
        try {
          if (f.size > 8192) throw Error('文件不能超过 8 KiB。');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
          if (before !== generation || busy) return;
          invalidate();
          csv.value = text;
        } catch {
          if (before === generation) alert('请使用不超过 8 KiB 的 UTF-8 CSV。');
        }
      };
      function controls(value) {
        busy = value;
        picker?.setDisabled(value);
        [file, csv, generate, preview].forEach((c) => (c.disabled = value));
        root.setAttribute('aria-busy', String(value));
      }
      async function commit(confirm) {
        if (busy || !plan) return;
        controls(true);
        confirm.disabled = true;
        const attemptToken = plan.token;
        const commitVersion = generation;
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const result = await api(base, { type: 'COMMIT', token: attemptToken });
          if (commitVersion !== generation) return;
          resultsArea.replaceChildren(
            el('h2', result.complete ? '导入完成' : '导入尚未全部完成'),
            el('p', '逐行提交；已成功行保留。中途失败后不执行后续行。'),
            rowsTable(
              result.results.map((row) => ({
                ...row,
                name: plan.rows.find((p) => p.line === row.line)?.name,
              })),
            ),
          );
          confirm.textContent = result.complete ? '原批次已完成' : '用原批次核验并继续';
          confirm.disabled = result.complete;
          plan.canCommit = !result.complete;
          // The durable row results are already known. A failed count refresh must not turn them into UNKNOWN.
          try {
            const current = await api(base);
            if (commitVersion === generation) infoSummary.textContent = infoText(current);
          } catch {
            if (commitVersion === generation)
              infoSummary.textContent = '本批次结果已列出；当前人数暂不可读取，请返回工作台刷新。';
          }
        } catch (e) {
          if (commitVersion !== generation) return;
          alert(
            '结果暂未确认。请保留原批次并核验；不要另建批次重复导入。' +
              (e instanceof Error ? e.message : ''),
          );
          confirm.textContent = '用原批次核验并继续';
          confirm.disabled = false;
          /* A new request controller permits verification after a client timeout. */ controller =
            new AbortController();
        } finally {
          clearTimeout(timer);
          if (commitVersion === generation) controls(false);
        }
      }
      const preview = button('预览并校验', async () => {
        if (busy) return;
        invalidate();
        controls(true);
        const attemptVersion = generation;
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const result = await api(base, { type: 'PREVIEW', csv: csv.value });
          if (attemptVersion !== generation) return;
          plan = result;
          previewArea.replaceChildren(
            el('h2', '导入预览'),
            el('p', '批次编号：' + result.batchId, 'muted'),
            el(
              'p',
              '可新增 ' +
                result.ready +
                ' 行 · 已在班 ' +
                result.skipped +
                ' 行 · 需处理 ' +
                result.blocked +
                ' 行',
            ),
            el(
              'p',
              '确认后逐行加入 ' +
                result.offering.name +
                '。预览有效期至 ' +
                new Date(result.expiresAt).toLocaleTimeString('zh-CN') +
                '；提交时重新检查权限、名单与容量。',
            ),
            rowsTable(result.rows),
          );
          if (!result.capacityEnough)
            previewArea.append(
              el('p', '剩余容量不足，请调整名单或教学班容量后重新预览。', 'notice'),
            );
          const confirm = button(
            '确认导入 ' + result.ready + ' 名学生',
            () => void commit(confirm),
          );
          confirm.disabled = !result.canCommit;
          previewArea.append(confirm);
          if (!result.canCommit)
            previewArea.append(
              el(
                'p',
                result.blocked
                  ? '请先处理全部错误行再重新预览。'
                  : '没有可提交的新学生，或剩余容量不足。',
                'muted',
              ),
            );
        } catch (e) {
          if (attemptVersion === generation) {
            alert(e instanceof Error ? e.message : '预览失败，请重试。');
            controller = new AbortController();
          }
        } finally {
          clearTimeout(timer);
          if (attemptVersion === generation) controls(false);
        }
      });
      section.append(
        el(
          'p',
          '仅一列 membershipId。角色、密码、其他列、重复 ID 和无效 ID 会被拒绝；曾退班的学生请在工作台单独恢复。',
          'roster-note',
        ),
        preview,
      );
      root.append(section, previewArea, resultsArea);
      picker = window.zhibanDirectory.mount(tenant, pickerRoot, { selection: true });
    } catch (e) {
      if (version === generation) {
        root.replaceChildren();
        alert(e instanceof Error ? e.message : '无法读取导入入口。');
      }
    } finally {
      clearTimeout(timer);
      if (version === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      generation++;
      picker?.destroy();
      controller?.abort();
      plan = null;
      root.replaceChildren();
      alert('登录状态已变化，请返回工作台。');
    };
  window.addEventListener('pagehide', () => {
    generation++;
    controller?.abort();
    plan = null;
    root.replaceChildren();
    channel?.close();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !tenant ||
    !offering ||
    !uuid.test(tenant) ||
    !uuid.test(offering) ||
    [...params.keys()].sort().join(',') !== 'offering,tenant'
  ) {
    alert('教学班地址无效，请从工作台进入。');
    root.setAttribute('aria-busy', 'false');
  } else void load();
})();
