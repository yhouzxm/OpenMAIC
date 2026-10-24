/* Basic classroom coordination. All permissions, target versions and state transitions are server checked. */
(() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const states = { DRAFT: '草稿', PUBLISHED: '已发布', ENDED: '已结束', ACTIVE: '当前任务' };
  window.zhibanClassrooms = {
    async render(tenant, offering, root, role, href) {
      const base = `/api/zhiban/learning/${tenant}/offerings/${offering.id}/classrooms`;
      let dead = false,
        busy = false,
        value = null,
        pending = null,
        timer = null,
        epoch = 0;
      const controllers = new Set();
      const editors = new Map();
      let guardDialog = null;
      const hasEdits = () => [...editors.values()].some((e) => e.dirty);
      const unloadGuard = (e) => {
        if (hasEdits()) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      const leaveGuard = (e) => {
        const target = e.target.closest?.('a[href],button');
        if (
          !target ||
          !hasEdits() ||
          target.closest('dialog') ||
          (root.contains(target) && target.tagName === 'BUTTON')
        )
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (guardDialog) return;
        const d = el('dialog');
        guardDialog = d;
        d.setAttribute('aria-label', '未保存课堂修改');
        d.append(el('p', '课堂修改尚未保存。取消可继续编辑，或明确放弃后离开。'));
        const stay = el('button', '取消离开，继续编辑课堂'),
          leave = el('button', '放弃课堂修改并离开');
        const close = () => {
          d.close();
          d.remove();
          guardDialog = null;
        };
        stay.onclick = close;
        leave.onclick = () => {
          editors.clear();
          close();
          target.click();
        };
        d.oncancel = (event) => {
          event.preventDefault();
          close();
        };
        d.append(stay, leave);
        document.body.append(d);
        d.showModal();
        stay.focus();
      };
      document.addEventListener('click', leaveGuard, true);
      window.addEventListener('beforeunload', unloadGuard);
      const localTime = (ms) =>
        ms === null
          ? ''
          : new Date(Number(ms))
              .toLocaleString('sv-SE', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              .replace(' ', 'T');
      const parseTime = (value) => {
        if (!value) return null;
        const n = new Date(value + ':00+08:00').getTime();
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(n) || n < 0)
          throw Error('请填写有效的北京时间，或留空表示不限。');
        return n;
      };
      const notice = el('p', undefined, 'notice');
      notice.setAttribute('role', 'status');
      const list = el('div'),
        tools = el('div', undefined, 'outline-toolbar');
      root.className = 'basic-classrooms';
      root.replaceChildren(
        el('h3', '基础课堂共享任务'),
        el('p', '派发已发布目录中的讲义或文字活动；进入记录不代表学习完成。', 'muted'),
        notice,
        tools,
        list,
      );
      const history = el('section');
      history.setAttribute('aria-label', role === 'teacher' ? '课堂结果汇总' : '我的课堂历史');
      root.append(history);
      let historyPage = 0,
        historyEpoch = 0;
      async function loadHistory(page = historyPage) {
        const version = ++historyEpoch;
        try {
          const data = await request(
            null,
            null,
            base.replace(/classrooms$/, 'classroom-results') + '?page=' + page,
          );
          if (!live() || version !== historyEpoch) return;
          historyPage = data.page;
          history.replaceChildren(
            el('h3', data.mode === 'TEACHER' ? '课堂结果汇总' : '我的课堂历史'),
          );
          history.append(
            el(
              'p',
              '按每次派发记录；提交与成绩均取该次尝试的最新提交及其已发布成绩。进入互动不代表完成。',
              'muted',
            ),
          );
          if (!data.rows.length) history.append(el('p', '暂无课堂记录。'));
          for (const row of data.rows) {
            const card = el('article', undefined, 'card');
            card.append(el('h4', row.classroom_title + ' · ' + row.title));
            card.append(
              el(
                'p',
                `${states[row.classroom_state]} · ${states[row.state] || row.state} · 固定版本 ${row.target_version}`,
              ),
            );
            if (data.mode === 'TEACHER') {
              card.append(
                el(
                  'p',
                  row.kind === 'ACTIVITY'
                    ? `已进入 ${row.entered} 人 · 已提交 ${row.submitted} 人 · 最新提交成绩已发布 ${row.published} 人 · 待提交 ${row.entered - row.submitted} 人 · 待发布 ${row.submitted - row.published} 人`
                    : `已进入 ${row.entered} 人；讲义进入记录不计完成率。`,
                ),
              );
              if (row.kind === 'ACTIVITY') {
                const a = el('a', '查看提交与评分');
                a.href = href('grades') + `#classroom-grading-${row.target_id}-${row.session_id}`;
                card.append(a);
              }
            } else if (row.own?.attemptId) {
              card.append(
                el(
                  'p',
                  row.own.submissionId
                    ? `已提交第 ${row.own.submissionVersion} 版 · ` +
                        (row.own.gradeVersion
                          ? `成绩 ${(Number(row.own.score) / 100).toFixed(2)}/${(Number(row.own.maxPoints) / 100).toFixed(2)}（发布第 ${row.own.gradeVersion} 版）`
                          : '该版成绩未发布')
                    : '已进入，尚未提交',
                ),
              );
              const a = el('a', '回看本次作答与成绩');
              a.href =
                href('coursework') +
                `&classroomTask=${row.id}&classroomAttempt=${row.own.attemptId}#classroom-activity-${row.target_id}-${row.target_version}-${row.session_id}`;
              card.append(a);
            } else card.append(el('p', '已进入；此记录不提供历史讲义内容，也不创建新尝试。'));
            history.append(card);
          }
          const controls = el('div', undefined, 'outline-toolbar');
          const prev = button('上一页课堂记录', () => loadHistory(historyPage - 1));
          prev.disabled = historyPage === 0;
          const next = button('下一页课堂记录', () => loadHistory(historyPage + 1));
          next.disabled = !data.hasMore || historyPage >= 9999;
          const refresh = button('刷新课堂记录', () => loadHistory());
          refresh.disabled = false;
          controls.append(prev, el('span', `课堂记录第 ${historyPage + 1} 页`), next, refresh);
          history.append(controls);
        } catch (e) {
          if (live() && version === historyEpoch) {
            history.replaceChildren(
              el('p', e.message),
              button('重试课堂记录', () => loadHistory()),
            );
          }
        }
      }
      const live = () => !dead && root.isConnected;
      async function request(command = null, key = null, path = base) {
        const c = new AbortController();
        controllers.add(c);
        const timeout = setTimeout(() => c.abort(), 10000);
        const headers = { 'x-zhiban-request': 'identity-v1' };
        try {
          if (command) {
            const r = await fetch('/api/zhiban/identity/csrf', {
              headers,
              cache: 'no-store',
              signal: c.signal,
            });
            if (!r.ok) throw Error('登录已失效，请重新登录。');
            headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
            headers['x-zhiban-command'] = key;
            headers['content-type'] = 'application/json';
          }
          const r = await fetch(path, {
            headers,
            cache: 'no-store',
            signal: c.signal,
            method: command ? 'POST' : 'GET',
            ...(command ? { body: JSON.stringify(command) } : {}),
          });
          const data = await r.json();
          if (!r.ok)
            throw Object.assign(
              Error(
                {
                  CONFLICT: '课堂已变化；编辑输入保留。请取消编辑后刷新，再重新修改。',
                  ATTEMPT_LIMIT: '已达到该活动的尝试次数上限，请查看已有作答。',
                  DEADLINE_PASSED: '该活动已截止，不能开始新的课堂作答。',
                  PROGRESS_BLOCKED:
                    '先修条件未满足或规则绑定的活动已换版。请查看课程目录中的学习进度；已有作答可继续。',
                  INVALID_STATE: '课堂已结束、尚未开放，或任务版本已失效。请刷新并由教师重新派发。',
                  FORBIDDEN: '当前任教或选课资格已失效。',
                  UNAUTHENTICATED: '登录已失效，请重新登录。',
                }[data.error?.code] ?? '课堂暂时不可用，请重试。',
              ),
              { definitive: r.status >= 400 && r.status < 500 },
            );
          return data;
        } finally {
          clearTimeout(timeout);
          controllers.delete(c);
        }
      }
      function button(label, fn) {
        const b = el('button', label, 'button secondary');
        b.type = 'button';
        b.disabled = busy || !!pending;
        b.onclick = () => void fn();
        return b;
      }
      async function load() {
        const version = ++epoch;
        const data = await request();
        if (!live() || version !== epoch) return;
        value = data;
        draw();
      }
      async function send() {
        if (!pending || busy) return;
        busy = true;
        epoch++;
        draw();
        const op = pending;
        try {
          const result = await request(op.command, op.key);
          pending = null;
          if (!live()) return;
          if (['EDIT_CLASSROOM', 'RESCHEDULE_CLASSROOM'].includes(op.command.type))
            editors.delete(op.command.id);
          notice.textContent = '课堂操作已保存。';
          if (op.command.type === 'ENTER_TASK') {
            if (result.labNotebookId) {
              location.assign(href('classroom-plan') + '#notebook-' + result.labNotebookId);
              return;
            }
            if (result.joint) {
              location.assign(
                `/api/zhiban/content/${tenant}/offerings/${offering.id}/resources/${result.interactiveId}/player?publication=${result.jointPublicationId}&dispatch=${result.dispatchId}`,
              );
              return;
            }
            if (result.kind === 'LECTURE' && /^[0-9a-f-]{36}$/.test(result.publicationId)) {
              location.assign(
                `/api/zhiban/content/${tenant}/offerings/${offering.id}/resources/${result.target}/player?publication=${result.publicationId}&classroom=${result.id}`,
              );
              return;
            }

            const section =
              result.kind === 'LECTURE'
                ? 'resources'
                : role === 'teacher'
                  ? 'classrooms'
                  : 'coursework';
            const fragment = result.kind === 'LECTURE' ? 'resource' : 'activity';
            location.assign(
              href(section) +
                (result.kind === 'ACTIVITY'
                  ? '&classroomTask=' + result.dispatchId + '&classroomAttempt=' + result.attemptId
                  : '') +
                `#classroom-${fragment}-${result.target}-${result.version}-${result.id}`,
            );
            return;
          }
          await load();
          await loadHistory();
        } catch (e) {
          if (e.definitive) pending = null;
          if (live()) {
            notice.textContent = e.message;
            if (!value || /资格|登录/.test(e.message)) {
              value = null;
              list.replaceChildren();
              tools.replaceChildren();
            }
          }
        } finally {
          busy = false;
          if (live()) draw();
        }
      }
      async function act(command) {
        if (busy || pending) return;
        if (editors.size && !['EDIT_CLASSROOM', 'RESCHEDULE_CLASSROOM'].includes(command.type)) {
          notice.textContent = '请先保存或取消课堂编辑，再执行其他课堂操作。';
          return;
        }
        pending = { command, key: crypto.randomUUID() };
        await send();
      }
      function field(form, label, type = 'text') {
        const l = el('label', label);
        const n = el('input');
        n.type = type;
        n.setAttribute('aria-label', label);
        n.disabled = busy || !!pending;
        l.append(n);
        form.append(l);
        return n;
      }
      const create = el('form', undefined, 'outline-add');
      const title = field(create, '新课堂标题');
      title.maxLength = 120;
      title.required = true;
      const description = field(create, '课堂说明');
      description.maxLength = 1000;
      const opens = field(create, '课堂开放时间（可选）', 'datetime-local'),
        closes = field(create, '课堂关闭时间（可选）', 'datetime-local');
      const save = el('button', '创建课堂草稿', 'button');
      save.type = 'submit';
      create.append(save);
      create.onsubmit = (e) => {
        e.preventDefault();
        void act({
          type: 'CREATE_CLASSROOM',
          title: title.value.trim(),
          description: description.value.trim(),
          opensAt: opens.value ? new Date(opens.value).getTime() : null,
          closesAt: closes.value ? new Date(closes.value).getTime() : null,
        });
      };
      function draw() {
        tools.replaceChildren();
        if (!value) return;
        const refresh = button('刷新课堂任务', async () => {
          if (editors.size) {
            notice.textContent = '编辑内容已保留，请先保存或取消编辑再刷新。';
            return;
          }
          try {
            await load();
            notice.textContent = '已同步最新课堂任务。';
          } catch (e) {
            notice.textContent = e.message;
            value = null;
            list.replaceChildren();
            tools.replaceChildren(refresh);
          }
        });
        tools.append(refresh);
        if (pending) {
          const retry = button('重试同一课堂操作', send);
          retry.disabled = busy;
          tools.append(retry);
        }
        if (value.mode === 'TEACHER') {
          create.querySelectorAll('input,button').forEach((n) => (n.disabled = busy || !!pending));
          tools.append(create);
        }
        list.replaceChildren();
        if (!value.sessions.length)
          list.append(
            el('p', value.mode === 'TEACHER' ? '尚未创建课堂。' : '当前没有开放的课堂。'),
          );
        value.sessions.forEach((s) => {
          const card = el('article', undefined, 'outline-chapter');
          card.dataset.classroom = s.id;
          card.append(
            el('h4', s.title),
            el('p', `${states[s.state]} · 版本 ${s.revision}`),
            el('p', s.description),
          );
          if (s.opens_at !== null || s.closes_at !== null)
            card.append(
              el(
                'p',
                `开放：${s.opens_at === null ? '不限' : new Date(Number(s.opens_at)).toLocaleString()}；关闭：${s.closes_at === null ? '不限' : new Date(Number(s.closes_at)).toLocaleString()}`,
              ),
            );
          const teacher = value.mode === 'TEACHER';
          const planLink = el(
            'a',
            teacher ? '编辑／运行课堂教案与实验' : '查看本课堂教案与实验',
            'button secondary',
          );
          planLink.href = href('classroom-plan') + '#classroom-' + s.id;
          if (value.flowEnabled) card.append(planLink);
          if (teacher && value.editingEnabled && s.state !== 'ENDED') {
            const draft = s.state === 'DRAFT',
              label = draft ? '编辑课堂草稿' : '调整开放时间';
            if (!editors.has(s.id))
              card.append(
                button(label, () => {
                  if (editors.size) {
                    notice.textContent = '请先保存或取消当前课堂编辑。';
                    return;
                  }
                  editors.set(s.id, {
                    revision: s.revision,
                    draft,
                    title: s.title,
                    description: s.description,
                    opens: localTime(s.opens_at),
                    closes: localTime(s.closes_at),
                    originalOpens: s.opens_at,
                    originalCloses: s.closes_at,
                    dirty: false,
                  });
                  draw();
                }),
              );
            else {
              const e = editors.get(s.id),
                form = el('form', undefined, 'outline-add');
              form.setAttribute('aria-label', label);
              form.append(
                el(
                  'p',
                  '时间按北京时间填写；留空表示不限。未结束课堂可调整已过期窗口；已有作答、提交和成绩保持。',
                  'muted',
                ),
              );
              const bind = (text, key, type = 'text') => {
                const input = field(form, text, type);
                input.value = e[key];
                input.oninput = () => {
                  e[key] = input.value;
                  e.dirty = true;
                };
                return input;
              };
              if (e.draft) {
                const t = bind('编辑课堂标题', 'title');
                t.required = true;
                t.maxLength = 120;
                const d = bind('编辑课堂说明', 'description');
                d.maxLength = 1000;
              }
              bind('编辑开放时间（北京时间，可选）', 'opens', 'datetime-local');
              bind('编辑关闭时间（北京时间，可选）', 'closes', 'datetime-local');
              const submit = el('button', e.draft ? '保存课堂草稿' : '保存开放时间', 'button');
              submit.type = 'submit';
              submit.disabled = busy || !!pending;
              form.append(
                submit,
                button('取消编辑并放弃修改', () => {
                  editors.delete(s.id);
                  draw();
                  notice.textContent = '已取消编辑，服务器内容未改变。';
                }),
              );
              form.onsubmit = (event) => {
                event.preventDefault();
                try {
                  void act({
                    type: e.draft ? 'EDIT_CLASSROOM' : 'RESCHEDULE_CLASSROOM',
                    id: s.id,
                    revision: e.revision,
                    ...(e.draft
                      ? { title: e.title.trim(), description: e.description.trim() }
                      : {}),
                    opensAt:
                      e.opens === localTime(e.originalOpens)
                        ? e.originalOpens === null
                          ? null
                          : Number(e.originalOpens)
                        : parseTime(e.opens),
                    closesAt:
                      e.closes === localTime(e.originalCloses)
                        ? e.originalCloses === null
                          ? null
                          : Number(e.originalCloses)
                        : parseTime(e.closes),
                  });
                } catch (error) {
                  notice.textContent = error.message;
                }
              };
              card.append(form);
            }
          }
          if (teacher && s.state === 'DRAFT')
            card.append(
              button('发布课堂', () =>
                act({ type: 'PUBLISH_CLASSROOM', id: s.id, revision: s.revision }),
              ),
            );
          if (
            teacher &&
            s.state === 'PUBLISHED' &&
            !['RUNNING', 'PAUSED'].includes(s.flow?.state)
          ) {
            const select = el('select');
            select.setAttribute('aria-label', `课堂 ${s.title} 派发目标`);
            select.disabled = busy || !!pending;
            const empty = el('option', '请选择已发布目录中的任务');
            empty.value = '';
            select.append(empty);
            value.choices.forEach((x, i) => {
              const o = el(
                'option',
                `${x.kind === 'LECTURE' ? '讲义' : '活动'} · ${x.title} · v${x.version}`,
              );
              o.value = String(i);
              select.append(o);
            });
            card.append(
              select,
              button('派发所选任务', () => {
                if (select.value === '') {
                  notice.textContent = '请选择已发布目录中的任务；尚无选项时先发布内容和目录。';
                  return;
                }
                return act({
                  type: 'DISPATCH_TASK',
                  id: s.id,
                  revision: s.revision,
                  ...((x) => ({ kind: x.kind, target: x.target, version: x.version }))(
                    value.choices[Number(select.value)],
                  ),
                });
              }),
            );
            if (value.jointEnabled) {
              const pair = el('fieldset');
              pair.append(el('legend', '联合派发：互动＋作答'));
              const interactive = el('select'),
                activity = el('select');
              interactive.setAttribute('aria-label', `课堂 ${s.title} 联合互动`);
              activity.setAttribute('aria-label', `课堂 ${s.title} 联合作答`);
              interactive.disabled = activity.disabled = busy || !!pending;
              for (const [select, kind, label] of [
                [interactive, 'LECTURE', '选择已发布互动'],
                [activity, 'ACTIVITY', '选择已发布作答活动'],
              ]) {
                const empty = el('option', label);
                empty.value = '';
                select.append(empty);
                value.choices.forEach((x, i) => {
                  if (x.kind === kind && (kind !== 'LECTURE' || x.interactive)) {
                    const option = el('option', `${x.title} · v${x.version}`);
                    option.value = String(i);
                    select.append(option);
                  }
                });
              }
              pair.append(
                interactive,
                activity,
                button('派发互动＋作答', () => {
                  if (interactive.value === '' || activity.value === '') {
                    notice.textContent = '请选择目录中的已发布互动和作答活动。';
                    return;
                  }
                  const resource = value.choices[Number(interactive.value)],
                    target = value.choices[Number(activity.value)];
                  return act({
                    type: 'DISPATCH_JOINT_TASK',
                    id: s.id,
                    revision: s.revision,
                    interactiveId: resource.target,
                    publicationId: resource.publicationId,
                    activityId: target.target,
                    activityVersion: target.version,
                  });
                }),
                el(
                  'p',
                  '固定当前互动与活动版本；学生进入时建立真实作答，重复进入沿用同一次尝试。',
                  'muted',
                ),
              );
              card.append(pair);
            }
            card.append(
              button('结束当前任务', () =>
                act({ type: 'END_TASK', id: s.id, revision: s.revision }),
              ),
              button('结束课堂', () =>
                act({ type: 'END_CLASSROOM', id: s.id, revision: s.revision }),
              ),
            );
          }
          s.tasks.forEach((d) => {
            const task = el('section', undefined, 'classroom-task');
            task.append(
              el(
                'h5',
                `${d.joint ? '互动＋作答' : d.interactive ? '互动' : d.kind === 'LECTURE' ? '讲义' : '活动'} · ${d.title} · v${d.target_version} · ${states[d.state]}`,
              ),
            );
            if (!d.available) task.append(el('p', '目标版本已失效，请教师重新派发。', 'notice'));
            if (teacher && d.kind === 'LECTURE' && d.state === 'ACTIVE' && d.available) {
              const position = el('div', undefined, 'outline-toolbar');
              position.append(el('p', `课堂讲义同步：第 ${d.current_page} / ${d.page_count} 页`));
              for (const [label, page] of [
                ['上一页讲义', d.current_page - 1],
                ['下一页讲义', d.current_page + 1],
              ]) {
                const move = button(label, () =>
                  act({
                    type: 'PRESENT_LECTURE_PAGE',
                    id: s.id,
                    revision: s.revision,
                    dispatchId: d.id,
                    presentationRevision: d.presentation_revision,
                    page,
                  }),
                );
                move.disabled = busy || !!pending || page < 1 || page > d.page_count;
                position.append(move);
              }
              const preview = el('a', '打开本次课堂讲义', 'button secondary');
              preview.href = `/api/zhiban/content/${tenant}/offerings/${offering.id}/resources/${d.target_id}/player?publication=${d.publicationId}&classroom=${s.id}`;
              position.append(preview);
              task.append(position);
            }
            if (!teacher && d.joint && !d.entered)
              task.append(
                el('p', '进入将开始或续接该活动的一次作答；重复进入不会新增尝试。', 'muted'),
              );
            if (!teacher && d.state === 'ACTIVE' && d.available)
              task.append(
                button(d.entered ? '继续课堂任务' : '进入课堂任务', () =>
                  act({ type: 'ENTER_TASK', id: s.id, revision: s.revision, dispatchId: d.id }),
                ),
              );
            if (teacher && d.joint) {
              const records = el('a', '查看联合任务可信记录', 'button secondary');
              records.href = `/api/zhiban/content/${tenant}/offerings/${offering.id}/resources/${d.joint.resourceId}/records`;
              task.append(
                records,
                el('p', '学生进入会固定关联此活动版本；互动操作不直接计为完成或成绩。', 'muted'),
              );
            }
            if (teacher) {
              task.append(el('p', `已进入 ${d.participants.length} 人（进入记录，不代表完成）`));
              d.participants.forEach((p) =>
                task.append(
                  el(
                    'p',
                    `${p.display_name || p.membership_id} · 已进入${d.kind === 'ACTIVITY' ? ` · 已提交 ${p.submissions} 份 · 已发布成绩 ${p.published_grades} 份` : ''}`,
                  ),
                ),
              );
              if (d.kind === 'ACTIVITY') {
                const a = el('a', '查看提交与人工评分', 'button secondary');
                a.href = href('grades') + `#classroom-grading-${d.target_id}-${s.id}`;
                task.append(a);
              }
            }
            if (d.flow)
              task.append(
                el(
                  'p',
                  `教案环节 ${d.flow.position + 1} · ${d.flow.state === 'PAUSED' ? '流程已暂停' : d.flow.state === 'RUNNING' ? '流程进行中' : '流程已结束'}；统一流程控制位于教案与实验页。`,
                ),
              );
            card.append(task);
          });
          list.append(card);
        });
        const focus = /^#classroom-([0-9a-f-]{36})$/.exec(location.hash);
        if (focus)
          list
            .querySelector(`[data-classroom="${focus[1]}"]`)
            ?.scrollIntoView({ block: 'nearest' });
      }
      try {
        await load();
        notice.textContent = '已同步课堂任务。';
      } catch (e) {
        notice.textContent = e.message;
      }
      await loadHistory();
      // Poll only the task panel. Activity answer controls are never replaced by this timer.
      if (value?.mode === 'STUDENT')
        timer = setInterval(() => {
          if (!busy && !pending && live() && !document.hidden)
            void load().catch((e) => {
              if (live()) {
                notice.textContent = e.message;
                value = null;
                historyEpoch++;
                history.replaceChildren();
                list.replaceChildren();
                tools.replaceChildren(
                  button('重新同步课堂', async () => {
                    try {
                      await load();
                    } catch (e) {
                      notice.textContent = e.message;
                    }
                  }),
                );
              }
            });
        }, 5000);
      return () => {
        dead = true;
        epoch++;
        historyEpoch++;
        clearInterval(timer);
        controllers.forEach((c) => c.abort());
        document.removeEventListener('click', leaveGuard, true);
        window.removeEventListener('beforeunload', unloadGuard);
        if (guardDialog) {
          guardDialog.close();
          guardDialog.remove();
          guardDialog = null;
        }
        editors.clear();
      };
    },
  };
})();
