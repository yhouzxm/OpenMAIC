(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('pbl'),
    q = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = q.get('tenant'),
    offering = q.get('offering'),
    role = q.get('role'),
    teacher = role === 'teacher';
  if (
    ![tenant, offering].every((x) => /^[0-9a-f-]{36}$/.test(x ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '请从课程工作区进入。';
    return;
  }
  const base = `/api/zhiban/pbl/${tenant}/offerings/${offering}`;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const note = el('p', '', 'pbl-note'),
    error = el('p', '', 'pbl-error'),
    nav = el('div', undefined, 'pbl-row'),
    body = el('section');
  error.setAttribute('role', 'alert');
  root.append(
    el('h1', 'PBL 小组协作项目'),
    el('p', '共同编辑成果，全员确认同一版本后提交，教师评价公开给该次提交的成员。', 'pbl-note'),
    note,
    error,
    nav,
    body,
  );
  let busy = false,
    dirty = false,
    dead = false,
    pending = null,
    current = { kind: 'projects', id: null, after: null },
    csrf = null;
  const requests = new Set();
  let poll,
    queuedHash = null,
    lastHash = location.hash;
  const field = (name, value = '', kind = 'text') => {
    const n = el(kind === 'textarea' ? 'textarea' : 'input');
    if (kind !== 'textarea') n.type = kind;
    n.value = value;
    n.setAttribute('aria-label', name);
    return n;
  };
  const labelled = (parent, name, input) => {
    const l = el('label', name);
    l.append(input);
    parent.append(l);
    return input;
  };
  const check = (parent, name, checked = false) => {
    const n = field(name, '', 'checkbox');
    n.checked = checked;
    return labelled(parent, name, n);
  };
  const button = (name, work, parent) => {
    const b = el('button', name);
    b.type = 'button';
    b.onclick = () => void run(work);
    parent?.append(b);
    return b;
  };
  const panel = (title, parent = body) => {
    const x = el('section', undefined, 'pbl-panel');
    if (title) x.append(el('h2', title));
    parent.append(x);
    return x;
  };
  const courseGuard = typeof window.zhibanCoursePage?.setDirty === 'function';
  const syncDirty = () => {
    if (courseGuard)
      window.zhibanCoursePage.setDirty('pbl-collaboration', dirty || !!pending, root);
  };
  const changed = () => {
    dirty = true;
    syncDirty();
    note.textContent = '有未保存内容；刷新或离开前请先保存。';
  };
  const discard = () => !dirty || confirm('有未保存内容，确定放弃并切换页面吗？');
  const api = async (path = '', command, key) => {
    const ac = new AbortController();
    requests.add(ac);
    try {
      if (command && !csrf) {
        const r = await fetch('/api/zhiban/identity/csrf', {
          credentials: 'same-origin',
          headers: { 'x-zhiban-request': 'identity-v1' },
          signal: ac.signal,
        });
        csrf = (await r.json()).csrfToken;
        if (!r.ok) throw { status: r.status };
      }
      const r = await fetch(base + path, {
        method: command ? 'POST' : 'GET',
        credentials: 'same-origin',
        signal: ac.signal,
        headers: {
          'x-zhiban-request': 'identity-v1',
          ...(command
            ? { 'content-type': 'application/json', 'x-zhiban-csrf': csrf, 'x-zhiban-command': key }
            : {}),
        },
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
      const value = await r.json();
      if (!r.ok) throw { status: r.status, code: value.error?.code ?? value.code };
      if (dead) throw Error('session changed');
      return value;
    } finally {
      requests.delete(ac);
    }
  };
  const send = async (command) => {
    if (pending) throw { code: 'PENDING' };
    pending = { command, key: crypto.randomUUID() };
    syncDirty();
    return retry();
  };
  const retry = async () => {
    const p = pending;
    if (!p) return;
    try {
      const r = await api('', p.command, p.key);
      pending = null;
      dirty = false;
      syncDirty();
      note.textContent = '操作已保存。';
      return r;
    } catch (e) {
      if (e.status && e.status < 500) pending = null;
      syncDirty();
      throw e;
    }
  };
  const run = async (work) => {
    if (busy || dead) return;
    busy = true;
    root.inert = true;
    error.textContent = '';
    root.setAttribute('aria-busy', 'true');
    try {
      await work();
    } catch (e) {
      if (!dead)
        error.textContent =
          e.status === 401
            ? '会话已过期，请返回工作台重新登录。'
            : e.code === 'PENDING'
              ? '上一操作结果尚未确认，请先重试同一操作。'
              : e.status === 409
                ? '版本或状态已变化，未覆盖服务器内容。请保留本地文字，刷新后核对；共同提交需全员确认当前版本。'
                : e.status === 403
                  ? '当前成员、任教或小组权限已变化，请联系教师核对名单。'
                  : e.status === 404
                    ? '该项目或小组不可访问。'
                    : e.status === 400
                      ? '内容格式不符合要求，请核对项目、任务和评价字段。'
                      : e.message?.startsWith('JSON')
                        ? '原生项目JSON格式有误。'
                        : '结果尚未确认，可重试同一操作；不要重复创建新提交。';
    } finally {
      busy = false;
      root.inert = false;
      root.setAttribute('aria-busy', 'false');
      if (queuedHash !== null && !dead) void adoptHash();
    }
  };
  button(
    '重试同一操作',
    async () => {
      if (pending) {
        await retry();
        await load();
      }
    },
    nav,
  );
  button(
    '刷新当前页',
    async () => {
      if (pending) {
        error.textContent = '请先重试同一操作，确认结果后再刷新。';
        return;
      }
      if (!discard()) return;
      dirty = false;
      await load();
    },
    nav,
  );
  button('全部项目', () => go('projects'), nav);
  const go = async (kind, id = null, after = null) => {
    if (pending) {
      error.textContent = '请先重试同一操作，确认结果后再切换。';
      return;
    }
    if (!discard()) return;
    dirty = false;
    current = { kind, id, after };
    history.replaceState(
      null,
      '',
      kind === 'projects' ? location.pathname + location.search : '#' + kind + '-' + id,
    );
    lastHash = location.hash;
    await load();
  };
  const pager = (next, work, parent = body) => {
    if (next) button('下一页', () => work(next), parent);
  };
  const tasks = (parent, design, answers) => {
    parent.append(el('p', design.description, 'pbl-note'));
    if (design.learningObjective)
      parent.append(el('p', '学习目标：' + design.learningObjective, 'pbl-note'));
    for (const m of design.milestones) {
      const stage = el('section', undefined, 'pbl-task');
      stage.append(el('h3', m.title));
      if (m.description) stage.append(el('p', m.description));
      for (const d of m.documents ?? []) {
        const doc = el('details');
        doc.append(el('summary', d.title), el('pre', d.content));
        stage.append(doc);
      }
      for (const t of m.microtasks) {
        stage.append(el('h4', t.title), el('p', t.description ?? ''));
        if (t.completionCriteria)
          stage.append(el('p', '交付要求：' + t.completionCriteria, 'pbl-note'));
        if (t.hints?.length) {
          const tips = el('details');
          tips.append(el('summary', '任务提示'), el('pre', t.hints.join('\n')));
          stage.append(tips);
        }
        if (answers) stage.append(el('pre', answers[t.id] ?? '未填写'));
      }
      parent.append(stage);
    }
  };
  const projectForm = (p = null, parent = body) => {
    const box = panel(p ? '编辑项目草稿' : '创建小组项目', parent),
      form = el('form');
    box.append(form);
    let title, description, outline, json;
    if (!p) {
      title = labelled(form, '项目名称', field('项目名称'));
      title.required = true;
      title.maxLength = 120;
      description = labelled(form, '项目说明', field('项目说明', '', 'textarea'));
      description.required = true;
      description.maxLength = 4000;
      outline = labelled(
        form,
        '任务清单（每行一个任务）',
        field('任务清单（每行一个任务）', '分析问题\n设计并验证方案\n整理成果与反思', 'textarea'),
      );
      const details = el('details');
      details.append(el('summary', '复用原生PBL v2项目'));
      json = labelled(
        details,
        '原生PBL项目JSON（可选）',
        field('原生PBL项目JSON（可选）', '', 'textarea'),
      );
      details.append(
        el(
          'p',
          '填写后使用原生JSON中的项目、里程碑和任务；仅采用设计，聊天与AI评价不作为小组结果。',
          'pbl-note',
        ),
      );
      form.append(details);
    } else {
      json = labelled(
        form,
        '原生PBL项目JSON',
        field('原生PBL项目JSON', JSON.stringify(p.design, null, 2), 'textarea'),
      );
      json.className = 'pbl-json';
    }
    if (!p)
      json.addEventListener('input', () => {
        title.required = !json.value.trim();
        description.required = !json.value.trim();
      });
    const deadline = labelled(
      form,
      '截止时间（留空不限）',
      field(
        '截止时间（留空不限）',
        p?.deadline_at
          ? new Date(Number(p.deadline_at) - new Date().getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          : '',
        'datetime-local',
      ),
    );
    const resubmit = check(form, '允许修改成果后重新全员确认并重交', p?.allow_resubmit ?? true);
    const submit = el('button', p ? '保存项目草稿' : '创建项目');
    submit.type = 'submit';
    form.append(submit);
    form.oninput = changed;
    form.onsubmit = (e) => {
      e.preventDefault();
      void run(async () => {
        let design;
        if (json.value.trim()) design = JSON.parse(json.value);
        else {
          const lines = outline.value
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          if (!lines.length) throw { status: 400 };
          design = {
            uiPhase: 'hero',
            title: title.value,
            description: description.value,
            tags: [],
            language: 'zh-CN',
            proficiency: '',
            status: 'active',
            roles: [],
            milestones: [
              {
                id: 'milestone-1',
                title: '项目任务',
                status: 'active',
                order: 0,
                microtasks: lines.map((name, i) => ({
                  id: 'task-' + (i + 1),
                  title: name,
                  description: '',
                  status: 'todo',
                  assignee: 'user',
                  hints: [],
                  order: i,
                  completionCriteria: '提交本任务的共同成果',
                })),
              },
            ],
            submissions: [],
            evaluations: [],
            threads: [],
            engagementEvents: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        const result = await send({
          type: p ? 'SAVE_PROJECT' : 'CREATE_PROJECT',
          ...(p ? { id: p.id, revision: p.revision } : {}),
          design,
          deadlineAt: deadline.value ? new Date(deadline.value).getTime() : null,
          allowResubmit: resubmit.checked,
        });
        await go('project', result.id);
      });
    };
  };
  const groupForm = async (p, g = null, members = []) => {
    const box = panel(g ? '调整小组名单' : '创建小组'),
      form = el('form');
    box.append(form);
    box.append(
      el(
        'p',
        '同一项目每人只能加入一个组。调整名单会把共享草稿交给新名单，并使所有旧确认失效；可清空旧组以转移全部组员，历史提交的成员不变。',
        'pbl-note',
      ),
    );
    const name = labelled(form, '小组名称', field('小组名称', g?.name ?? ''));
    name.required = true;
    name.maxLength = 80;
    const selected = new Map(members.map((m) => [m.membership_id, m.display_name]));
    const picks = el('div'),
      roster = el('div', undefined, 'pbl-roster'),
      search = field('搜索本班学生'),
      searchBar = el('div', undefined, 'pbl-row');
    form.append(picks, searchBar, roster);
    searchBar.append(search);
    let cursor = null,
      query = '';
    const showPicks = () => {
      picks.replaceChildren(el('p', `已选 ${selected.size}/10 人`));
      for (const [id, n] of selected)
        button(
          '移除 ' + n,
          async () => {
            selected.delete(id);
            changed();
            showPicks();
            await candidates();
          },
          picks,
        );
    };
    const candidates = async () => {
      const url = new URL(`/api/zhiban/workspace/${tenant}/roster`, location.origin);
      url.search = new URLSearchParams({
        offering,
        q: query,
        limit: '20',
        ...(cursor ? { cursor } : {}),
      });
      const r = await fetch(url, {
          credentials: 'same-origin',
          headers: { 'x-zhiban-request': 'identity-v1' },
        }),
        value = await r.json();
      if (!r.ok) throw { status: r.status };
      if (dead) return;
      roster.replaceChildren();
      for (const x of value.rows) {
        const n = check(roster, x.name ?? '历史成员', selected.has(x.membership_id));
        n.onchange = () => {
          if (n.checked) {
            if (selected.size >= 10) {
              n.checked = false;
              error.textContent = '每组最多10人。';
              return;
            }
            selected.set(x.membership_id, x.name ?? '历史成员');
          } else selected.delete(x.membership_id);
          showPicks();
        };
      }
      if (!value.rows.length) roster.append(el('p', '没有匹配的在班学生。'));
      if (value.next)
        button(
          '下一页学生',
          async () => {
            cursor = value.next;
            await candidates();
          },
          roster,
        );
    };
    button(
      '搜索学生',
      async () => {
        query = search.value;
        cursor = null;
        await candidates();
      },
      searchBar,
    );
    const reason = g ? labelled(form, '调整原因', field('调整原因', '', 'textarea')) : null;
    if (reason) reason.required = true;
    const ack = check(form, '已核对小组名单及共享成果交接范围');
    ack.required = true;
    form.oninput = changed;
    const submit = el('button', g ? '保存小组名单' : '建立小组');
    submit.type = 'submit';
    form.append(submit);
    form.onsubmit = (e) => {
      e.preventDefault();
      void run(async () => {
        const result = await send({
          type: g ? 'SET_MEMBERS' : 'CREATE_GROUP',
          ...(g ? { id: g.id, revision: g.revision, reason: reason.value } : { projectId: p.id }),
          name: name.value,
          members: [...selected.keys()],
        });
        await go('group', result.id);
      });
    };
    showPicks();
    await candidates();
  };
  const loadProjects = async () => {
    const data = await api(current.after ? '?after=' + current.after : '');
    body.replaceChildren();
    if (teacher) projectForm();
    const list = panel('课程项目');
    for (const x of data.rows) {
      const card = panel('', list);
      card.append(
        el('h3', x.title),
        el(
          'p',
          `${x.state === 'OPEN' ? '开放' : x.state === 'CLOSED' ? '已关闭' : '草稿'} · 发布版本 ${x.published_version ?? '未发布'}`,
        ),
      );
      button('打开项目', () => go('project', x.id), card);
    }
    if (!data.rows.length)
      list.append(el('p', teacher ? '尚无项目，可在上方创建。' : '暂时没有已发布项目。'));
    pager(data.next, (n) => go('projects', null, n));
  };
  const loadProject = async () => {
    const data = await api(
      '?' +
        new URLSearchParams({
          project: current.id,
          ...(current.after ? { after: current.after } : {}),
        }),
    );
    body.replaceChildren();
    const p = data.project,
      box = panel(p.design?.title ?? data.version.design.title);
    const design = teacher ? p.design : data.version.design;
    tasks(box, design);
    box.append(
      el(
        'p',
        `状态 ${p.state} · 当前发布版本 ${p.published_version ?? '未发布'}；现有小组固定原版本。`,
        'pbl-note',
      ),
    );
    if (teacher) {
      const controls = el('div', undefined, 'pbl-row');
      box.append(controls);
      button(
        '发布项目版本',
        async () => {
          if (!discard()) return;
          await send({ type: 'PUBLISH_PROJECT', id: p.id, revision: p.revision });
          await load();
        },
        controls,
      );
      if (p.state !== 'DRAFT')
        button(
          p.state === 'OPEN' ? '关闭项目' : '重新开放',
          async () => {
            await send({
              type: p.state === 'OPEN' ? 'CLOSE_PROJECT' : 'REOPEN_PROJECT',
              id: p.id,
              revision: p.revision,
            });
            await load();
          },
          controls,
        );
      const edit = el('details');
      edit.append(el('summary', '编辑下一个发布草稿'));
      box.append(edit);
      projectForm(p, edit);
      if (p.state === 'OPEN') await groupForm(p);
    }
    const groups = panel(teacher ? '项目小组' : '我的小组与共同提交');
    for (const x of data.rows) {
      const card = panel('', groups);
      card.append(
        el('h3', x.name),
        el(
          'p',
          `${x.member_count ? x.member_count + ' 人' : '空组，保留历史'} · 固定项目版本 ${x.project_version}`,
        ),
      );
      button('进入小组', () => go('group', x.id), card);
    }
    if (!data.rows.length)
      groups.append(el('p', teacher ? '尚无小组。' : '教师尚未分组，或当前只可回看历史共同提交。'));
    pager(data.next, (n) => go('project', p.id, n));
  };
  const loadGroup = async () => {
    const data = await api(
      '?' +
        new URLSearchParams({
          group: current.id,
          ...(current.after ? { after: current.after } : {}),
        }),
    );
    body.replaceChildren();
    const g = data.group,
      v = data.version,
      box = panel(g.name);
    button('返回项目', () => go('project', g.project_id ?? data.project.id), box);
    box.append(
      el(
        'p',
        `${v.design.title} · 固定版本 ${v.version} · ${data.project.state === 'OPEN' ? '开放' : '已关闭'} · 截止：${v.deadline_at ? new Date(Number(v.deadline_at)).toLocaleString() : '不限'} · ${v.allow_resubmit ? '允许修改后重新确认并重交' : '仅允许一次提交'}`,
        'pbl-note',
      ),
    );
    if (data.members.length) {
      const list = el('ul');
      for (const m of data.members) {
        const ack = data.confirmations.find(
          (c) =>
            c.membership_id === m.membership_id &&
            c.enrollment_id === m.enrollment_id &&
            c.work_revision === g.work_revision &&
            c.membership_revision === g.membership_revision &&
            c.confirmed,
        );
        list.append(el('li', `${m.display_name} · ${ack ? '已确认当前成果' : '待确认'}`));
      }
      box.append(list);
    }
    if (g.work) {
      const status = el(
        'p',
        `共享成果版本 ${g.work_revision} · 名单版本 ${g.membership_revision}`,
        'pbl-note',
      );
      box.append(status);
      const work = panel('共同成果', box);
      tasks(work, v.design, data.canEdit ? null : g.work.answers);
      if (data.canEdit) {
        const form = el('form'),
          answers = {};
        work.append(form);
        for (const m of v.design.milestones)
          for (const t of m.microtasks) {
            const area = labelled(
              form,
              t.title + ' · 共同成果',
              field(t.title + ' · 共同成果', g.work.answers[t.id] ?? '', 'textarea'),
            );
            area.maxLength = 2000;
            answers[t.id] = area;
          }
        const reflection = labelled(
          form,
          '小组共同反思',
          field('小组共同反思', g.work.reflection, 'textarea'),
        );
        reflection.maxLength = 3000;
        form.oninput = (e) => {
          if (e.target instanceof HTMLTextAreaElement) changed();
        };
        const save = el('button', '保存共享成果');
        save.type = 'submit';
        form.append(save);
        form.onsubmit = (e) => {
          e.preventDefault();
          void run(async () => {
            await send({
              type: 'SAVE_WORK',
              id: g.id,
              revision: g.revision,
              work: {
                answers: Object.fromEntries(Object.entries(answers).map(([k, x]) => [k, x.value])),
                reflection: reflection.value,
              },
            });
            await load();
          });
        };
        const ack = check(form, '我已核对当前已保存成果，同意作为本组共同提交');
        button(
          '确认当前成果',
          async () => {
            if (dirty) {
              error.textContent = '请先保存共享成果，再确认。';
              return;
            }
            if (!ack.checked) {
              error.textContent = '请先勾选核对确认。';
              return;
            }
            await send({ type: 'CONFIRM_WORK', id: g.id, revision: g.revision });
            await load();
          },
          form,
        );
        button(
          '撤回我的确认',
          async () => {
            await send({ type: 'RETRACT_CONFIRMATION', id: g.id, revision: g.revision });
            await load();
          },
          form,
        );
        button(
          '提交全组已确认成果',
          async () => {
            if (dirty) {
              error.textContent = '有未保存内容，请先保存并重新确认。';
              return;
            }
            if (
              !confirm(
                `提交共享成果版本 ${g.work_revision}？提交后固定当前内容和成员；全员须已确认此版。`,
              )
            )
              return;
            const s = await send({ type: 'SUBMIT_GROUP', id: g.id, revision: g.revision });
            await go('submission', g.id + ':' + s.id);
          },
          form,
        );
      } else if (g.work) work.append(el('h3', '共同反思'), el('pre', g.work.reflection));
      const revisions = el('details');
      revisions.append(el('summary', '协作修订历史'));
      box.append(revisions);
      button('加载修订记录', () => loadRevisions(g.id, revisions), revisions);
    }
    if (teacher) await groupForm(data.project, g, data.members);
    const history = panel('正式共同提交与评价');
    for (const s of data.rows) {
      const item = panel('', history);
      item.append(
        el('h3', `第 ${s.version} 次共同提交`),
        el('p', `成果版本 ${s.work_revision} · ${s.members.map((m) => m.displayName).join('、')}`),
        el(
          'p',
          s.score === null || s.score === undefined ? '待教师评价' : `教师评价 ${s.score}/100`,
          'pbl-score',
        ),
      );
      button(
        teacher ? '查看并评价' : '查看成果与评价',
        () => go('submission', g.id + ':' + s.id),
        item,
      );
    }
    if (!data.rows.length) history.append(el('p', '尚无可见的正式共同提交。'));
    pager(data.next, (n) => go('group', g.id, n));
  };
  const loadRevisions = async (id, parent, after = null) => {
    const data = await api(
      '?' + new URLSearchParams({ group: id, kind: 'REVISIONS', ...(after ? { after } : {}) }),
    );
    const list = el('section');
    for (const r of data.rows) {
      const d = el('details');
      d.append(
        el('summary', `成果版本 ${r.work_revision} · ${r.author_name}`),
        el('pre', JSON.stringify(r.work, null, 2)),
      );
      list.append(d);
    }
    parent.append(list);
    pager(data.next, (n) => loadRevisions(id, parent, n), list);
  };
  const loadSubmission = async () => {
    const [group, id] = current.id.split(':');
    const data = await api(
      '?' +
        new URLSearchParams({
          group,
          submission: id,
          kind: 'EVALUATIONS',
          ...(current.after ? { after: current.after } : {}),
        }),
    );
    body.replaceChildren();
    const s = data.submission,
      box = panel(`${data.group.name} · 第 ${s.version} 次共同提交`);
    button('返回小组', () => go('group', group), box);
    box.append(
      el(
        'p',
        `固定成果版本 ${s.work_revision} · 名单版本 ${s.membership_revision} · ${s.members.map((m) => m.displayName).join('、')}`,
        'pbl-note',
      ),
    );
    tasks(box, data.version.design, s.work.answers);
    box.append(el('h3', '共同反思'), el('pre', s.work.reflection));
    const latest = data.evaluations[0],
      evals = panel('教师公开评价');
    for (const e of data.evaluations) {
      evals.append(el('h3', `评价版本 ${e.version} · ${e.score}/100`), el('pre', e.feedback));
      if (e.reason) evals.append(el('p', '更正原因：' + e.reason));
    }
    if (!latest) evals.append(el('p', '尚待教师评价。'));
    pager(data.next, (n) => go('submission', current.id, n), evals);
    if (teacher && !current.after) {
      const form = el('form');
      panel('发布／更正项目评价').append(form);
      form.append(
        el('p', '此为该次小组成果的教师评价，不自动写入个人活动成绩或课程总评。', 'pbl-note'),
      );
      const score = labelled(
        form,
        '项目评分（0–100）',
        field('项目评分（0–100）', latest?.score ?? '', 'number'),
      );
      score.min = '0';
      score.max = '100';
      score.required = true;
      const feedback = labelled(
        form,
        '公开评价',
        field('公开评价', latest?.feedback ?? '', 'textarea'),
      );
      feedback.required = true;
      feedback.maxLength = 4000;
      const reason = labelled(
        form,
        '更正原因（已有评价时必填）',
        field('更正原因（已有评价时必填）', '', 'textarea'),
      );
      reason.required = !!latest;
      reason.maxLength = 1000;
      const ack = check(form, '确认向本次共同提交成员发布评价');
      ack.required = true;
      const submit = el('button', latest ? '发布评价更正' : '发布教师评价');
      submit.type = 'submit';
      form.append(submit);
      form.oninput = changed;
      form.onsubmit = (e) => {
        e.preventDefault();
        void run(async () => {
          await send({
            type: 'PUBLISH_EVALUATION',
            id: s.id,
            revision: latest?.version ?? '0',
            score: Number(score.value),
            feedback: feedback.value,
            reason: reason.value,
          });
          await load();
        });
      };
    }
  };
  async function load() {
    if (dead) return;
    dirty = false;
    syncDirty();
    note.textContent = '';
    if (current.kind === 'projects') await loadProjects();
    else if (current.kind === 'project') await loadProject();
    else if (current.kind === 'group') await loadGroup();
    else await loadSubmission();
  }
  window.addEventListener('beforeunload', (e) => {
    if (!courseGuard && (dirty || pending)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a[href]');
      if (!courseGuard && a && (dirty || pending) && !discard()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  const stop = () => {
    dead = true;
    dirty = false;
    pending = null;
    syncDirty();
    for (const r of requests) r.abort();
    clearInterval(poll);
    channel?.close();
  };
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      stop();
      root.replaceChildren(el('p', '会话已变化，请返回工作台重新进入课程。'));
    };
  window.addEventListener('pagehide', stop, { once: true });
  const selectionFromHash = (h) => {
    const m = /^#(project|group|submission)-([0-9a-f:-]+)$/.exec(h);
    return m ? { kind: m[1], id: m[2], after: null } : { kind: 'projects', id: null, after: null };
  };
  async function adoptHash() {
    if (busy || queuedHash === null || dead) return;
    const target = queuedHash;
    queuedHash = null;
    if (pending || !discard()) {
      history.replaceState(null, '', location.pathname + location.search + lastHash);
      if (pending) error.textContent = '请先确认上一操作结果，再切换。';
      return;
    }
    current = selectionFromHash(target);
    lastHash = target;
    dirty = false;
    await run(load);
  }
  window.addEventListener('hashchange', () => {
    queuedHash = location.hash;
    void adoptHash();
  });
  current = selectionFromHash(location.hash);
  await run(load);
  poll = setInterval(() => {
    if (!dead && !busy && !dirty && !pending && !document.hidden && current.kind === 'group')
      void run(load);
  }, 7000);
})();
