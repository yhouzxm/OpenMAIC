/* Private teacher review only. Rule matches are prompts to inspect evidence, never student labels. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('risk'),
    p = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = p.get('tenant'),
    offering = p.get('offering'),
    course = p.get('course');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (p.get('role') !== 'teacher' || ![tenant, offering, course].every((v) => uuid.test(v ?? ''))) {
    root.textContent = '请从教师课程工作区进入。';
    return;
  }
  const base = `/api/zhiban/risk/${tenant}/offerings/${offering}`,
    context = `space=${tenant}&offering=${offering}`,
    href = (part) => `/zhiban/teacher/courses/${course}/${part}?${context}`;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const names = {
      OVERDUE: '逾期未交',
      LOW_SCORE: '正式发布得分率低于阈值',
      PLAN_OVERDUE: '补救计划超过目标时间',
    },
    decisions = {
      SUPPORT: '确认需要支持',
      NO_ACTION: '暂不处置',
      RESOLVED: '解除／结束审阅',
      PENDING: '待审阅',
    };
  let generation = 0,
    view = 'QUEUE',
    filters = { code: 'ALL', decision: 'PENDING', q: '' },
    cursors = [null],
    page = 0,
    dialog = null,
    cleanups = [],
    dirtyForms = new Map();
  const controller = new AbortController();
  const date = (v) =>
    v === null || v === undefined ? '未设置' : new Date(Number(v)).toLocaleString('zh-CN');
  const button = (name, action, parent = root) => {
    const b = el('button', name);
    b.type = 'button';
    b.onclick = action;
    parent.append(b);
    return b;
  };
  const field = (name, node) => {
    node.setAttribute('aria-label', name);
    const l = el('label', name);
    l.append(node);
    return l;
  };
  const select = (opts) => {
    const s = el('select');
    for (const [v, n] of opts) {
      const o = el('option', n);
      o.value = v;
      s.append(o);
    }
    return s;
  };
  async function request(args = {}, command = null, key = null) {
    const headers = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    if (command) {
      const c = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store', signal });
      if (!c.ok)
        throw Object.assign(Error('登录已失效，请返回工作台。'), {
          definitive: true,
          blocked: true,
        });
      headers['x-zhiban-csrf'] = (await c.json()).csrfToken;
      headers['x-zhiban-command'] = key;
      headers['content-type'] = 'application/json';
    }
    const r = await fetch(base + (command ? '' : '?' + new URLSearchParams(args)), {
      headers,
      cache: 'no-store',
      method: command ? 'POST' : 'GET',
      signal,
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    const d = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          r.status === 409
            ? '规则、事实或审阅版本已变化，或该事实已经审阅。输入保留，请刷新后按最新记录处理。'
            : r.status === 401 || r.status === 403
              ? '当前教师授权或任教关系已失效。'
              : r.status === 404
                ? '该规则来源或审阅不可访问。'
                : r.status === 400
                  ? '参数无效，请检查阈值和说明。'
                  : '服务暂不可用；结果不确定时请重试同一命令。',
        ),
        {
          definitive: r.status >= 400 && r.status < 500,
          blocked: [401, 403, 404].includes(r.status),
        },
      );
    return d;
  }
  function reset(title) {
    generation++;
    for (const f of cleanups) f();
    cleanups = [];
    root.replaceChildren();
    root.setAttribute('aria-busy', 'true');
    root.append(
      el('h1', title),
      el(
        'p',
        '规则命中仅提示核查事实，不是能力诊断或自动处分。审阅与说明仅任教教师可见；不向学生公开风险标签。',
        'risk-private',
      ),
    );
    const nav = el('nav', undefined, 'actions');
    nav.setAttribute('aria-label', '风险审阅视图');
    for (const [v, n] of [
      ['QUEUE', '规则命中待审'],
      ['HISTORY', '审阅记录'],
      ['RULES', '规则设置'],
    ])
      button(
        n,
        () => {
          view = v;
          page = 0;
          cursors = [null];
          filters = { code: 'ALL', decision: v === 'QUEUE' ? 'PENDING' : 'ALL', q: '' };
          void load();
        },
        nav,
      );
    root.append(nav);
    return generation;
  }
  function fail(error) {
    const n = el('p', error.message, 'notice');
    n.setAttribute('role', 'alert');
    root.append(n);
  }
  function explain(hit) {
    const box = el('div');
    box.append(
      el(
        'p',
        `${names[hit.ruleCode]} · 规则 v${hit.ruleRevision} · 阈值 ${hit.threshold}${hit.ruleCode === 'LOW_SCORE' ? '%' : ' 小时'}`,
      ),
    );
    const f = hit.facts;
    if (hit.ruleCode === 'LOW_SCORE' && f.publicationId === null)
      box.append(el('p', '当前最新提交尚无已发布成绩，不沿用旧提交分数。'));
    else if (hit.ruleCode === 'LOW_SCORE')
      box.append(
        el(
          'p',
          `正式成绩：${Number(f.scorePoints) / 100} / ${Number(f.maxPoints) / 100}，得分率 ${Math.round((Number(f.scorePoints) * 1000) / Number(f.maxPoints)) / 10}%（命中条件：严格低于 ${hit.threshold}%）。仅采用最新提交的最新正式发布成绩。`,
        ),
      );
    else
      box.append(
        el(
          'p',
          hit.ruleCode === 'OVERDUE'
            ? `原截止：${date(f.deadlineAt)}；固定 v${f.version} 最新提交：${f.submissionId ? '已有' : '尚无'}。逾期达到 ${hit.threshold} 小时才命中。`
            : `补救目标时间：${date(f.dueAt)}；计划 ${f.planState}、版本 ${f.planRevision}。超过目标时间达到 ${hit.threshold} 小时；不据此认定学生未学习。`,
        ),
      );
    const detail = el('details');
    detail.append(el('summary', '查看原始记录引用'));
    for (const key of [
      'attemptId',
      'submissionId',
      'publicationId',
      'gradeVersion',
      'publishedAt',
      'planId',
      'planRevision',
    ])
      if (f[key] !== undefined && f[key] !== null)
        detail.append(
          el('p', key === 'publishedAt' ? `正式发布时间：${date(f[key])}` : `${key}：${f[key]}`),
        );
    box.append(detail);
    return box;
  }
  function bindMutation(form, label, build, success) {
    const submit = el('button', label);
    submit.type = 'submit';
    const msg = el('p', '', 'notice');
    msg.setAttribute('role', 'status');
    form.append(submit, msg);
    let busy = false,
      pending = null;
    const key = 'risk-' + crypto.randomUUID();
    const dirty = () => {
      dirtyForms.set(key, form);
      window.zhibanCoursePage?.setDirty(key, true, form);
    };
    form.addEventListener('input', dirty);
    form.addEventListener('change', dirty);
    cleanups.push(() => {
      dirtyForms.delete(key);
      window.zhibanCoursePage?.setDirty(key, false);
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      if (
        [...dirtyForms.keys()].some((k) => k !== key) &&
        !confirm('还有其他未保存的输入。本次保存会刷新页面并放弃其他输入，是否继续？')
      )
        return;
      pending ||= { key: crypto.randomUUID(), command: build() };
      busy = true;
      dirty();
      const controls = [...form.querySelectorAll('input,textarea,select,button')];
      controls.forEach((n) => (n.disabled = true));
      try {
        const result = await request({}, pending.command, pending.key);
        pending = null;
        dirtyForms.delete(key);
        window.zhibanCoursePage?.setDirty(key, false);
        await success(result);
      } catch (error) {
        msg.textContent = error.message;
        if (error.definitive) pending = null;
        submit.textContent = pending ? '重试同一命令' : label;
        if (!error.blocked) {
          controls.forEach((n) => (n.disabled = !!pending));
          submit.disabled = false;
        }
      } finally {
        busy = false;
      }
    };
  }
  function reviewHit(hit) {
    if (dialog) return;
    const d = el('dialog', undefined, 'risk-dialog');
    dialog = d;
    d.setAttribute('aria-label', '审阅规则命中');
    d.append(
      el('h2', hit.title + ' · ' + (hit.displayName ?? '历史成员')),
      explain(hit),
      el(
        'p',
        '本说明仅教师可见。确认需要支持后，需另行显式登记跟进；不会自动通知或处分学生。',
        'risk-private',
      ),
    );
    const form = el('form'),
      decision = select([
        ['SUPPORT', '确认需要支持'],
        ['NO_ACTION', '暂不处置'],
      ]),
      body = el('textarea');
    body.required = true;
    body.maxLength = 2000;
    form.append(field('首次审阅判断', decision), field('教师私有审阅说明', body));
    d.append(form);
    const hint = el('p');
    d.append(hint);
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      hint.textContent = '说明尚未保存；请保存，或明确放弃输入并关闭。';
    });
    button(
      '放弃输入并关闭',
      () => {
        for (const f of cleanups) f();
        d.close();
        d.remove();
        dialog = null;
      },
      d,
    );
    bindMutation(
      form,
      '保存首次审阅',
      () => ({
        type: 'REVIEW_SIGNAL',
        ruleCode: hit.ruleCode,
        ruleRevision: hit.ruleRevision,
        enrollmentId: hit.enrollmentId,
        anchorId: hit.anchorId,
        anchorVersion: hit.anchorVersion,
        sourceKey: hit.sourceKey,
        expectedDigest: hit.digest,
        decision: decision.value,
        body: body.value,
      }),
      async (r) => {
        d.close();
        d.remove();
        dialog = null;
        await detail(r.id);
      },
    );
    document.body.append(d);
    d.showModal();
    body.focus();
  }
  async function rules() {
    const current = reset('可解释风险规则设置');
    try {
      const data = await request({ view: 'RULES' });
      if (current !== generation) return;
      root.append(
        el(
          'p',
          '规则仅作用于本教学班；默认全部关闭。24小时／60%／24小时只是待选择的初始值，保存启用后才生效。修改会生成新版本，不改写旧审阅。',
        ),
      );
      for (const r of data.rows) {
        const box = el('section', undefined, 'card'),
          form = el('form'),
          enabled = el('input'),
          threshold = el('input');
        enabled.type = 'checkbox';
        enabled.checked = r.enabled;
        threshold.type = 'number';
        threshold.min = r.code === 'LOW_SCORE' ? '1' : '0';
        threshold.max = r.code === 'LOW_SCORE' ? '100' : '720';
        threshold.step = '1';
        threshold.value = String(r.threshold);
        threshold.required = true;
        box.append(
          el('h2', names[r.code]),
          el('p', `当前版本 ${r.revision} · ${r.enabled ? '已启用' : '关闭'}`),
        );
        form.append(
          field('启用规则：' + names[r.code], enabled),
          field(
            '规则阈值：' + names[r.code] + (r.code === 'LOW_SCORE' ? '（百分比）' : '（小时）'),
            threshold,
          ),
        );
        bindMutation(
          form,
          '保存规则：' + names[r.code],
          () => ({
            type: 'SAVE_RULE',
            ruleCode: r.code,
            revision: r.revision,
            enabled: enabled.checked,
            threshold: Number(threshold.value),
          }),
          () => rules(),
        );
        box.append(form);
        root.append(box);
      }
    } catch (error) {
      if (current === generation) fail(error);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  async function listing() {
    const current = reset(view === 'QUEUE' ? '规则命中与教师审阅' : '教师私有审阅记录');
    try {
      const filter = el('form'),
        code = select([['ALL', '全部规则'], ...Object.entries(names)]),
        decision = select(
          view === 'QUEUE'
            ? [
                ['PENDING', '待审阅'],
                ['SUPPORT', '已确认需要支持'],
                ['ALL', '全部当前命中'],
              ]
            : [
                ['ALL', '全部判断'],
                ['SUPPORT', '确认需要支持'],
                ['NO_ACTION', '暂不处置'],
                ['RESOLVED', '解除／结束审阅'],
              ],
        ),
        q = el('input');
      q.type = 'search';
      q.maxLength = 120;
      q.value = filters.q;
      code.value = filters.code;
      decision.value = filters.decision;
      filter.append(
        field('筛选风险规则', code),
        field('筛选审阅判断', decision),
        field('搜索学生或活动／计划', q),
      );
      const submit = el('button', '查询审阅事项');
      submit.type = 'submit';
      filter.append(submit);
      filter.onsubmit = (e) => {
        e.preventDefault();
        filters = { code: code.value, decision: decision.value, q: q.value.trim() };
        page = 0;
        cursors = [null];
        void listing();
      };
      root.append(filter);
      const data = await request({
        view,
        ...filters,
        ...(cursors[page] ? { cursor: cursors[page] } : {}),
      });
      if (current !== generation) return;
      root.append(
        el('p', '服务器观察时点：' + date(data.asOf) + '。翻页为实时查询；规则变化后须重新查询。'),
      );
      if (!data.rows.length)
        root.append(
          el(
            'p',
            view === 'QUEUE'
              ? '当前筛选下没有规则命中。请核对是否启用了规则；这不证明所有学习问题均已解决。'
              : '暂无审阅记录。',
          ),
        );
      for (const r of data.rows) {
        const box = el('article', undefined, 'card');
        if (view === 'QUEUE') {
          box.append(
            el('h2', r.title + ' · ' + (r.displayName ?? '历史成员')),
            explain(r),
            el('p', r.reviewDecision ? decisions[r.reviewDecision] : '尚未审阅'),
          );
          button(
            r.reviewId ? '查看已有审阅' : '审阅命中',
            () => (r.reviewId ? detail(r.reviewId) : reviewHit(r)),
            box,
          );
        } else {
          box.append(
            el('h2', r.evidence.title + ' · ' + r.student_name),
            el(
              'p',
              `${names[r.rule_code]} · 规则 v${r.rule_revision} · ${decisions[r.decision]} · 审阅 v${r.revision}`,
            ),
          );
          button('查看审阅与当前事实', () => detail(r.id), box);
        }
        root.append(box);
      }
      const prev = button('上一页审阅事项', () => {
          page--;
          void listing();
        }),
        next = button('下一页审阅事项', () => {
          cursors[++page] = data.next;
          void listing();
        });
      prev.disabled = page === 0;
      next.disabled = !data.next;
      button('刷新审阅事项', () => {
        page = 0;
        cursors = [null];
        void listing();
      });
    } catch (error) {
      if (current === generation) fail(error);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  async function detail(id, cursor = null) {
    const current = reset('教师审阅详情');
    history.replaceState(null, '', '#review-' + id);
    button('返回审阅记录', () => {
      view = 'HISTORY';
      filters = { code: 'ALL', decision: 'ALL', q: '' };
      page = 0;
      cursors = [null];
      void listing();
    });
    try {
      const data = await request({ view: 'DETAIL', id, ...(cursor ? { cursor } : {}) });
      if (current !== generation) return;
      const r = data.record,
        live = data.current;
      root.append(
        el('h2', r.evidence.title + ' · ' + r.student_name),
        el('p', `${decisions[r.decision]} · 审阅版本 ${r.revision}`),
        el('h3', '首次审阅的固定证据'),
        explain(r.evidence),
        el('h3', '当前事实'),
        explain(live),
        el(
          'p',
          live.matched && live.sourceKey === r.source_key
            ? '原事实目前仍命中该规则。'
            : '原事实已变化、不再命中，或规则已关闭／换版；不得沿用旧命中继续确认支持。',
          'notice',
        ),
      );
      const currentMatch = live.matched && live.sourceKey === r.source_key;
      if (r.case_id) {
        const a = el('a', '查看跟进／提醒与补救计划', 'button secondary');
        a.href = href('analytics') + '#followup-case-' + r.case_id;
        root.append(a);
      }
      if (live.ruleCode === 'PLAN_OVERDUE') {
        const a = el('a', '查看原补救计划', 'button secondary');
        a.href = href('remediation') + '#plan-' + live.anchorId;
        root.append(a);
      } else {
        const a = el('a', '查看原活动', 'button secondary');
        a.href = href('classrooms') + '#activity-' + live.anchorId;
        root.append(a);
      }
      const form = el('form'),
        actions = [['AMEND_REVIEW', '修订审阅判断']];
      if (r.decision === 'SUPPORT' && currentMatch && !r.case_id)
        actions.push(['LINK_FOLLOWUP', '登记跟进并接补救入口']);
      const action = select(actions),
        decision = select([
          ['SUPPORT', '确认需要支持'],
          ['NO_ACTION', '暂不处置'],
          ['RESOLVED', '解除／结束审阅'],
        ]),
        body = el('textarea');
      decision.value = r.decision;
      if (!currentMatch) decision.querySelector('option[value="SUPPORT"]').disabled = true;
      body.maxLength = 2000;
      body.required = true;
      form.append(
        field('审阅处理动作', action),
        field('修订后的审阅判断', decision),
        field('教师私有处理说明', body),
        el(
          'p',
          '解除只是教师结束本次审阅，不改变作答、成绩或学习完成。登记跟进不会自动发通知；已有跟进会复用，已结案记录不会自动重开。',
          'risk-private',
        ),
      );
      action.onchange = () => (decision.disabled = action.value === 'LINK_FOLLOWUP');
      bindMutation(
        form,
        '保存审阅处理',
        () => ({
          type: action.value,
          id: r.id,
          revision: r.revision,
          expectedDigest: live.digest,
          ...(action.value === 'AMEND_REVIEW' ? { decision: decision.value } : {}),
          body: body.value,
        }),
        () => detail(id),
      );
      root.append(form, el('h2', '不可变审阅历史'));
      for (const e of data.rows) {
        const box = el('article', undefined, 'card');
        box.append(
          el(
            'h3',
            `${e.action === 'LINK_FOLLOWUP' ? '登记跟进' : e.action === 'AMEND_REVIEW' ? '修订判断' : '首次审阅'} · ${decisions[e.decision]}`,
          ),
          el('p', `${e.actor_name} · ${date(e.created_at)} · 版本 ${e.revision}`),
          el('p', e.body, 'prose'),
        );
        const d = el('details');
        d.append(el('summary', '查看当时固定事实与规则'), explain(e.snapshot));
        box.append(d);
        root.append(box);
      }
      if (data.next) button('更早审阅历史', () => detail(id, data.next));
      if (cursor) button('最新审阅历史', () => detail(id));
      button('刷新当前事实', () => detail(id));
    } catch (error) {
      if (current === generation) fail(error);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const load = () => (view === 'RULES' ? rules() : listing());
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      controller.abort();
      dialog?.close();
      dialog?.remove();
      dialog = null;
      reset('登录状态已变化');
      fail(Error('请返回工作台重新登录。'));
    };
  window.addEventListener('pagehide', () => {
    controller.abort();
    for (const f of cleanups) f();
    dialog?.remove();
    channel?.close();
    root.replaceChildren();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  const id = /^#review-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
  if (id) void detail(id);
  else void load();
})();
