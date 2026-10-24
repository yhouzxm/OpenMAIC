/* Same-origin academic workspace; every action is authorized again by the server. */
(() => {
  const el = (tag, text, className) => {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  };
  const errors = {
    FORBIDDEN: '当前身份无法进行此操作，请刷新空间。',
    INVALID_INPUT: '请检查输入；编号使用英文字母、数字或短横线。',
    CONFLICT: '数据已变更或编号重复，请刷新后重试。',
    CAPACITY_FULL: '教学班已满，操作没有完成。',
    INACTIVE_MEMBER: '该成员当前不可用。',
    INVALID_STATE: '请检查课程发布状态及教学班状态。',
    NOT_FOUND: '记录已不可用，请刷新。',
  };
  window.zhibanAcademic = {
    async render(tenant, root) {
      if (window.zhibanWorkspace && (await window.zhibanWorkspace.render(tenant, root))) return;
      let state,
        tab = 'offerings',
        busy = false;
      const request = async (command) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (command) {
          const proof = await fetch('/api/zhiban/identity/csrf', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers,
          });
          if (!proof.ok) throw new Error('登录已失效，请重新登录。');
          headers['x-zhiban-csrf'] = (await proof.json()).csrfToken;
          headers['x-zhiban-command'] = crypto.randomUUID().replaceAll('-', '');
          headers['Content-Type'] = 'application/json';
        }
        const response = await fetch(`/api/zhiban/academic/${tenant}`, {
          method: command ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers,
          body: command ? JSON.stringify(command) : undefined,
          signal: AbortSignal.timeout(10000),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            errors[result.error?.code] || '操作结果暂时无法确认，请刷新查看后再操作。',
          );
        return result;
      };
      const notice = (text) => {
        const p = el('p', text, 'notice');
        p.setAttribute('role', 'alert');
        root.prepend(p);
      };
      const action = async (command) => {
        if (busy) return;
        busy = true;
        root.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          state = await request(command);
          draw();
        } catch (error) {
          notice(error.message);
        } finally {
          busy = false;
          root.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      };
      const button = (label, callback) => {
        const b = el('button', label, 'button secondary');
        b.type = 'button';
        b.onclick = callback;
        return b;
      };
      const people = (role) =>
        state.people
          .filter((p) => p.status === 'ACTIVE' && p.roles?.includes(role))
          .map((p) => [p.membership_id, p.display_name]);
      const person = (id) => state.people.find((p) => p.membership_id === id)?.display_name || id;
      const form = (parent, title, fields, command) => {
        const details = el('details', undefined, 'academic-form');
        details.append(el('summary', title));
        const f = el('form'),
          controls = {};
        for (const [name, label, type, initial = '', options] of fields) {
          const l = el('label', label),
            input = el(type === 'select' ? 'select' : 'input');
          input.name = name;
          input.setAttribute('aria-label', label);
          if (type === 'select') {
            for (const [value, text] of options || []) {
              const o = el('option', text);
              o.value = value;
              input.append(o);
            }
          } else {
            input.type = type;
            input.maxLength = name === 'description' ? 2000 : 120;
          }
          input.value = initial;
          input.required = ![
            'description',
            'ownerMembershipId',
            'classId',
            'membershipIdOptional',
          ].includes(name);
          if (type === 'number') {
            input.min = '1';
            input.max = '1000';
          }
          controls[name] = input;
          l.append(input);
          f.append(l);
        }
        const submit = el('button', '保存', 'button primary');
        submit.type = 'submit';
        f.append(submit);
        f.onsubmit = (event) => {
          event.preventDefault();
          const values = Object.fromEntries(
            fields.map(([name, , type]) => [
              name,
              type === 'number' ? Number(controls[name].value) : controls[name].value.trim(),
            ]),
          );
          void action(command(values));
        };
        details.append(f);
        parent.append(details);
      };
      const text = (key, label, value = '') => [key, label, 'text', value];
      const select = (key, label, options, value = '') => [
        key,
        label,
        'select',
        value || options[0]?.[0] || '',
        options,
      ];
      const box = (parent, title, description) => {
        const b = el('article', undefined, 'card academic-card');
        b.append(el('h3', title));
        if (description) b.append(el('p', description, 'muted'));
        parent.append(b);
        return b;
      };
      const directoryEntry = () => {
        const a = el('a', '学生目录', 'button secondary');
        a.href = '/zhiban/directory?tenant=' + tenant;
        return a;
      };
      const managementEntry = () => {
        const a = el('a', '教务管理（分页）', 'button secondary');
        a.href = '/zhiban/management?tenant=' + tenant;
        return a;
      };
      const draw = () => {
        if (!root.isConnected) return;
        root.replaceChildren();
        const admin = state.mode === 'ADMIN';
        const bar = el('div', undefined, 'workspace-header');
        bar.append(
          el('h2', admin ? '教务管理' : '我的课程'),
          button('刷新课程', () => void action()),
        );
        if (admin) bar.append(directoryEntry(), managementEntry());
        root.append(bar);
        if (admin) {
          const nav = el('nav', undefined, 'academic-tabs');
          for (const [key, name] of [
            ['offerings', '教学班'],
            ['courses', '课程'],
            ['terms', '学期'],
            ['classes', '行政班'],
          ]) {
            const b = button(name, () => {
              tab = key;
              draw();
            });
            b.setAttribute('aria-pressed', String(tab === key));
            nav.append(b);
          }
          root.append(nav);
        }
        const list = el('div', undefined, 'academic-grid');
        root.append(list);
        if (!admin || tab === 'offerings') {
          if (admin) {
            const b = box(list, '开设教学班', '先创建学期并发布课程，再指定任教教师和学生。');
            form(
              b,
              '新建教学班',
              [
                select(
                  'courseId',
                  '课程',
                  state.courses.filter((c) => c.status === 'PUBLISHED').map((c) => [c.id, c.name]),
                ),
                select(
                  'termId',
                  '学期',
                  state.terms.map((t) => [t.id, t.name]),
                ),
                select('classId', '关联行政班（可选）', [
                  ['', '无'],
                  ...state.classes.map((c) => [c.id, c.name]),
                ]),
                text('code', '教学班编号'),
                text('name', '教学班名称'),
                ['capacity', '容量', 'number', 30],
              ],
              (v) => ({ type: 'CREATE_OFFERING', ...v, classId: v.classId || null }),
            );
          }
          if (!state.offerings.length)
            list.append(
              el('p', '暂无可访问的教学班。管理员添加任教或选课后，课程会出现在这里。', 'muted'),
            );
          for (const o of state.offerings) {
            const c = state.courses.find(
              (c) => c.id === o.course_id && (admin || c.published_version === o.course_version),
            );
            const b = box(
              list,
              o.name,
              `${o.course_name || c?.name || '课程'} · 发布版本 ${o.course_version} · ${state.terms.find((t) => t.id === o.term_id)?.name || ''}`,
            );
            b.append(
              el(
                'p',
                `${o.status === 'OPEN' ? '开放' : '已关闭'} · ${o.enrolled_count}/${o.capacity} 人`,
              ),
            );
            if (o.course_description) b.append(el('p', o.course_description, 'muted'));
            if (admin) {
              const importer = el('a', '批量导入学生名册', 'button secondary roster-entry');
              importer.href = '/zhiban/roster?tenant=' + tenant + '&offering=' + o.id;
              b.append(importer);
              form(
                b,
                '修改教学班',
                [
                  text('name', '名称', o.name),
                  ['capacity', '容量', 'number', o.capacity],
                  select(
                    'status',
                    '状态',
                    [
                      ['OPEN', '开放'],
                      ['CLOSED', '关闭'],
                    ],
                    o.status,
                  ),
                ],
                (v) => ({ type: 'UPDATE_OFFERING', id: o.id, revision: o.revision, ...v }),
              );
              form(b, '指定任教教师', [select('membershipId', '教师', people('TEACHER'))], (v) => ({
                type: 'ASSIGN_TEACHER',
                offeringId: o.id,
                ...v,
                revision:
                  state.assignments.find(
                    (a) => a.offering_id === o.id && a.membership_id === v.membershipId,
                  )?.revision || null,
              }));
              for (const a of state.assignments.filter(
                (a) => a.offering_id === o.id && a.status === 'ACTIVE',
              )) {
                const row = el('p', `任教 · ${person(a.membership_id)} `);
                row.append(
                  button(
                    '结束任教',
                    () => void action({ type: 'END_TEACHER', id: a.id, revision: a.revision }),
                  ),
                );
                b.append(row);
              }
              form(b, '添加学生', [select('membershipId', '学生', people('STUDENT'))], (v) => ({
                type: 'ENROLL',
                offeringId: o.id,
                ...v,
                revision:
                  state.enrollments.find(
                    (e) => e.offering_id === o.id && e.membership_id === v.membershipId,
                  )?.revision || null,
              }));
            }
            if (!admin) {
              const a = el('a', '教学内容 · 编辑与预览', 'button secondary content-entry');
              a.href = '/zhiban/content?tenant=' + tenant + '&offering=' + o.id;
              b.append(a);
            }
            if (state.mode === 'STUDENT') {
              const overview = el('a', '我的学习概览', 'button secondary progress-entry');
              overview.href = '/zhiban/progress?tenant=' + tenant + '&offering=' + o.id;
              b.append(overview);
            }
            if (state.mode === 'TEACHER') {
              const statistics = el('a', '教师统计', 'button secondary analytics-entry');
              statistics.href = '/zhiban/analytics?tenant=' + tenant + '&offering=' + o.id;
              b.append(statistics);
            }
            if (!admin && window.zhibanLearning) {
              const section = el('details', undefined, 'learning-section');
              section.append(el('summary', '学习活动与提交'));
              const learning = el('div', undefined, 'learning-panel');
              section.append(learning);
              let loaded = false;
              section.addEventListener('toggle', () => {
                if (section.open && !loaded) {
                  loaded = true;
                  void window.zhibanLearning.render(tenant, o, learning, person);
                }
              });
              b.append(section);
            }
            const roster = state.enrollments.filter(
              (e) => e.offering_id === o.id && e.status === 'ACTIVE',
            );
            b.append(el('h4', admin || state.mode === 'TEACHER' ? '学生名单' : '我的选课'));
            for (const e of roster) {
              const row = el('div', undefined, 'academic-roster');
              row.append(el('span', person(e.membership_id)));
              if (admin) {
                row.append(
                  button(
                    '移出学生',
                    () => void action({ type: 'WITHDRAW', id: e.id, revision: e.revision }),
                  ),
                );
                form(
                  row,
                  '转班',
                  [
                    select(
                      'targetOfferingId',
                      '目标教学班',
                      state.offerings
                        .filter(
                          (t) =>
                            t.id !== o.id &&
                            t.course_id === o.course_id &&
                            t.term_id === o.term_id &&
                            t.status === 'OPEN',
                        )
                        .map((t) => [t.id, t.name]),
                    ),
                  ],
                  (v) => ({
                    type: 'TRANSFER',
                    id: e.id,
                    revision: e.revision,
                    ...v,
                    targetRevision:
                      state.enrollments.find(
                        (t) =>
                          t.offering_id === v.targetOfferingId &&
                          t.membership_id === e.membership_id,
                      )?.revision || null,
                  }),
                );
              }
              b.append(row);
            }
          }
        } else if (tab === 'courses') {
          const ownerOptions = [['', '未指定'], ...people('TEACHER')];
          const b = box(list, '课程库', '课程发布后生成固定版本；教学班使用开班时的发布版本。');
          const courseFields = (c) => [
            text('name', '课程名称', c?.name),
            text('description', '课程简介', c?.description),
            select('ownerMembershipId', '课程负责人（可选）', ownerOptions, c?.owner_membership_id),
          ];
          form(b, '新建课程', [text('code', '课程编号'), ...courseFields()], (v) => ({
            type: 'CREATE_COURSE',
            ...v,
            ownerMembershipId: v.ownerMembershipId || null,
          }));
          for (const c of state.courses) {
            const b = box(
              list,
              c.name,
              `${c.code} · ${c.status === 'DRAFT' ? '草稿' : c.status === 'PUBLISHED' ? '已发布' : '已归档'} · 版本 ${c.published_version}`,
            );
            b.append(el('p', c.description));
            if (c.status !== 'ARCHIVED') {
              form(b, '编辑草稿', courseFields(c), (v) => ({
                type: 'EDIT_COURSE',
                id: c.id,
                revision: c.revision,
                ...v,
                ownerMembershipId: v.ownerMembershipId || null,
              }));
              if (c.status === 'DRAFT')
                b.append(
                  button(
                    '发布课程',
                    () => void action({ type: 'PUBLISH_COURSE', id: c.id, revision: c.revision }),
                  ),
                );
              b.append(
                button(
                  '归档课程',
                  () => void action({ type: 'ARCHIVE_COURSE', id: c.id, revision: c.revision }),
                ),
              );
            }
          }
        } else if (tab === 'terms') {
          const b = box(list, '学期', '设置教学班所属学期。');
          form(
            b,
            '新建学期',
            [
              text('code', '学期编号'),
              text('name', '学期名称'),
              ['startsOn', '开始日期', 'date'],
              ['endsOn', '结束日期', 'date'],
            ],
            (v) => ({ type: 'CREATE_TERM', ...v }),
          );
          for (const t of state.terms)
            box(list, t.name, `${t.code} · ${t.starts_on} 至 ${t.ends_on}`);
        } else {
          const b = box(list, '行政班', '行政班归属与课程选课分别管理。');
          form(b, '新建行政班', [text('code', '行政班编号'), text('name', '行政班名称')], (v) => ({
            type: 'CREATE_CLASS',
            ...v,
          }));
          for (const c of state.classes) {
            const b = box(list, c.name, c.code);
            b.append(
              el('p', `班主任 · ${c.head_teacher_id ? person(c.head_teacher_id) : '未指定'}`),
            );
            form(
              b,
              '设置班主任',
              [
                select(
                  'membershipIdOptional',
                  '班主任',
                  [['', '未指定'], ...people('TEACHER')],
                  c.head_teacher_id,
                ),
              ],
              (v) => ({
                type: 'CLASS_HEAD_TEACHER',
                id: c.id,
                revision: c.revision,
                membershipId: v.membershipIdOptional || null,
              }),
            );
            form(b, '添加行政班学生', [select('membershipId', '学生', people('STUDENT'))], (v) => ({
              type: 'CLASS_MEMBER',
              classId: c.id,
              ...v,
              active: true,
              revision:
                state.classMembers.find(
                  (m) => m.class_id === c.id && m.membership_id === v.membershipId,
                )?.revision || null,
            }));
            for (const m of state.classMembers.filter((m) => m.class_id === c.id && m.active)) {
              const row = el('p', person(m.membership_id) + ' ');
              row.append(
                button(
                  '移出行政班',
                  () =>
                    void action({
                      type: 'CLASS_MEMBER',
                      classId: c.id,
                      membershipId: m.membership_id,
                      active: false,
                      revision: m.revision,
                    }),
                ),
              );
              b.append(row);
            }
          }
        }
      };
      root.append(el('p', '正在加载课程…', 'muted'));
      try {
        state = await request();
        draw();
      } catch (error) {
        root.replaceChildren();
        notice(error.message);
        root.append(button('重试', () => void action()));
        try {
          const probe = await fetch('/api/zhiban/directory/' + tenant + '?limit=10', {
            headers: { 'x-zhiban-request': 'identity-v1' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
          });
          if (probe.ok && root.isConnected) root.append(directoryEntry(), managementEntry());
          await probe.body?.cancel();
        } catch {
          /* Independent directory remains optional when the legacy snapshot is unavailable. */
        }
      }
    },
  };
})();
