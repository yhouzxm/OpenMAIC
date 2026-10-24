(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('imports'),
    params = new URLSearchParams(location.search),
    tenant = params.get('tenant'),
    base = '/api/zhiban/imports/' + encodeURIComponent(tenant);
  const kinds = {
    TERMS: '学期',
    COURSES: '课程草稿',
    CLASSES: '行政班',
    OFFERINGS: '教学班',
    DIRECTORY: '正式档案',
    CLASS_MEMBERS: '行政班成员',
    ENROLLMENTS: '教学班学生',
  };
  const states = {
    READY: '可导入',
    SKIP: '相同记录 · 跳过',
    BLOCKED: '需处理',
    IMPORTED: '已导入',
    SKIPPED: '已跳过',
    FAILED: '未成功',
  };
  const codes = {
    INVALID_INPUT: '列、字段或格式不正确',
    DUPLICATE: '本文件内重复',
    FORBIDDEN: '当前授权已失效',
    NOT_FOUND: '本空间对象不存在或不可用',
    CONFLICT: '现有内容不同或预览后已变更',
    INVALID_STATE: '已退班／停用关系请单独处理，或课程尚未发布',
    INACTIVE_MEMBER: '不是当前有效的成员／学生',
    CAPACITY_FULL: '教学班容量不足',
    UNAVAILABLE: '暂不可用，请先读取原批次结果',
  };
  let csrf = null,
    columns = {},
    current = null,
    busy = false,
    generation = 0,
    after = null;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (label, fn) => {
    const b = el('button', label);
    b.type = 'button';
    b.className = 'button';
    b.onclick = fn;
    return b;
  };
  const notice = el('p');
  notice.setAttribute('role', 'status');
  async function api(path, payload) {
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (payload) {
      if (!csrf) {
        const r = await fetch('/api/zhiban/identity/csrf', {
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!r.ok) throw Error('登录已失效');
        csrf = (await r.json()).csrfToken;
      }
      headers['content-type'] = 'application/json';
      headers['x-zhiban-csrf'] = csrf;
    }
    const r = await fetch(path, {
        method: payload ? 'POST' : 'GET',
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(20000),
      }),
      j = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 401 ? '请重新登录' : codes[j.error?.code] || '请求未完成，请读取原批次结果',
      );
    return j;
  }
  function save(name, text) {
    const u = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' })),
      a = el('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[\s]*[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const heading = el('h1', '教务批量导入'),
    help = el(
      'p',
      '先下载对应模板，填写本空间已有对象 ID，再预览并确认。每批最多 50 行、64 KiB；逐行提交，首个失败后停止，已成功行保留。',
    );
  const kindLabel = el('label', '导入类别'),
    kind = el('select');
  kind.setAttribute('aria-label', '导入类别');
  kindLabel.append(kind);
  for (const [v, t] of Object.entries(kinds)) {
    const o = el('option', t);
    o.value = v;
    kind.append(o);
  }
  const route = location.pathname.split('/').at(-1);
  kind.value =
    { classes: 'CLASSES', students: 'DIRECTORY', registrations: 'ENROLLMENTS' }[route] || 'TERMS';
  const hint = el('p'),
    fileLabel = el('label', '上传 UTF-8 CSV'),
    file = el('input');
  file.type = 'file';
  file.accept = '.csv,text/csv';
  fileLabel.append(file);
  const csvLabel = el('label', 'CSV 内容'),
    csv = el('textarea');
  csv.setAttribute('aria-label', 'CSV 内容');
  csv.rows = 7;
  csvLabel.append(csv);
  const batchArea = el('section'),
    history = el('section');
  batchArea.className = history.className = 'card roster-input';
  function invalidate() {
    generation++;
    current = null;
    batchArea.replaceChildren();
  }
  const template = button('下载本类 CSV 模板', () =>
    save('zhiban-' + kind.value + '.csv', columns[kind.value].join(',') + '\r\n'),
  );
  function updateKind() {
    invalidate();
    csv.value = '';
    file.value = '';
    csv.placeholder = (columns[kind.value] || []).join(',');
    hint.textContent =
      kind.value === 'DIRECTORY'
        ? '正式姓名、学号与工号按文件更新；留空的学号／工号会清空。不会修改本人联系方式或登录标识。'
        : kind.value === 'COURSES'
          ? '课程只创建草稿，不自动发布或指定负责人。'
          : kind.value === 'ENROLLMENTS' || kind.value === 'CLASS_MEMBERS'
            ? '仅加入已有有效学生；曾退班、停用或需要转班的关系必须单独处理。'
            : '已存在且内容相同的记录跳过；内容不同时拒绝覆盖。';
  }
  kind.onchange = updateKind;
  csv.oninput = invalidate;
  file.onchange = async () => {
    if (busy) return;
    invalidate();
    const version = generation,
      f = file.files?.[0];
    if (!f) return;
    try {
      if (f.size > 65536) throw Error();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
      if (version !== generation || busy) return;
      csv.value = text;
    } catch {
      notice.textContent = '请选择不超过 64 KiB 的 UTF-8 CSV。';
    }
  };
  function controls(on) {
    busy = on;
    root.setAttribute('aria-busy', String(on));
    for (const n of [kind, file, csv, template, preview]) n.disabled = on;
  }
  function contextUrl(id) {
    const url = new URL(location.href);
    url.searchParams.set('batch', id);
    return url;
  }
  async function read(id) {
    if (busy) return;
    controls(true);
    try {
      const b = await api(base + '/' + id);
      show(b);
      notice.textContent = '已读取数据库中的原批次结果。';
    } catch (e) {
      notice.textContent = e.message;
    } finally {
      controls(false);
    }
  }
  function show(b) {
    current = b;
    window.history.replaceState(null, '', contextUrl(b.id));
    batchArea.replaceChildren(
      el(
        'h2',
        kinds[b.kind] +
          ' · ' +
          (b.complete
            ? '导入完成'
            : b.status === 'EXPIRED'
              ? '批次已过期'
              : b.status === 'BLOCKED'
                ? '需要处理'
                : '预览与结果'),
      ),
      el('p', '批次编号：' + b.id),
      el('p', '确认有效至 ' + new Date(b.expiresAt).toLocaleString() + '；到期后仍可读取结果。'),
    );
    const wrap = el('div'),
      table = el('table'),
      head = el('thead'),
      tr = el('tr');
    wrap.className = 'roster-table';
    for (const t of ['行号', '对象', '内容与目标', '结果', '说明']) tr.append(el('th', t));
    head.append(tr);
    table.append(head);
    const body = el('tbody');
    for (const r of b.rows) {
      const tr = el('tr');
      tr.append(el('td', String(r.line)), el('td', r.label || '—'));
      const content = el('td'),
        details = el('details');
      details.append(el('summary', '查看本行内容与目标'));
      const names = {
        code: '编号',
        name: '名称',
        description: '说明',
        startsOn: '开始日期',
        endsOn: '结束日期',
        courseId: '课程 ID',
        termId: '学期 ID',
        classId: '行政班 ID',
        membershipId: '成员 ID',
        offeringId: '教学班 ID',
        capacity: '容量',
        formalName: '正式姓名',
        studentNo: '学号',
        employeeNo: '工号',
      };
      for (const [key, value] of Object.entries(r.command || {}))
        if (names[key])
          details.append(
            el(
              'p',
              names[key] + '：' + (value === null || value === '' ? '（空）' : String(value)),
            ),
          );
      content.append(details);
      tr.append(content, el('td', states[r.state]), el('td', codes[r.code] || '—'));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    batchArea.append(wrap);
    const commit = button('确认导入／继续原批次', async () => {
      if (busy || !current?.canCommit) return;
      controls(true);
      commit.disabled = true;
      const id = current.id;
      try {
        show(await api(base + '/' + id, { type: 'COMMIT' }));
        notice.textContent = '结果已从数据库返回。';
        await list(false);
      } catch (e) {
        notice.textContent =
          '提交结果可能未知：' + e.message + '。先点击“读取原批次结果”，不要新建批次重试。';
        current.canCommit = false;
      } finally {
        controls(false);
      }
    });
    commit.disabled = !b.canCommit;
    batchArea.append(
      commit,
      button('读取原批次结果', () => read(b.id)),
      button('下载本批次结果 CSV', () =>
        save(
          'zhiban-import-' + b.id + '.csv',
          [
            ['line', 'label', 'state', 'code'],
            ...b.rows.map((r) => [r.line, r.label, r.state, r.code || '']),
          ]
            .map((r) => r.map(cell).join(','))
            .join('\r\n'),
        ),
      ),
    );
  }
  const preview = button('预览并保存批次', async () => {
    if (busy) return;
    controls(true);
    current = null;
    batchArea.replaceChildren();
    try {
      const b = await api(base, { type: 'PREVIEW', kind: kind.value, csv: csv.value });
      show(b);
      notice.textContent = '已保存批次预览；尚未写入教务业务数据。';
      await list(false);
    } catch (e) {
      notice.textContent = e.message;
    } finally {
      controls(false);
    }
  });
  async function list(next = false) {
    const page = await api(base + (next && after ? '?after=' + after : ''));
    columns = page.kinds;
    after = page.next;
    history.replaceChildren(
      el('h2', '我的批次结果'),
      el(
        'p',
        '仅显示当前管理员本人创建的批次。结果保存在当前数据库；保留同一数据库可持续回看，环境重建后不保留。',
      ),
    );
    for (const b of page.rows) {
      const row = el('p');
      row.append(
        button(
          kinds[b.kind] +
            ' · ' +
            new Date(Number(b.createdAt)).toLocaleString() +
            ' · 完成 ' +
            b.completed +
            '/' +
            b.total +
            ' · 需处理 ' +
            b.blocked,
          () => read(b.id),
        ),
      );
      history.append(row);
    }
    if (!page.rows.length) history.append(el('p', '暂无批次。'));
    history.append(
      button('刷新首批', () => {
        if (!busy) list(false).catch((e) => (notice.textContent = e.message));
      }),
    );
    if (after)
      history.append(
        button('下一批', () => {
          if (!busy) list(true).catch((e) => (notice.textContent = e.message));
        }),
      );
  }
  const inputs = el('section');
  inputs.className = 'card roster-input';
  inputs.append(kindLabel, hint, template, fileLabel, csvLabel, preview);
  root.replaceChildren(heading, help, notice, inputs, batchArea, history);
  const links = el('p');
  for (const [text, path] of [
    ['查看教务对象 ID', '/zhiban/management?tenant=' + tenant],
    ['查看成员 ID', '/zhiban/admin/accounts?tenant=' + tenant],
    ['普通账户开通（另行审批）', '/zhiban/admin/onboarding?tenant=' + tenant],
  ]) {
    const a = el('a', text);
    a.href = path;
    links.append(a, document.createTextNode('　'));
  }
  help.after(links);
  controls(true);
  try {
    await list();
    updateKind();
    controls(false);
    if (params.get('batch')) await read(params.get('batch'));
  } catch (e) {
    notice.textContent = e.message;
  } finally {
    root.setAttribute('aria-busy', 'false');
  }
})();
