(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const p = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = p.get('tenant'),
    offering = p.get('offering');
  const mode =
      p.get('role') === 'teacher' ? 'TEACHER' : p.get('mode') === 'ADMIN' ? 'ADMIN' : 'STUDENT',
    root = document.getElementById('attainment');
  if (!/^[0-9a-f-]{36}$/.test(tenant ?? '')) {
    root.textContent = '请从工作台进入。';
    return;
  }
  const base = '/api/zhiban/attainment/' + tenant;
  let currentOffering = offering,
    member = null,
    rule = null,
    total = null,
    creditRules = [],
    dirty = false;
  const el = (tag, text) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    },
    text = (p, s) => p.append(el('p', s));
  let abort = new AbortController();
  window.addEventListener('pagehide', () => abort.abort(), { once: true });
  async function req(path, c = null, key = null) {
    const h = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    if (c) {
      const r = await fetch('/api/zhiban/identity/csrf', { headers: h, signal });
      if (!r.ok) throw Error('登录已失效');
      h['x-zhiban-csrf'] = (await r.json()).csrfToken;
      h['content-type'] = 'application/json';
      h['x-zhiban-command'] = key;
    }
    const r = await fetch(path, {
        headers: h,
        signal,
        cache: 'no-store',
        method: c ? 'POST' : 'GET',
        ...(c ? { body: JSON.stringify(c) } : {}),
      }),
      v = await r.json();
    if (!r.ok)
      throw Error(
        r.status === 409
          ? '依据或版本已变化，或已有有效记录；请刷新核对。'
          : r.status === 403
            ? '当前账户无此权限。'
            : '暂时无法处理，请保留输入后重试。',
      );
    return v;
  }
  const get = (args = {}) =>
    req(
      base +
        '?' +
        new URLSearchParams({
          mode,
          ...(mode === 'TEACHER' ? { offering: currentOffering } : {}),
          ...args,
        }),
    );
  function button(parent, label, fn) {
    const b = el('button', label);
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        alert.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    parent.append(b);
    return b;
  }
  function control(f, label, tag = 'input', value = '') {
    const l = el('label', label),
      n = el(tag);
    n.setAttribute('aria-label', label);
    n.value = value;
    n.required = true;
    l.append(n);
    f.append(l);
    return n;
  }
  function select(f, label, rows, value = null) {
    const n = control(f, label, 'select');
    for (const [id, name] of rows) {
      const op = el('option', name);
      op.value = id;
      n.append(op);
    }
    if (value !== null) n.value = value;
    return n;
  }
  function form(parent, label, fields, make, done = refresh) {
    const f = el('form');
    f.append(el('h3', label));
    const inputs = fields(f);
    let pending = null;
    f.oninput = () => {
      dirty = true;
      window.zhibanCoursePage?.setDirty('attainment', true, f);
      pending = null;
    };
    const b = el('button', label);
    b.type = 'submit';
    f.append(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      b.disabled = true;
      try {
        if (!pending) pending = { c: make(inputs), key: crypto.randomUUID() };
        await req(base, pending.c, pending.key);
        dirty = false;
        window.zhibanCoursePage?.setDirty('attainment', false);
        await done();
      } catch (e) {
        alert.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    parent.append(f);
    return f;
  }
  const alert = el('p');
  alert.setAttribute('role', 'alert');
  root.append(el('h1', mode === 'ADMIN' ? '校内证书与跨班学分管理' : '校内学习成果'), alert);
  text(
    root,
    '校内学习成果记录，仅供校内教学使用，不代表职业资格。记录固定总评依据；成绩更正后会标记需复核，撤销保留历史。',
  );
  const work = el('div'),
    ledger = el('div');
  root.append(work, ledger);
  async function roster(parent, cursor) {
    const api = `/api/zhiban/learner/${tenant}/offerings/${currentOffering}`;
    const r = await req(
      api +
        '?' +
        new URLSearchParams({ mode: 'TEACHER', view: 'ROSTER', ...(cursor ? { cursor } : {}) }),
    );
    for (const row of r.rows) {
      button(parent, row.display_name ?? row.student_name ?? '学生', async () => {
        member = row.membership_id;
        await preview();
      });
    }
    if (r.next) button(parent, '更多学生', () => roster(parent, r.next));
  }
  async function adminRoster(parent, cursor, q = '') {
    const r = await req(
      `/api/zhiban/management/${tenant}/enrollments?` +
        new URLSearchParams({
          offering: currentOffering,
          state: 'ACTIVE',
          limit: '20',
          q,
          ...(cursor ? { cursor } : {}),
        }),
    );
    for (const row of r.rows ?? r.items ?? []) {
      button(
        parent,
        row.name ?? row.displayName ?? row.display_name ?? row.studentName ?? '学生',
        async () => {
          member = row.membershipId ?? row.membership_id;
          await preview();
        },
      );
    }
    if (r.next ?? r.nextCursor)
      button(parent, '更多学生', () => adminRoster(parent, r.next ?? r.nextCursor, q));
  }
  async function preview() {
    const r = await get({ view: 'TOTAL', offering: currentOffering, member });
    total = r.evidence;
    rule = r.certificateRule;
    const box = document.getElementById('total-preview') ?? el('section');
    box.id = 'total-preview';
    box.replaceChildren(el('h3', total.studentName + ' · 总评依据'));
    work.append(box);
    text(
      box,
      total.latest
        ? `已发布总评 ${(total.latest.score_points / 100).toFixed(2)}，${total.current ? '依据有效' : '依据已变化／未齐，不可签发'}`
        : '尚无已发布总评',
    );
    if (total.current) {
      if (rule?.enabled)
        button(box, '签发校内证书', async () => {
          await req(
            base,
            {
              type: 'ISSUE_CERT',
              offeringId: currentOffering,
              memberId: member,
              ruleRevision: rule.revision,
              totalId: total.latest.id,
              sourceDigest: total.sourceDigest,
            },
            crypto.randomUUID(),
          );
          await records();
        });
      if (mode === 'ADMIN')
        for (const r of creditRules.filter(
          (x) => x.enabled && x.source_course === total.offering.course_id,
        ))
          form(
            box,
            '认定学分：' + r.title,
            (f) => control(f, '认定说明', 'textarea'),
            (n) => ({
              type: 'AWARD_CREDIT',
              ruleId: r.id,
              ruleRevision: r.revision,
              offeringId: currentOffering,
              memberId: member,
              totalId: total.latest.id,
              sourceDigest: total.sourceDigest,
              reason: n.value,
            }),
            records,
          );
    }
  }
  async function renderRecord(parent, r) {
    const card = el('section');
    card.className = 'certificate-record';
    card.append(el('h2', r.snapshot.rule.title));
    text(
      card,
      `${r.kind === 'CERTIFICATE' ? '校内证书' : '课程学分'} · ${r.state === 'ACTIVE' ? (r.source.current ? '有效记录' : '未撤销，依据需复核') : '已撤销'} · ${r.source.current ? '总评依据仍有效' : '总评依据已变化，需复核'}`,
    );
    const dl = el('dl');
    for (const [k, v] of [
      ['姓名', r.snapshot.studentName],
      ['课程', r.snapshot.courseName],
      ['教学班', r.snapshot.offeringName],
      ['总评', (r.snapshot.total.score_points / 100).toFixed(2)],
      ...(r.kind === 'CREDIT'
        ? [
            ['认定学分', (r.credits_tenths / 10).toFixed(1)],
            ['目标课程', r.snapshot.rule.target_course],
          ]
        : []),
      ['编号', r.id],
      ['固定总评', r.total_id],
      ['签发时间', new Date(Number(r.issued_at)).toLocaleString('zh-CN')],
    ]) {
      dl.append(el('dt', k), el('dd', v));
    }
    card.append(dl);
    for (const e of r.history ?? [])
      if (e.reason) text(card, `${e.action}：${e.reason}（${e.actor_name}）`);
    text(card, '仅限校内；如需确认当前有效性，请本人登录查询该编号。');
    button(card, '打印／保存 PDF', () => {
      document.querySelectorAll('.print-record').forEach((x) => x.classList.remove('print-record'));
      card.classList.add('print-record');
      window.print();
    });
    button(card, '下载成果记录', () => {
      const blob = new Blob(
          [JSON.stringify({ scope: 'SCHOOL_ONLY', checkedAt: Date.now(), ...r }, null, 2)],
          { type: 'application/json' },
        ),
        a = el('a', '下载');
      a.href = URL.createObjectURL(blob);
      a.download = '校内成果-' + r.id + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    if (
      mode !== 'STUDENT' &&
      r.state === 'ACTIVE' &&
      (mode === 'ADMIN' || r.kind === 'CERTIFICATE')
    )
      form(
        card,
        '撤销记录',
        (f) => control(f, '撤销原因', 'textarea'),
        (n) => ({
          type: r.kind === 'CERTIFICATE' ? 'REVOKE_CERT' : 'REVOKE_CREDIT',
          id: r.id,
          revision: r.revision,
          reason: n.value,
        }),
        records,
      );
    parent.append(card);
  }
  async function records(cursor = null) {
    if (!cursor) ledger.replaceChildren(el('h2', '成果记录'));
    const r = await get({ view: 'RECORDS', ...(cursor ? { cursor } : {}) });
    for (const row of r.rows) await renderRecord(ledger, row);
    if (!r.rows.length && !cursor) text(ledger, '暂无记录。');
    if (r.next) button(ledger, '更多记录', () => records(r.next));
  }
  async function picker(parent, label, view, chosen) {
    const f = el('form'),
      q = control(f, label + '搜索');
    q.required = false;
    const b = el('button', '搜索');
    f.append(b);
    const list = el('div');
    parent.append(f, list);
    async function load(cursor = null) {
      if (!cursor) list.replaceChildren();
      const r = await get({ view, q: q.value, ...(cursor ? { cursor } : {}) });
      for (const x of r.rows) button(list, x.name, () => chosen(x));
      if (r.next) button(list, '更多', () => load(r.next));
    }
    f.onsubmit = (e) => {
      e.preventDefault();
      load().catch((e) => (alert.textContent = e.message));
    };
    await load();
  }
  async function refresh() {
    work.replaceChildren();
    if (mode !== 'STUDENT') {
      if (mode === 'ADMIN') {
        await picker(work, '来源教学班', 'OFFERINGS', async (x) => {
          currentOffering = x.id;
          member = null;
          await refresh();
        });
        text(work, currentOffering ? '已选教学班 ' + currentOffering : '请先选择来源教学班。');
        const r = await get({ view: 'RULES' });
        creditRules = r.rows;
        let source = null,
          target = null;
        const cf = el('section');
        cf.append(el('h2', '跨班课程学分规则'));
        work.append(cf);
        await picker(cf, '来源课程', 'COURSES', (x) => {
          source = x;
          st.textContent = '来源：' + x.name;
        });
        const st = el('p', '尚未选择来源课程');
        cf.append(st);
        await picker(cf, '目标课程', 'COURSES', (x) => {
          target = x;
          tt.textContent = '目标：' + x.name;
        });
        const tt = el('p', '尚未选择目标课程');
        cf.append(tt);
        form(
          cf,
          '新增学分规则',
          (f) => ({
            title: control(f, '规则标题'),
            credits: control(f, '学分（0.1–30）', 'input', '1.0'),
            threshold: control(f, '最低总评（0–100）', 'input', '60'),
          }),
          (n) => {
            if (!source || !target) throw Error('请先选择来源和目标课程');
            return {
              type: 'SET_CREDIT_RULE',
              id: crypto.randomUUID(),
              revision: '1',
              sourceCourse: source.id,
              targetCourse: target.id,
              title: n.title.value,
              creditsTenths: Math.round(Number(n.credits.value) * 10),
              threshold: Math.round(Number(n.threshold.value) * 100),
              enabled: true,
            };
          },
        );
        for (const r of creditRules) {
          text(
            cf,
            `${r.title}：${r.source_name} → ${r.target_name}，${r.credits_tenths / 10}学分，最低${r.threshold / 100}，${r.enabled ? '启用' : '停用'}`,
          );
          button(cf, r.enabled ? '停用规则' : '启用规则', async () => {
            await req(
              base,
              {
                type: 'SET_CREDIT_RULE',
                id: r.id,
                revision: r.revision,
                sourceCourse: r.source_course,
                targetCourse: r.target_course,
                title: r.title,
                creditsTenths: r.credits_tenths,
                threshold: r.threshold,
                enabled: !r.enabled,
              },
              crypto.randomUUID(),
            );
            await refresh();
          });
        }
      }
      if (currentOffering) {
        const r = await get({ view: 'RULES', offering: currentOffering });
        rule = r.certificateRule;
        const box = el('section');
        box.append(el('h2', '证书签发规则'));
        work.append(box);
        form(
          box,
          '保存证书规则',
          (f) => ({
            title: control(f, '证书名称', 'input', rule?.title ?? '课程学习结业证明'),
            threshold: control(f, '最低总评', 'input', String((rule?.threshold ?? 6000) / 100)),
            enabled: select(
              f,
              '签发开关',
              [
                ['true', '启用'],
                ['false', '停用'],
              ],
              String(rule?.enabled ?? false),
            ),
          }),
          (n) => ({
            type: 'SET_CERT_RULE',
            offeringId: currentOffering,
            revision: rule?.revision ?? '1',
            title: n.title.value,
            threshold: Math.round(Number(n.threshold.value) * 100),
            enabled: n.enabled.value === 'true',
          }),
        );
        const choose = el('section');
        choose.append(el('h2', '选择学生并核对总评'));
        work.append(choose);
        if (mode === 'TEACHER') await roster(choose);
        else await adminRoster(choose);
      }
    }
    await records();
    root.setAttribute('aria-busy', 'false');
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty && !window.zhibanCoursePage) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  try {
    await refresh();
  } catch (e) {
    alert.textContent = e.message;
    root.setAttribute('aria-busy', 'false');
  }
})();
