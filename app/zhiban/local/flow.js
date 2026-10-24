(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('flow'),
    q = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = q.get('tenant'),
    offering = q.get('offering'),
    course = q.get('course'),
    role = q.get('role'),
    teacher = role === 'teacher';
  const uuid = /^[0-9a-f-]{36}$/;
  if (
    ![tenant, offering, course].every((v) => uuid.test(v ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '课程地址无效，请从课程工作区进入。';
    return;
  }
  const base = `/api/zhiban/flow/${tenant}/offerings/${offering}`,
    classBase = `/api/zhiban/learning/${tenant}/offerings/${offering}/classrooms`;
  const href = (part) =>
    `/zhiban/${role}/courses/${course}/${part}?space=${tenant}&offering=${offering}`;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const label = (name, input) => {
    const n = el('label', name);
    n.append(input);
    return n;
  };
  const input = (name, value = '', type = 'text') => {
    const n = el('input');
    n.type = type;
    n.value = String(value);
    n.setAttribute('aria-label', name);
    return n;
  };
  const select = (name, options) => {
    const n = el('select');
    n.setAttribute('aria-label', name);
    for (const [v, t] of options) n.append(new Option(t, v));
    return n;
  };
  const text = (name, value = '', max = 3000) => {
    const n = el('textarea');
    n.value = value;
    n.maxLength = max;
    n.setAttribute('aria-label', name);
    return n;
  };
  const button = (title, work) => {
    const b = el('button', title);
    b.type = 'button';
    b.onclick = () => void action(work);
    return b;
  };
  const link = (title, url) => {
    const a = el('a', title, 'button secondary');
    a.href = url;
    return a;
  };
  const notice = el('p', '', 'flow-note'),
    error = el('p', '', 'flow-error');
  error.setAttribute('role', 'alert');
  root.append(
    el('h1', '教案、课堂环节与实验'),
    el(
      'p',
      '课堂按固定发布教案逐环节派发。实验可选本人手填或固定模型服务端计算模拟，来源分别标记；正式结果仍由教师评分发布。',
      'flow-note',
    ),
    notice,
    error,
  );
  const toolbar = el('div', undefined, 'flow-toolbar'),
    body = el('section'),
    history = el('section', undefined, 'flow-panel');
  root.append(toolbar, body, history);
  const classroomSelect = select('选择课堂', [['', '选择课堂']]);
  toolbar.append(
    label('课堂', classroomSelect),
    button('刷新课堂与教案', () => loadAll()),
    link(teacher ? '创建或管理课堂' : '返回学习活动', href(teacher ? 'classrooms' : 'coursework')),
  );
  let dead = false,
    viewEpoch = 0,
    background = false,
    poll = null;
  let classrooms = [],
    choices = [],
    value = null,
    draft = [],
    dirty = false,
    busy = false,
    pending = null,
    selected = '',
    notebook = null,
    labDraft = null,
    labDirty = false,
    historyAfter = null,
    historyStack = [null],
    historyPage = 0;
  const markDirty = (on, lab = false) => {
    if (lab) labDirty = on;
    else dirty = on;
    window.zhibanCoursePage?.setDirty(lab ? 'flow-lab' : 'flow-plan', on, root);
  };
  const askLeave = () =>
    !(dirty || labDirty) || confirm('有未保存的教案或实验记录，确认放弃并切换？');
  const reportError = (e) => {
    error.textContent = e.message;
  };
  async function api(path, command = null, key = null) {
    if (dead) throw Error('会话已变化，请刷新页面。');
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (command) {
      const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
      if (!r.ok) throw Error('登录已失效，请返回工作台登录。');
      headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
      headers['x-zhiban-command'] = key;
      headers['content-type'] = 'application/json';
    }
    const r = await fetch(path, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      method: command ? 'POST' : 'GET',
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    const data = await r.json();
    if (dead) throw Error('会话已变化，请刷新页面。');
    if (!r.ok)
      throw Object.assign(
        Error(
          {
            CONFLICT: '版本已变化，输入保留。请核对当前课堂后重新操作。',
            PROGRESS_BLOCKED: '本环节的先修提交或已发布成绩条件尚未满足。',
            DEADLINE_PASSED: '活动已截止，不能再修改或提交。',
            ATTEMPT_LIMIT: '已达到该活动的尝试次数上限。',
            INVALID_INPUT: '内容格式或范围不正确，请核对数值、先修顺序及报告长度。',
            INVALID_STATE: '课堂已暂停／结束，或固定资源、活动版本已变化。实验报告须从本页提交。',
            FORBIDDEN: '当前任教或选课资格已失效。',
            NOT_FOUND: '该课堂或实验记录不在当前访问范围。',
            UNAVAILABLE: '当前功能尚未在此运行环境启用。',
            SERVICE_UNAVAILABLE: '服务暂不可用，请稍后刷新。',
          }[data.error?.code] ?? '操作未完成，请核对当前状态。',
        ),
        { definitive: r.status >= 400 && r.status < 500 },
      );
    return data;
  }
  async function action(work) {
    if (busy) return;
    busy = true;
    error.textContent = '';
    try {
      await work();
    } catch (e) {
      reportError(e);
    } finally {
      busy = false;
    }
  }
  async function post(command) {
    if (pending && JSON.stringify(pending.command) !== JSON.stringify(command))
      throw Error('上一次操作结果未确认，请先重试同一操作或核对最新状态。');
    pending ??= { command, key: crypto.randomUUID().replaceAll('-', '') };
    try {
      const r = await api(base, pending.command, pending.key);
      pending = null;
      return r;
    } catch (e) {
      if (e.definitive) pending = null;
      else error.textContent = '结果尚未确认，请点击“重试同一操作”。';
      throw e;
    }
  }
  toolbar.append(
    button('重试同一操作', async () => {
      if (!pending) {
        notice.textContent = '没有待确认操作。';
        return;
      }
      await post(pending.command);
      markDirty(false);
      markDirty(false, true);
      await loadAll();
    }),
  );
  classroomSelect.onchange = () =>
    void action(async () => {
      if (!askLeave()) {
        classroomSelect.value = selected;
        return;
      }
      markDirty(false);
      markDirty(false, true);
      selected = classroomSelect.value;
      notebook = null;
      await loadPlan();
    });
  async function loadAll() {
    if ((dirty || labDirty) && !confirm('刷新会放弃本页未保存内容，是否继续？')) return;
    markDirty(false);
    markDirty(false, true);
    const c = await api(classBase);
    classrooms = c.sessions;
    choices = c.choices ?? [];
    classroomSelect.replaceChildren(
      new Option('选择课堂', ''),
      ...classrooms.map((s) => new Option(s.title, s.id)),
    );
    if (!selected) {
      const hash = /^#classroom-([0-9a-f-]{36})$/.exec(location.hash);
      selected = hash?.[1] ?? '';
    }
    classroomSelect.value = selected;
    const hash = /^#notebook-([0-9a-f-]{36})$/.exec(location.hash);
    if (hash) await openNotebook(hash[1]);
    else await loadPlan();
    await loadHistory();
  }
  async function loadPlan() {
    if (!selected) {
      body.replaceChildren(el('p', '选择课堂查看已发布教案；实验历史仍可在下方查看。'));
      return;
    }
    const ticket = ++viewEpoch;
    const next = await api(base + '?classroom=' + selected);
    if (ticket !== viewEpoch || dead) return;
    value = next;
    draft = structuredClone(value.plan?.draft ?? []);
    notebook = null;
    renderPlan();
  }
  const kindNames = {
    LECTURE: '讲义／互动',
    ACTIVITY: '作答／测验',
    JOINT: '互动＋作答',
    LAB: '实验与报告',
  };
  function fieldsEditor(title, fields, minimum, onChange = () => {}) {
    const box = el('fieldset', undefined, 'flow-form');
    box.append(el('legend', title));
    const rows = el('div');
    box.append(rows);
    const draw = () => {
      rows.replaceChildren();
      fields.forEach((f, i) => {
        const r = el('div', undefined, 'flow-fields');
        for (const [k, name, type] of [
          ['key', '字段代号', 'text'],
          ['label', '名称', 'text'],
          ['unit', '单位', 'text'],
          ['min', '最小值', 'number'],
          ['max', '最大值', 'number'],
          ['initial', '初始值', 'number'],
        ]) {
          const n = input(`${title}第${i + 1}项${name}`, f[k], type);
          if (type === 'number') n.step = 'any';
          n.oninput = () => {
            f[k] = type === 'number' ? Number(n.value) : n.value;
          };
          r.append(label(name, n));
        }
        if (fields.length > minimum)
          r.append(
            button('删除该字段', async () => {
              fields.splice(i, 1);
              onChange();
              draw();
            }),
          );
        rows.append(r);
      });
    };
    draw();
    box.append(
      button('添加' + title, async () => {
        if (fields.length >= 10) throw Error('每组最多10项。');
        fields.push({
          key: 'field_' + (fields.length + 1),
          label: '',
          unit: '',
          min: -100000,
          max: 100000,
          initial: 0,
        });
        draw();
      }),
    );
    return box;
  }
  function renderPlan() {
    body.replaceChildren();
    const panel = el('article', undefined, 'flow-panel');
    body.append(panel);
    panel.append(el('h2', value.classroom.title));
    if (teacher && !value.run) {
      const editor = el('details');
      editor.open =
        !value.plan?.published_version || value.plan?.revision !== value.plan?.published_version;
      editor.append(el('summary', '编辑课堂教案'));
      const form = el('section', undefined, 'flow-form'),
        list = el('div');
      editor.append(form);
      panel.append(editor);
      const kinds = select('环节类型', Object.entries(kindNames)),
        target = select('环节目标', []),
        interactive = select('配对互动', []),
        title = input('环节标题');
      title.maxLength = 120;
      const requirePrior = select('先修环节', [['', '不设先修']]),
        requireKind = select('先修条件', [
          ['SUBMITTED', '已提交作答'],
          ['GRADE_AT_LEAST', '已发布成绩达到阈值'],
        ]),
        percent = input('先修成绩百分比', 60, 'number');
      percent.min = 0;
      percent.max = 100;
      const instructions = text('实验说明', '', 4000),
        conclusionPrompt = text('实验结论要求', '请结合测量结果解释现象、误差与改进。', 1000);
      let stepDirty = false;
      form.addEventListener('input', () => {
        stepDirty = true;
        markDirty(true);
      });
      let parameters = [],
        measurements = [
          { key: 'value', label: '测量值', unit: '', min: -100000, max: 100000, initial: 0 },
        ],
        editing = -1;
      let execution = null;
      const labMode = select('实验数据来源', [
        ['MANUAL', '学生手动记录'],
        ...(value.simulationModels ?? []).map((m) => [m.id, '服务端模拟：' + m.title]),
      ]);
      const labBox = el('section', undefined, 'flow-form');
      const drawLab = () => {
        labBox.replaceChildren(
          label('实验数据来源', labMode),
          label('实验说明', instructions),
          fieldsEditor('实验参数', parameters, 0, () => {
            stepDirty = true;
            markDirty(true);
          }),
          fieldsEditor('测量列', measurements, 1, () => {
            stepDirty = true;
            markDirty(true);
          }),
          label('实验结论要求', conclusionPrompt),
        );
        if (execution) {
          const model = (value.simulationModels ?? []).find((m) => m.id === execution.model);
          labBox.append(
            el(
              'p',
              (model?.formula ?? '固定模型') +
                ' 这是服务端计算模拟，不代表真实设备测量；下列字段由模型版本固定。',
              'flow-note',
            ),
          );
          for (const control of labBox.querySelectorAll('fieldset input,fieldset button'))
            control.disabled = true;
        }
      };
      labMode.onchange = () => {
        const model = (value.simulationModels ?? []).find((m) => m.id === labMode.value);
        execution = model ? { source: 'SERVER_CALCULATED_SIMULATION', model: model.id } : null;
        parameters = model ? structuredClone(model.parameters) : [];
        measurements = model
          ? structuredClone(model.measurements)
          : [{ key: 'value', label: '测量值', unit: '', min: -100000, max: 100000, initial: 0 }];
        if (model) instructions.value = model.formula;
        stepDirty = true;
        markDirty(true);
        drawLab();
      };
      drawLab();
      const refill = () => {
        const lecture = kinds.value === 'LECTURE';
        target.replaceChildren(
          ...choices
            .filter((c) => c.kind === (lecture ? 'LECTURE' : 'ACTIVITY'))
            .map((c) => new Option(c.title, `${c.target}:${c.version}`)),
        );
        interactive.replaceChildren(
          new Option('不关联互动', ''),
          ...choices
            .filter((c) => c.kind === 'LECTURE' && c.interactive)
            .map((c) => new Option(c.title, c.target)),
        );
        interactive.hidden = !['JOINT', 'LAB'].includes(kinds.value);
        labBox.hidden = kinds.value !== 'LAB';
      };
      kinds.onchange = refill;
      refill();
      const reset = () => {
        stepDirty = false;
        editing = -1;
        title.value = '';
        instructions.value = '';
        execution = null;
        labMode.value = 'MANUAL';
        parameters = [];
        measurements = [
          { key: 'value', label: '测量值', unit: '', min: -100000, max: 100000, initial: 0 },
        ];
        drawLab();
        markDirty(JSON.stringify(draft) !== JSON.stringify(value.plan?.draft ?? []));
      };
      const drawDraft = () => {
        list.replaceChildren();
        requirePrior.replaceChildren(
          new Option('不设先修', ''),
          ...draft.filter((s) => s.kind !== 'LECTURE').map((s) => new Option(s.title, s.id)),
        );
        draft.forEach((s, i) => {
          const card = el('article', undefined, 'flow-step');
          card.append(
            el('h3', `${i + 1}. ${s.title}`),
            el('p', `${kindNames[s.kind]} · 固定版本 ${s.version}`),
            el(
              'p',
              s.requires.length
                ? '先修：' +
                    s.requires
                      .map((r) => draft.find((x) => x.id === r.stepId)?.title ?? '无效环节')
                      .join('、')
                : '无先修限制',
              'flow-note',
            ),
          );
          card.append(
            button('编辑环节', async () => {
              editing = i;
              kinds.value = s.kind;
              refill();
              target.value = `${s.target}:${s.version}`;
              interactive.value = s.interactiveId ?? '';
              title.value = s.title;
              requirePrior.value = s.requires[0]?.stepId ?? '';
              requireKind.value = s.requires[0]?.kind ?? 'SUBMITTED';
              percent.value = String(s.requires[0]?.percent ?? 60);
              if (s.lab) {
                execution = s.lab.execution ? structuredClone(s.lab.execution) : null;
                labMode.value = execution?.model ?? 'MANUAL';
                parameters = structuredClone(s.lab.parameters);
                measurements = structuredClone(s.lab.measurements);
                instructions.value = s.lab.instructions;
                conclusionPrompt.value = s.lab.conclusionPrompt;
                drawLab();
              }
              form.scrollIntoView({ block: 'nearest' });
            }),
            button('删除环节', async () => {
              draft.splice(i, 1);
              for (const x of draft) x.requires = x.requires.filter((r) => r.stepId !== s.id);
              markDirty(true);
              drawDraft();
            }),
          );
          for (const [delta, name] of [
            [-1, '上移环节'],
            [1, '下移环节'],
          ])
            if (i + delta >= 0 && i + delta < draft.length)
              card.append(
                button(name, async () => {
                  const next = structuredClone(draft);
                  [next[i], next[i + delta]] = [next[i + delta], next[i]];
                  const removed = next.some((x, j) =>
                    x.requires.some((r) => !next.slice(0, j).some((p) => p.id === r.stepId)),
                  );
                  if (removed && !confirm('移动后不再位于前方的先修规则会清除，是否继续？')) return;
                  draft = next;
                  draft.forEach(
                    (x, j) =>
                      (x.requires = x.requires.filter((r) =>
                        draft.slice(0, j).some((p) => p.id === r.stepId),
                      )),
                  );
                  markDirty(true);
                  drawDraft();
                }),
              );
          list.append(card);
        });
      };
      drawDraft();
      form.append(
        label('环节类型', kinds),
        label('从已发布目录选择目标', target),
        label('配对互动（联合环节必选）', interactive),
        label('环节标题', title),
        label('先修环节', requirePrior),
        label('先修条件', requireKind),
        label('先修成绩百分比', percent),
        labBox,
        button('加入或更新环节', async () => {
          const [targetId, version] = target.value.split(':');
          const chosen = choices.find((c) => c.target === targetId && c.version === version);
          if (!chosen) throw Error('请先将讲义或活动加入已发布课程目录。');
          const paired = ['JOINT', 'LAB'].includes(kinds.value) ? interactive.value : null;
          if (kinds.value === 'JOINT' && !paired) throw Error('请选择配对互动。');
          const at = editing < 0 ? draft.length : editing;
          if (
            requirePrior.value &&
            !draft.slice(0, at).some((s) => s.id === requirePrior.value && s.kind !== 'LECTURE')
          )
            throw Error('先修必须来自前方的作答或实验环节。');
          const step = {
            id: editing < 0 ? crypto.randomUUID() : draft[editing].id,
            title: title.value.trim() || chosen.title,
            kind: kinds.value,
            target: targetId,
            version,
            interactiveId: paired || null,
            publicationId:
              kinds.value === 'LECTURE'
                ? chosen.publicationId
                : paired
                  ? choices.find((c) => c.target === paired).publicationId
                  : null,
            requires: requirePrior.value
              ? [
                  {
                    stepId: requirePrior.value,
                    kind: requireKind.value,
                    percent: requireKind.value === 'SUBMITTED' ? null : Number(percent.value),
                  },
                ]
              : [],
            lab:
              kinds.value === 'LAB'
                ? {
                    instructions: instructions.value,
                    parameters: structuredClone(parameters),
                    measurements: structuredClone(measurements),
                    conclusionPrompt: conclusionPrompt.value,
                    ...(execution ? { execution: structuredClone(execution) } : {}),
                  }
                : null,
          };
          if (editing < 0) draft.push(step);
          else draft[editing] = step;
          markDirty(true);
          reset();
          drawDraft();
        }),
        button('取消环节编辑', async () => reset()),
        list,
        button('保存教案草稿', async () => {
          if (stepDirty) throw Error('请先加入或更新正在编辑的环节，或取消环节编辑。');
          if (!draft.length) throw Error('至少需要一个环节。');
          await post({
            type: 'SAVE_PLAN',
            classroomId: selected,
            revision: value.plan?.revision ?? '0',
            steps: draft,
          });
          markDirty(false);
          await loadPlan();
          notice.textContent = '教案草稿已保存，尚未发布。';
        }),
        button('发布教案固定版本', async () => {
          if (dirty) throw Error('请先保存教案草稿，再发布。');
          if (!value.plan) throw Error('请先保存教案。');
          await post({
            type: 'PUBLISH_PLAN',
            classroomId: selected,
            revision: value.plan.revision,
          });
          await loadPlan();
          notice.textContent = '教案已发布；启动课堂前仍可另存并重新发布，已启动后保持固定版本。';
        }),
      );
    }
    const run = value.run,
      steps = value.steps ?? [];
    panel.append(
      el(
        'p',
        run
          ? `课堂流程：${{ RUNNING: '进行中', PAUSED: '暂停', FINISHED: '已结束', CANCELLED: '已取消' }[run.state]} · 教案版本 ${run.plan_version} · 环节 ${run.step_index + 1}/${steps.length}`
          : value.plan?.published_version
            ? `已发布教案版本 ${value.plan.published_version}，尚未启动。`
            : '尚无已发布教案。',
        'flow-note',
      ),
    );
    if (teacher) {
      const controls = el('div', undefined, 'flow-toolbar');
      if (
        !run &&
        value.plan?.published_version &&
        value.plan.revision === value.plan.published_version
      )
        controls.append(
          button('按教案开始课堂', async () => {
            await post({
              type: 'START_FLOW',
              classroomId: selected,
              planVersion: value.plan.published_version,
              classroomRevision: value.classroom.revision,
            });
            await loadPlan();
          }),
        );
      if (run && ['RUNNING', 'PAUSED'].includes(run.state)) {
        const transition = (type) => async () => {
          const reason = type === 'CANCEL_FLOW' ? prompt('请填写取消原因') : '';
          if (reason === null) return;
          await post({ type, classroomId: selected, revision: run.revision, reason });
          await loadPlan();
        };
        controls.append(
          button(
            run.state === 'PAUSED' ? '恢复当前环节' : '暂停课堂流程',
            transition(run.state === 'PAUSED' ? 'RESUME_FLOW' : 'PAUSE_FLOW'),
          ),
        );
        if (run.state === 'RUNNING' && run.step_index + 1 < steps.length)
          controls.append(button('派发下一环节', transition('NEXT_STEP')));
        if (run.step_index + 1 === steps.length)
          controls.append(button('结束教案流程', transition('FINISH_FLOW')));
        controls.append(button('取消教案流程', transition('CANCEL_FLOW')));
      }
      panel.append(controls);
    }
    steps.forEach((step, i) => {
      const card = el(
        'article',
        undefined,
        'flow-step' + (run?.step_index === i ? ' flow-current' : ''),
      );
      card.append(
        el('h3', `${i + 1}. ${step.title}`),
        el('p', kindNames[step.kind]),
        el(
          'p',
          step.requires.length
            ? '先修：' +
                step.requires
                  .map(
                    (r) =>
                      `${steps.find((s) => s.id === r.stepId)?.title}（${r.kind === 'SUBMITTED' ? '已提交' : '已发布成绩≥' + r.percent + '%'}）`,
                  )
                  .join('、')
            : '无先修限制',
          'flow-note',
        ),
      );
      if (step.lab) card.append(el('p', step.lab.instructions, 'flow-note'));
      const d = value.dispatches?.find((d) => d.position === i);
      if (d && run?.state === 'RUNNING' && run.step_index === i && d.state === 'ACTIVE') {
        if (!teacher)
          card.append(
            button(step.kind === 'LAB' ? '进入／继续本次实验' : '进入／继续本环节', async () => {
              if (step.kind === 'LAB') {
                const r = await post({
                  type: 'OPEN_LAB',
                  classroomId: selected,
                  dispatchId: d.dispatch_id,
                });
                await openNotebook(r.id);
              } else {
                const c = await api(classBase);
                const session = c.sessions.find((s) => s.id === selected);
                if (!session) throw Error('课堂当前不可进入。');
                const r = await api(
                  classBase,
                  {
                    type: 'ENTER_TASK',
                    id: selected,
                    revision: session.revision,
                    dispatchId: d.dispatch_id,
                  },
                  crypto.randomUUID().replaceAll('-', ''),
                );
                if (r.joint)
                  location.href = `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${r.interactiveId}/player?publication=${r.jointPublicationId}&dispatch=${r.dispatchId}`;
                else if (r.kind === 'LECTURE')
                  location.href = `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${r.target}/player?publication=${r.publicationId}&classroom=${selected}`;
                else
                  location.href =
                    href('coursework') +
                    `&classroomTask=${d.dispatch_id}&classroomAttempt=${r.attemptId}#classroom-activity-${r.target}-${r.version}-${selected}`;
              }
            }),
          );
        card.append(
          link(
            teacher ? '打开当前课堂与播放控制' : '打开课堂任务',
            href(teacher ? 'classrooms' : 'coursework') + '#classroom-' + selected,
          ),
        );
      } else if (d)
        card.append(
          el(
            'p',
            d.state === 'ENDED' ? '已结束；作答和报告从历史回看。' : '当前暂不可新进入。',
            'flow-note',
          ),
        );
      panel.append(card);
    });
  }
  async function openNotebook(id) {
    if (!askLeave()) return;
    const ticket = ++viewEpoch;
    const data = await api(base + '?notebook=' + id);
    if (ticket !== viewEpoch || dead) return;
    notebook = data;
    labDraft = {
      parameters: structuredClone(data.notebook.parameters),
      rows: structuredClone(data.notebook.measurements),
      conclusion: data.notebook.conclusion,
    };
    markDirty(false, true);
    window.history.replaceState(null, '', '#notebook-' + id);
    renderNotebook();
  }
  function renderNotebook() {
    body.replaceChildren();
    const { notebook: n, step } = notebook,
      spec = step.lab,
      readOnly = teacher || !n.writable,
      simulated = !!spec.execution;
    const panel = el('article', undefined, 'flow-panel flow-form');
    body.append(panel);
    panel.append(
      el('h2', step.title),
      el(
        'p',
        `实验记录版本 ${n.revision} · ${n.submission_id ? (String(n.submitted_revision) === n.revision ? '本版已正式提交' : '有未提交修改，保留上次提交') : '尚未提交'}`,
      ),
      el(
        'p',
        simulated
          ? '本页结果由固定版本模型在服务器计算，非真实设备测量。参数由学生选择，结论由本人填写；运行模拟不直接计完成或成绩。'
          : '本页数据由学生手动记录，不是 Native 自动采集、自动完成或自动评分证明。',
        'flow-note',
      ),
      el('p', spec.instructions, 'flow-report'),
    );
    for (const f of spec.parameters) {
      const x = input('实验参数 ' + f.label, labDraft.parameters[f.key], 'number');
      x.step = 'any';
      x.min = f.min;
      x.max = f.max;
      x.disabled = readOnly || (simulated && !n.simulation_can_run);
      x.oninput = () => {
        labDraft.parameters[f.key] = Number(x.value);
        markDirty(true, true);
      };
      panel.append(label(`${f.label}（${f.unit || '无单位'}，${f.min}–${f.max}）`, x));
    }
    if (simulated) {
      const model = notebook.simulationModels?.find((m) => m.id === spec.execution.model);
      panel.append(el('p', model?.formula ?? spec.execution.model, 'flow-note'));
      if (!readOnly) {
        const runButton = button('运行模拟并保存结果', async () => {
          await post({
            type: 'RUN_SIMULATION',
            id: n.id,
            revision: n.revision,
            attemptRevision: n.attempt_revision,
            parameters: labDraft.parameters,
            conclusion: labDraft.conclusion,
          });
          markDirty(false, true);
          await openNotebook(n.id);
          await loadHistory();
          notice.textContent = '模拟结果已由服务器计算并保存；请比较各次结果、填写结论后正式提交。';
        });
        runButton.disabled = !n.simulation_can_run || notebook.simulationRuns.length >= 50;
        panel.append(
          runButton,
          el(
            'p',
            n.simulation_can_run
              ? '修改参数后须再次运行。每份实验记录最多50次，全部运行保留；运行不会自动提交。'
              : '当前课堂暂停／结束或任务已切换：不能新增模拟，已保存结果仍可按原活动规则提交。',
            'flow-note',
          ),
        );
      }
      const runs = notebook.simulationRuns ?? [];
      if (runs.length) {
        const latest = runs.at(-1).parameters,
          dc = spec.execution.model === 'DC_OHM_V1';
        const same = runs.filter(
          (r) =>
            r.model_id === spec.execution.model &&
            (dc
              ? r.parameters.resistance === latest.resistance
              : ['voltage', 'resistance', 'capacitance'].every(
                  (k) => r.parameters[k] === latest[k],
                )),
        );
        const points = same.map((r) => ({
          x: r.parameters[dc ? 'voltage' : 'time'],
          y: r.result[dc ? 'current' : 'capacitor_voltage'],
          sequence: r.sequence,
        }));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 600 240');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', '已保存模拟结果对比');
        svg.style.width = '100%';
        svg.style.maxHeight = '260px';
        const add = (tag, attrs, text) => {
          const n = document.createElementNS(svg.namespaceURI, tag);
          for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
          if (text !== undefined) n.textContent = text;
          svg.append(n);
          return n;
        };
        const maxX = Math.max(1, ...points.map((p) => p.x)),
          maxY = Math.max(1, ...points.map((p) => p.y));
        add('path', { d: 'M 60 20 V 190 H 570', fill: 'none', stroke: '#64748b' });
        add('text', { x: 60, y: 218, 'font-size': 14 }, dc ? '电压 U / V' : '时间 t / s');
        add('text', { x: 8, y: 14, 'font-size': 14 }, dc ? '电流 I / A' : '电容电压 Vc / V');
        add('text', { x: 540, y: 208, 'font-size': 12 }, Number(maxX.toPrecision(5)));
        add('text', { x: 12, y: 35, 'font-size': 12 }, Number(maxY.toPrecision(5)));
        add('text', { x: 38, y: 205, 'font-size': 12 }, '0');
        for (const p of points) {
          const c = add('circle', {
            cx: 60 + (p.x / maxX) * 490,
            cy: 190 - (p.y / maxY) * 150,
            r: 5,
            fill: '#4f46e5',
          });
          const title = document.createElementNS(svg.namespaceURI, 'title');
          title.textContent = `运行${p.sequence}：${p.x} → ${p.y}`;
          c.append(title);
        }
        panel.append(
          el('h3', '已保存模拟结果对比'),
          el(
            'p',
            dc
              ? `相同电阻 ${latest.resistance} Ω 的已保存运行散点；原始数值见表。`
              : `相同电源 ${latest.voltage} V、电阻 ${latest.resistance} Ω、电容 ${latest.capacitance} μF 的已保存运行散点；原始数值见表。`,
            'flow-note',
          ),
          svg,
        );
      }
      const evidence = el('details');
      evidence.append(el('summary', '模拟来源与每次输入'));
      for (const run of notebook.simulationRuns ?? [])
        evidence.append(
          el('p', `第${run.sequence}次 · ${run.model_id} · 服务端计算模拟`),
          el('p', '输入：' + JSON.stringify(run.parameters)),
          el('p', '结果：' + JSON.stringify(run.result)),
          el(
            'p',
            `运行编号 ${run.id}；模型摘要 ${run.model_sha256}；执行器源码摘要 ${run.executor_source_sha256}；结果摘要 ${run.output_sha256}`,
            'flow-note',
          ),
        );
      panel.append(evidence);
    }
    const grid = el('div', undefined, 'flow-table'),
      table = el('table'),
      head = el('tr');
    head.append(el('th', '序号'));
    for (const f of spec.measurements) head.append(el('th', `${f.label}（${f.unit || '无单位'}）`));
    head.append(el('th', '备注'));
    table.append(head);
    grid.append(table);
    panel.append(grid);
    labDraft.rows.forEach((row, i) => {
      const tr = el('tr');
      tr.append(el('td', String(i + 1)));
      for (const f of spec.measurements) {
        const td = el('td'),
          x = input(`第${i + 1}行 ${f.label}`, row.values[f.key], 'number');
        x.step = 'any';
        x.min = f.min;
        x.max = f.max;
        x.disabled = readOnly || simulated;
        x.oninput = () => {
          row.values[f.key] = Number(x.value);
          markDirty(true, true);
        };
        td.append(x);
        tr.append(td);
      }
      const td = el('td'),
        note = input(`第${i + 1}行备注`, row.note);
      note.maxLength = 300;
      note.disabled = readOnly || simulated;
      note.oninput = () => {
        row.note = note.value;
        markDirty(true, true);
      };
      td.append(note);
      if (!readOnly && !simulated)
        td.append(
          button('删除此行', async () => {
            labDraft.rows.splice(i, 1);
            markDirty(true, true);
            renderNotebook();
          }),
        );
      tr.append(td);
      table.append(tr);
    });
    if (!readOnly && !simulated)
      panel.append(
        button('增加一行测量', async () => {
          if (labDraft.rows.length >= 50) throw Error('最多50行测量。');
          labDraft.rows.push({
            values: Object.fromEntries(spec.measurements.map((f) => [f.key, f.initial])),
            note: '',
          });
          markDirty(true, true);
          renderNotebook();
        }),
      );
    const conclusion = text('实验结论', labDraft.conclusion, 3000);
    conclusion.disabled = readOnly;
    conclusion.oninput = () => {
      labDraft.conclusion = conclusion.value;
      markDirty(true, true);
    };
    panel.append(
      el('p', spec.conclusionPrompt, 'flow-note'),
      label('实验结论（最多3000字）', conclusion),
    );
    if (!readOnly) {
      const save = (type) => async () => {
        if (
          type === 'SUBMIT_LAB' &&
          !confirm(
            simulated
              ? '确认正式提交服务器已保存的模拟结果及本人结论？未运行的参数修改不能提交，成绩须教师发布。'
              : '确认正式提交当前参数、测量记录和结论？本次提交会固定保存；可否重交仍按原活动规则，成绩须教师发布。',
          )
        )
          return;
        await post({
          type,
          id: n.id,
          revision: n.revision,
          attemptRevision: n.attempt_revision,
          ...labDraft,
        });
        markDirty(false, true);
        await openNotebook(n.id);
        await loadHistory();
        notice.textContent =
          type === 'SAVE_LAB' ? '实验记录已保存。' : '实验报告已正式提交，等待教师评分。';
      };
      panel.append(
        button('保存实验记录', save('SAVE_LAB')),
        button('正式提交实验报告', save('SUBMIT_LAB')),
      );
    }
    if (n.submission_id)
      panel.append(
        link(
          teacher ? '前往原评分入口' : '查看本次作答与成绩',
          teacher
            ? href('grades') + `#classroom-grading-${step.target}-${n.classroom_id}`
            : href('coursework') +
                `&classroomTask=${n.dispatch_id}&classroomAttempt=${n.attempt_id}#classroom-activity-${step.target}-${step.version}-${n.classroom_id}`,
        ),
      );
    if (step.interactiveId)
      panel.append(
        link(
          '打开本实验固定互动',
          `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${step.interactiveId}/player?publication=${step.publicationId}&dispatch=${n.dispatch_id}`,
        ),
      );
    if (notebook.reports?.length) {
      const box = el('section', undefined, 'flow-panel');
      box.append(el('h3', '正式提交版本与已发布成绩'));
      for (const r of notebook.reports) {
        const d = el('details');
        d.append(
          el(
            'summary',
            `记录版本 ${r.notebook_revision} · ${r.grade_version ? `成绩 ${(Number(r.score_points) / 100).toFixed(2)}/${(Number(r.max_points) / 100).toFixed(2)}（发布第${r.grade_version}版）` : '成绩未发布'}`,
          ),
          el(
            'p',
            simulated
              ? `来源：服务端计算模拟；固定运行 ${(r.simulationRunIds ?? []).length} 次`
              : '来源：学生手动记录',
            'flow-note',
          ),
          el('p', r.conclusion, 'flow-report'),
        );
        for (const [i, row] of r.measurements.entries())
          d.append(
            el(
              'p',
              `${i + 1}. ${spec.measurements.map((f) => `${f.label}=${row.values[f.key]} ${f.unit}`).join('；')}${row.note ? '；' + row.note : ''}`,
              'flow-note',
            ),
          );
        if (r.feedback) d.append(el('p', '教师反馈：' + r.feedback));
        if (r.reason) d.append(el('p', '成绩更正原因：' + r.reason));
        box.append(d);
      }
      if (notebook.reportNext)
        box.append(
          button('更早的正式提交', async () => {
            const older = await api(base + '?notebook=' + n.id + '&after=' + notebook.reportNext);
            notebook.reports.push(...older.reports);
            notebook.reportNext = older.reportNext;
            renderNotebook();
          }),
        );
      panel.append(box);
    }
    panel.append(
      button('返回课堂教案', async () => {
        if (!askLeave()) return;
        markDirty(false, true);
        selected = n.classroom_id;
        classroomSelect.value = selected;
        window.history.replaceState(null, '', '#classroom-' + selected);
        await loadPlan();
      }),
    );
  }
  async function loadHistory() {
    const r = await api(base + (historyAfter ? '?after=' + historyAfter : ''));
    history.replaceChildren(el('h2', teacher ? '教学班实验报告' : '我的实验历史'));
    for (const n of r.rows) {
      const card = el('article', undefined, 'flow-step');
      card.append(
        el('h3', n.title),
        el('p', `${n.classroom_title} · ${n.submission_id ? '已提交' : '未提交'}`),
        button(teacher ? '查看实验数据' : '继续／回看实验记录', () => openNotebook(n.id)),
      );
      history.append(card);
    }
    if (!r.rows.length) history.append(el('p', '暂无实验记录。'));
    const controls = el('div', undefined, 'flow-toolbar');
    if (historyPage > 0)
      controls.append(
        button('上一页实验记录', async () => {
          historyAfter = historyStack[--historyPage];
          await loadHistory();
        }),
      );
    if (r.next)
      controls.append(
        button('下一页实验记录', async () => {
          historyAfter = r.next;
          historyStack[++historyPage] = r.next;
          await loadHistory();
        }),
      );
    history.append(controls);
  }
  window.addEventListener('hashchange', () => {
    const n = /^#notebook-([0-9a-f-]{36})$/.exec(location.hash);
    if (n) void action(() => openNotebook(n[1]));
  });
  const stop = () => {
    dead = true;
    viewEpoch++;
    if (poll) clearInterval(poll);
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
  try {
    await loadAll();
    root.setAttribute('aria-busy', 'false');
    if (!teacher)
      poll = setInterval(() => {
        if (
          dead ||
          background ||
          busy ||
          pending ||
          dirty ||
          labDirty ||
          notebook ||
          !selected ||
          document.hidden ||
          !root.isConnected
        )
          return;
        background = true;
        void loadPlan()
          .catch(reportError)
          .finally(() => {
            background = false;
          });
      }, 5000);
  } catch (e) {
    reportError(e);
  }
})();
