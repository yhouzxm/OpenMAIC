/* Published plan text is public to its recipient; self reports never replace Learning evidence. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('remediation'),
    params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = params.get('tenant'),
    offering = params.get('offering'),
    course = params.get('course'),
    role = params.get('role'),
    mode = role === 'teacher' ? 'TEACHER' : 'STUDENT';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    ![tenant, offering, course].every((v) => uuid.test(v ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '课程地址无效，请从工作台进入。';
    return;
  }
  const base = `/api/zhiban/remediation/${tenant}/offerings/${offering}`,
    context = `space=${tenant}&offering=${offering}`;
  const href = (part) => `/zhiban/${role}/courses/${course}/${part}?${context}`;
  const caseId =
    mode === 'TEACHER' ? (/^#case-([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? null) : null;
  let generation = 0,
    disposed = false,
    dirtyKey = null,
    cursors = [null],
    page = 0;
  const controller = new AbortController();
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const date = (value) =>
    value === null || value === undefined
      ? '未设置'
      : new Date(Number(value)).toLocaleString('zh-CN');
  const states = { ACTIVE: '进行中', CLOSED: '已结束', CANCELLED: '已取消' };
  const outcomes = {
    ACHIEVED: '教师判定已达到本次目标',
    NEEDS_MORE: '继续补救',
    READY_FOR_REVIEW: '学生自报待复核',
    NEEDS_HELP: '学生请求帮助',
  };
  const clearDirty = () => {
    if (dirtyKey) window.zhibanCoursePage?.setDirty(dirtyKey, false);
    dirtyKey = null;
  };
  function reset() {
    generation++;
    clearDirty();
    root.replaceChildren();
    root.setAttribute('aria-busy', 'true');
    return generation;
  }
  function notice(error) {
    const p = el('p', error.message ?? String(error), 'notice');
    p.setAttribute('role', 'alert');
    root.append(p);
    root.setAttribute('aria-busy', 'false');
  }
  async function request(path, command = null, key = null) {
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
    const r = await fetch(path, {
      headers,
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      signal,
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          r.status === 409
            ? '计划版本或学习活动已变化，或该跟进已有进行中的计划。输入保留，请核对最新记录。'
            : r.status === 401 || r.status === 403
              ? '账户、角色或课程关系已变化，不能继续访问或发布。'
              : r.status === 404
                ? '该计划、任务或跟进不可访问。'
                : r.status === 400
                  ? '请检查任务数量、目标时间及必填内容。'
                  : '服务暂不可用；提交结果不确定时请重试同一命令。',
        ),
        {
          definitive: r.status >= 400 && r.status < 500,
          blocked: [401, 403, 404].includes(r.status),
        },
      );
    return data;
  }
  const read = (args = {}) => request(base + '?' + new URLSearchParams({ mode, ...args }));
  function button(name, action, parent = root) {
    const b = el('button', name);
    b.type = 'button';
    b.onclick = action;
    parent.append(b);
    return b;
  }
  function label(name, control) {
    control.setAttribute('aria-label', name);
    const l = el('label', name);
    l.append(control);
    return l;
  }
  function textControl(max, area = false) {
    const n = el(area ? 'textarea' : 'input');
    n.maxLength = max;
    n.required = true;
    return n;
  }
  function selectControl(options) {
    const s = el('select');
    for (const [value, name] of options) {
      const op = el('option', name);
      op.value = value;
      s.append(op);
    }
    return s;
  }
  function mutationForm(form, submitName, build, onSuccess) {
    const submit = el('button', submitName);
    submit.type = 'submit';
    const msg = el('p', '', 'notice');
    msg.setAttribute('role', 'status');
    form.append(submit, msg);
    let pending = null,
      busy = false;
    const key = 'remediation-' + crypto.randomUUID();
    const dirty = () => {
      dirtyKey = key;
      window.zhibanCoursePage?.setDirty(key, true, form);
    };
    form.addEventListener('input', dirty);
    form.addEventListener('change', dirty);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || disposed) return;
      try {
        pending ||= { key: crypto.randomUUID(), command: build() };
      } catch (error) {
        msg.textContent = error.message;
        return;
      }
      busy = true;
      dirty();
      const controls = [...form.querySelectorAll('input,textarea,select,button')];
      controls.forEach((n) => (n.disabled = true));
      try {
        const result = await request(base, pending.command, pending.key);
        if (disposed) return;
        pending = null;
        clearDirty();
        await onSuccess(result);
      } catch (error) {
        if (disposed) return;
        msg.textContent = error.message;
        if (error.definitive) pending = null;
        submit.textContent = pending ? '重试同一命令' : submitName;
        if (!error.blocked) {
          controls.forEach((n) => (n.disabled = !!pending));
          submit.disabled = false;
        }
      } finally {
        busy = false;
      }
    };
  }
  function header(title) {
    root.append(
      el('h1', title),
      el(
        'p',
        '补救安排不覆盖原活动的截止、重交或尝试次数。学生自报、提醒确认及教师评估不写入学习完成或成绩。',
        'muted',
      ),
    );
  }
  async function createForm(anchor, current) {
    const box = el('section', undefined, 'card');
    root.append(box);
    box.append(el('h2', '制定补救计划'));
    if (anchor.state !== 'OPEN') {
      box.append(el('p', '原跟进已结案，需重新打开后才能发布新计划。'));
      return;
    }
    box.append(
      el(
        'p',
        `接收学生：${anchor.student_name}。所有计划目标、学生反馈及教师评估对该学生可见；私有跟进说明不复制。`,
      ),
    );
    const form = el('form'),
      title = textControl(120),
      goal = textControl(2000, true),
      due = el('input');
    due.type = 'datetime-local';
    due.required = false;
    form.append(
      label('补救计划标题', title),
      label('学生可见补救目标与要求', goal),
      label('计划目标时间（可选）', due),
    );
    const picker = el('fieldset'),
      legend = el('legend', '选择已发布正式作业／测验（最多5项）');
    picker.append(legend);
    const search = el('input');
    search.type = 'search';
    search.setAttribute('aria-label', '搜索补救活动');
    const list = el('div', undefined, 'task-options'),
      selected = el('p'),
      chosen = new Map();
    let optionCursor = null,
      optionBusy = false,
      optionQ = '';
    const counter = () =>
      (selected.textContent =
        `已选 ${chosen.size}/5：` + [...chosen.values()].map((x) => x.title).join('、'));
    counter();
    const options = async (reset) => {
      if (optionBusy) return;
      optionBusy = true;
      find.disabled = more.disabled = true;
      try {
        if (reset) {
          optionCursor = null;
          optionQ = search.value.trim();
          list.replaceChildren();
        }
        const data = await read({
          options: '1',
          q: optionQ,
          ...(optionCursor ? { cursor: optionCursor } : {}),
        });
        if (current !== generation) return;
        for (const a of data.rows) {
          const check = el('input');
          check.type = 'checkbox';
          check.checked = chosen.has(a.id);
          check.setAttribute('aria-label', '选择补救活动：' + a.title);
          check.onchange = () => {
            if (check.checked && chosen.size >= 5) {
              check.checked = false;
              return;
            }
            if (check.checked) chosen.set(a.id, a);
            else chosen.delete(a.id);
            counter();
          };
          const l = el('label', undefined, 'task-option');
          l.append(
            check,
            el('span', `${a.title} · 发布 v${a.version} · 原截止 ${date(a.deadline_at)}`),
          );
          list.append(l);
        }
        optionCursor = data.next;
        more.disabled = !optionCursor;
      } catch (error) {
        if (current === generation) msg.textContent = error.message;
      } finally {
        optionBusy = false;
        find.disabled = false;
      }
    };
    const find = el('button', '查询可选活动'),
      more = el('button', '加载更多可选活动'),
      msg = el('p', '', 'notice');
    find.type = more.type = 'button';
    find.onclick = () => void options(true);
    more.onclick = () => void options(false);
    picker.append(search, find, list, more, selected, msg);
    form.append(
      picker,
      el(
        'p',
        '发布后目标及任务版本固定；需要修改时取消该计划再另发。发布即出现在学生“补救任务”，站内提醒仍由教师单独显式发送。',
        'muted',
      ),
    );
    box.append(form);
    mutationForm(
      form,
      '发布补救计划',
      () => {
        if (chosen.size < 1) throw Error('请选择至少一项正式活动。');
        const dueAt = due.value ? new Date(due.value).getTime() : null;
        if (dueAt !== null && (!Number.isSafeInteger(dueAt) || dueAt <= Date.now()))
          throw Error('计划目标时间需晚于当前时间。');
        return {
          type: 'ASSIGN_PLAN',
          caseId: anchor.id,
          revision: anchor.revision,
          title: title.value,
          goal: goal.value,
          dueAt,
          tasks: [...chosen.values()].map((a) => ({ activityId: a.id, version: a.version })),
        };
      },
      (result) => showDetail(result.id),
    );
    await options(true);
  }
  async function showList(cursor = null) {
    const current = reset();
    header(mode === 'TEACHER' ? '补救计划' : '我的补救任务');
    if (mode === 'TEACHER') {
      const a = el(
        'a',
        caseId ? '返回原跟进／发送站内提醒' : '从待跟进名单选择学生制定计划',
        'button secondary',
      );
      a.href = href('analytics') + (caseId ? '#followup-case-' + caseId : '#followups');
      root.append(a);
    }
    try {
      if (caseId) {
        const data = await request(
          `/api/zhiban/analytics/${tenant}/offerings/${offering}/followup-cases/${caseId}`,
        );
        if (current !== generation) return;
        await createForm(data.record, current);
      }
      const panel = el('section');
      root.append(panel);
      panel.append(el('h2', mode === 'TEACHER' ? '计划记录' : '收到的计划'));
      const data = await read({
        ...(caseId ? { case: caseId } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (current !== generation) return;
      if (!data.rows.length) panel.append(el('p', '暂无补救计划。'));
      for (const p of data.rows) {
        const card = el('article', undefined, 'card');
        card.append(
          el('h3', p.title),
          el(
            'p',
            `${states[p.state]}${p.student_name ? ' · ' + p.student_name : ''} · 计划目标时间 ${date(p.due_at)}`,
          ),
          el('p', p.goal, 'prose'),
        );
        button('查看任务与效果', () => showDetail(p.id), card);
        panel.append(card);
      }
      const prev = button(
          '上一页计划',
          () => {
            page--;
            void showList(cursors[page]);
          },
          panel,
        ),
        next = button(
          '下一页计划',
          () => {
            cursors[++page] = data.next;
            void showList(data.next);
          },
          panel,
        );
      prev.disabled = page === 0;
      next.disabled = !data.next;
      button(
        '刷新计划列表',
        () => {
          page = 0;
          cursors = [null];
          void showList();
        },
        panel,
      );
    } catch (error) {
      if (current === generation) notice(error);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  function score(f) {
    return f?.publicationId
      ? `${Number(f.scorePoints) / 100} / ${Number(f.maxPoints) / 100}（已发布 v${f.gradeVersion}）`
      : '尚无已发布成绩';
  }
  function factText(f) {
    return `尝试 ${f.attemptNo === null ? '未开始' : '#' + f.attemptNo}；提交 ${f.submissionId ? 'v' + f.submissionVersion : '暂无'}；${score(f)}；采样 ${date(f.asOf)}`;
  }
  async function showDetail(id, cursor = null) {
    const current = reset();
    history.replaceState(null, '', '#plan-' + id);
    header(mode === 'TEACHER' ? '补救计划与效果回看' : '补救任务详情');
    button('返回计划列表', () => {
      history.replaceState(null, '', caseId ? '#case-' + caseId : '#plans');
      void showList(cursors[page]);
    });
    try {
      const data = await read({
        id,
        ...(caseId ? { case: caseId } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (current !== generation) return;
      const p = data.record;
      root.append(
        el('h2', p.title),
        el(
          'p',
          `${states[p.state]} · 计划版本 ${p.revision}${p.student_name ? ' · ' + p.student_name : ''} · 发布教师 ${p.teacher_name}`,
        ),
        el('p', p.goal, 'prose'),
        el(
          'p',
          `计划目标时间：${date(p.due_at)}${p.due_at && Number(p.due_at) < Date.now() && p.state === 'ACTIVE' ? '（目标时间已过；原活动规则继续生效）' : ''}`,
        ),
      );
      for (const task of data.tasks) {
        const card = el('article', undefined, 'card');
        card.append(
          el(
            'h3',
            `任务 ${task.position}：${task.activity_title} · 固定 v${task.activity_version}`,
          ),
        );
        const wrap = el('div', undefined, 'table-wrap'),
          table = el('table');
        table.setAttribute('aria-label', '任务基线与当前事实：' + task.activity_title);
        const head = el('tr');
        head.append(el('th', '安排时基线'), el('th', '当前真实记录'));
        const row = el('tr');
        row.append(el('td', factText(task.baseline)), el('td', factText(task.current)));
        table.append(head, row);
        wrap.append(table);
        card.append(wrap);
        if (task.baseline.publicationId && task.current.publicationId) {
          const diff =
            (100 * Number(task.current.scorePoints)) / Number(task.current.maxPoints) -
            (100 * Number(task.baseline.scorePoints)) / Number(task.baseline.maxPoints);
          card.append(
            el(
              'p',
              `已发布得分率变化：${diff >= 0 ? '+' : ''}${Math.round(diff * 10) / 10} 个百分点。此变化不证明补救措施的因果效果。`,
            ),
          );
        }
        card.append(
          el('p', `原活动截止时间：${date(task.current.deadlineAt)}`),
          el(
            'p',
            task.report
              ? `${outcomes[task.report.value]} · ${date(task.report.created_at)}：${task.report.body}`
              : '学生尚未反馈。',
            'prose',
          ),
        );
        if (
          mode === 'STUDENT' &&
          p.state === 'ACTIVE' &&
          task.current.activityState === 'PUBLISHED' &&
          task.current.currentPublishedVersion === task.activity_version
        ) {
          const a = el('a', '进入原活动作答', 'button secondary');
          a.href = href('coursework') + '#activity-' + task.activity_id;
          card.append(a);
        } else if (
          task.current.currentPublishedVersion !== task.activity_version ||
          task.current.activityState !== 'PUBLISHED'
        )
          card.append(el('p', '活动已换版或撤回；此固定版本只供回看，请教师另行安排。', 'notice'));
        root.append(card);
      }
      if (p.state === 'ACTIVE') {
        const form = el('form'),
          body = textControl(2000, true);
        if (mode === 'STUDENT') {
          const task = selectControl(data.tasks.map((t) => [t.id, t.activity_title])),
            status = selectControl([
              ['READY_FOR_REVIEW', '我已处理，申请教师复核'],
              ['NEEDS_HELP', '我需要帮助'],
            ]);
          form.append(
            el('h2', '反馈补救任务'),
            label('反馈的补救任务', task),
            label('任务反馈状态', status),
            label('学生任务反馈', body),
            el('p', '此处仅记录本人反馈，作答仍需进入原活动正式提交。'),
          );
          mutationForm(
            form,
            '发送任务反馈',
            () => ({
              type: 'REPORT_TASK',
              id: p.id,
              revision: p.revision,
              taskId: task.value,
              status: status.value,
              body: body.value,
            }),
            () => showDetail(p.id),
          );
        } else {
          const action = selectControl([
              ['REVIEW_PLAN', '记录效果评估'],
              ['CANCEL_PLAN', '取消计划'],
            ]),
            outcome = selectControl([
              ['NEEDS_MORE', '继续补救'],
              ['ACHIEVED', '已达到本次目标并结束计划'],
            ]);
          form.append(
            el('h2', '教师效果评估'),
            label('计划处理动作', action),
            label('教师效果判断', outcome),
            label('学生可见评估说明', body),
            el('p', '评估会保存当前真实提交／已发布成绩快照。人工判断不替代评分或学习完成证明。'),
          );
          action.onchange = () => (outcome.disabled = action.value === 'CANCEL_PLAN');
          mutationForm(
            form,
            '保存计划处理',
            () => ({
              type: action.value,
              id: p.id,
              revision: p.revision,
              ...(action.value === 'REVIEW_PLAN' ? { outcome: outcome.value } : {}),
              body: body.value,
            }),
            () => showDetail(p.id),
          );
        }
        root.append(form);
      }
      root.append(el('h2', '计划处理历史'));
      const names = {
        ASSIGN_PLAN: '发布计划',
        REPORT_TASK: '学生反馈',
        REVIEW_PLAN: '教师评估',
        CANCEL_PLAN: '取消计划',
      };
      for (const e of data.rows) {
        const card = el('article', undefined, 'card');
        card.append(
          el('h3', names[e.action] + (e.value ? ' · ' + outcomes[e.value] : '')),
          el('p', `${e.actor_name} · ${date(e.created_at)} · 版本 ${e.revision}`),
          el('p', e.body, 'prose'),
        );
        if (e.snapshot.length) {
          const details = el('details');
          details.append(
            el('summary', e.action === 'REVIEW_PLAN' ? '查看评估时固定证据' : '查看安排时固定基线'),
          );
          for (const f of e.snapshot) details.append(el('p', f.activityTitle + '：' + factText(f)));
          card.append(details);
        }
        root.append(card);
      }
      if (data.next) button('查看更早计划历史', () => showDetail(id, data.next));
      if (cursor) button('回到最新计划历史', () => showDetail(id));
      button('刷新任务与效果', () => showDetail(id));
    } catch (error) {
      if (current === generation) notice(error);
    } finally {
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      disposed = true;
      controller.abort();
      reset();
      notice(Error('登录状态已变化，请返回工作台。'));
    };
  window.addEventListener('pagehide', () => {
    disposed = true;
    controller.abort();
    clearDirty();
    channel?.close();
    root.replaceChildren();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  const plan = /^#plan-([0-9a-f-]{36})$/.exec(location.hash)?.[1];
  if (plan) void showDetail(plan);
  else void showList();
})();
