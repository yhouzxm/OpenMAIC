// Browser upload hints; the server independently validates MIME, extension and bytes.
const attachmentMimeByExtension = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
const fileMime = (name) => attachmentMimeByExtension[name.split('.').pop().toLowerCase()] || null;
/* Only server responses supply authority; final submissions remain versioned. */
(() => {
  const el = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const date = (value) =>
    value === null
      ? '无截止时间'
      : new Date(Number(value)).toLocaleString('zh-CN', { timeZoneName: 'short' });
  const errors = {
    FORBIDDEN: '当前任教或选课资格已失效。',
    CONFLICT: '记录已变更，请刷新后重新操作。',
    PROGRESS_BLOCKED:
      '先修条件未满足或规则绑定的活动已换版。请查看课程目录中的学习进度；已有作答可继续。',
    COURSE_RESULT_REQUIRED: '此活动须从课程“课堂成果与共享结果”入口核验并提交；当前草稿保留。',
    INVALID_STATE: '该活动或尝试当前不允许此操作。',
    DEADLINE_PASSED: '已超过截止时间，不能再开始或提交。',
    ATTEMPT_LIMIT: '已达到此活动的尝试次数上限。',
    ATTACHMENT_NOT_CLEARED: '附件未获扫描放行（检出风险或扫描暂不可用），未创建提交。',
    ATTACHMENT_LIMIT: '附件累计大小或数量已达上限，请移除待提交附件后重试。',
    INVALID_INPUT: '请检查内容、附件格式／大小、截止时间和次数设置。',
  };
  // One page-wide guard covers every mounted course, without persisting answer text.
  const classroomActivity =
    /^#classroom-activity-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(location.hash);
  const classroomAttempt = new URLSearchParams(location.search).get('classroomAttempt');
  const pinnedAttempt =
    classroomActivity && /^[0-9a-f-]{36}$/.test(classroomAttempt ?? '') ? classroomAttempt : null;
  const drafts = new Map();
  const attachmentDrafts = new Map();
  const dirty = (scope = document, includeAttachments = true) =>
    (includeAttachments &&
      [...attachmentDrafts.values()].some(
        (entry) => entry.root.isConnected && scope.contains(entry.root),
      )) ||
    [...drafts].some(
      ([input, saved]) => input.isConnected && scope.contains(input) && input.value !== saved,
    );
  let approvedNavigation = false;
  let asking = null;
  const confirmLeave = () => {
    if (asking) return asking;
    asking = new Promise((resolve) => {
      const previous = document.activeElement;
      const dialog = el('dialog');
      dialog.setAttribute('aria-label', '未保存作答离开确认');
      dialog.append(el('p', '作答尚未保存。离开将丢失未保存修改，请先取消并保存，或确认放弃。'));
      const finish = (value) => {
        dialog.close();
        dialog.remove();
        asking = null;
        if (!value && previous?.isConnected) previous.focus();
        if (value) attachmentDrafts.clear();
        resolve(value);
      };
      const stay = el('button', '取消离开，继续作答');
      stay.type = 'button';
      stay.onclick = () => finish(false);
      const leave = el('button', '放弃未保存修改并离开');
      leave.type = 'button';
      leave.onclick = () => finish(true);
      dialog.append(stay, leave);
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      document.body.append(dialog);
      dialog.showModal();
      stay.focus();
    });
    return asking;
  };
  window.addEventListener('beforeunload', (event) => {
    if (!approvedNavigation && dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest?.('a[href],button');
      if (!target || approvedNavigation || !dirty() || target.closest('dialog')) return;
      const link = target.closest('a[href]');
      if (
        link &&
        (event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0 ||
          link.hasAttribute('download') ||
          (link.target && link.target !== '_self'))
      )
        return;
      // Buttons within a learning panel are guarded by its reload/write paths.
      if (
        !link &&
        [...drafts.keys()].some(
          (input) => input.isConnected && input.closest('[data-learning-root]')?.contains(target),
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void confirmLeave().then((leave) => {
        if (!leave || !target.isConnected) return;
        approvedNavigation = true;
        if (
          link &&
          new URL(link.href).pathname + new URL(link.href).search !==
            location.pathname + location.search
        ) {
          location.assign(link.href);
          return;
        }
        try {
          target.click();
        } finally {
          // Same-document actions must not disable future protection.
          queueMicrotask(() => {
            approvedNavigation = false;
          });
        }
      });
    },
    true,
  );
  window.zhibanLearning = {
    async render(tenant, offering, root, person, options = {}) {
      let closed = false,
        pending = null,
        busy = false,
        focusActivity = options.activityId ?? null,
        focusAttempt = null;
      const authorFlow = window.zhibanCurriculum?.flow();
      let authoredTarget = authorFlow?.action === 'edit' ? authorFlow.target : null;
      const authorAcknowledgements = new Set();
      const returnAction = el('div', undefined, 'outline-toolbar');
      const pendingLeave = (e) => {
        if (authorFlow && (busy || pending) && e.target.closest?.('a[href]')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          notice.textContent = '操作结果尚未确认，请先完成当前操作或按原命令号重试。';
        }
      };
      document.addEventListener('click', pendingLeave, true);
      function updateReturn() {
        returnAction.replaceChildren();
        if (!authorFlow || !authoredTarget) return;
        const a = el('a', '返回原章节并加入目录', 'button secondary');
        a.href = authorFlow.returnUrl(authoredTarget);
        returnAction.append(a);
      }
      root.dataset.learningRoot = '';
      const controllers = new Set(),
        cleanup = new Set();
      const header = el('h4', '学习活动与提交'),
        notice = el('p'),
        content = el('section');
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      root.replaceChildren(
        header,
        notice,
        returnAction,
        el('p', '按活动、尝试和提交版本分别翻页。翻页或刷新前请先保存作答草稿。', 'muted'),
        content,
      );
      const live = () => !closed && root.isConnected;
      const button = (text, fn) => {
        const b = el('button', text, 'button secondary');
        b.type = 'button';
        b.onclick = () => void fn();
        return b;
      };
      let attachmentsEnabled = false;
      let attachmentMode = null;
      let attachmentAccept = '.pdf,.txt';
      async function request(kind, filters = {}, command = null, key = null) {
        const c = new AbortController();
        controllers.add(c);
        const timer = setTimeout(() => c.abort(), command?.attachment ? 75000 : 10000);
        const headers = { 'x-zhiban-request': 'identity-v1' };
        try {
          if (command) {
            const csrf = await fetch('/api/zhiban/identity/csrf', {
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
            });
            if (!csrf.ok)
              throw Object.assign(new Error('登录已失效，请重新登录。'), {
                definitive: csrf.status >= 400 && csrf.status < 500,
              });
            headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
            headers['x-zhiban-command'] = key;
            headers['Content-Type'] = 'application/json';
          }
          if (!live()) throw new Error('视图已关闭');
          const params = new URLSearchParams(
            Object.entries(
              kind === 'activities' && options.activityId
                ? { ...filters, q: options.activityId }
                : filters,
            ).filter(([, v]) => v !== null && v !== undefined && v !== ''),
          );
          const r = await fetch(
            `/api/zhiban/learning/${tenant}/offerings/${offering.id}${kind ? '/' + kind : ''}${params.size ? '?' + params : ''}`,
            {
              method: command ? 'POST' : 'GET',
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
              ...(command ? { body: JSON.stringify(command) } : {}),
            },
          );
          const data = await r.json();
          if (data.submissionAttachments !== undefined)
            attachmentsEnabled = data.submissionAttachments;
          if (data.submissionAttachmentMode !== undefined)
            attachmentMode = data.submissionAttachmentMode;
          if (typeof data.submissionAttachmentFormats === 'string')
            attachmentAccept = data.submissionAttachmentFormats;
          if (!r.ok)
            throw Object.assign(
              new Error(errors[data.error?.code] || '学习记录暂时不可用，请稍后重试。'),
              { definitive: r.status >= 400 && r.status < 500, code: data.error?.code },
            );
          return data;
        } finally {
          clearTimeout(timer);
          controllers.delete(c);
        }
      }
      const action = async (command) => {
        if (busy || pending || !live()) return;
        if (
          dirty(root) &&
          !['SAVE_DRAFT', 'SUBMIT'].includes(command.type) &&
          !(await confirmLeave())
        )
          return;
        pending = { command, key: crypto.randomUUID() };
        await send();
      };
      async function send() {
        if (busy || !pending || !live()) return;
        busy = true;
        const previous = [...root.querySelectorAll('button,input,select,textarea')].map((n) => [
          n,
          n.disabled,
        ]);
        previous.forEach(([n]) => (n.disabled = true));
        notice.textContent = '正在提交…';
        try {
          const result = await request('', {}, pending.command, pending.key);
          if (!live()) return;
          authorAcknowledgements.forEach((accept) => accept(pending.command));
          if (pending.command.type === 'START_ATTEMPT') focusAttempt = result.id;
          if (pending.command.type === 'CREATE_ACTIVITY') {
            if (authorFlow) {
              authoredTarget = result.id;
              history.replaceState(
                null,
                '',
                location.pathname +
                  location.search +
                  `#edit-${authorFlow.chapter}-ACTIVITY-${result.id}`,
              );
              updateReturn();
            }
            focusActivity = result.id;
            activities.reset();
          }
          if (['SAVE_DRAFT', 'SUBMIT'].includes(pending.command.type)) {
            for (const [input] of drafts) {
              if (root.contains(input) && input.dataset.attempt === pending.command.id)
                drafts.set(input, pending.command.answer);
            }
          }
          const preserveFiles = pending.command.type === 'SAVE_DRAFT';
          if (pending.command.type === 'SUBMIT') attachmentDrafts.delete(pending.command.id);
          pending = null;
          busy = false;
          notice.textContent = '操作已完成。';
          await activities.load(preserveFiles);
        } catch (e) {
          if (!live()) return;
          if (e.definitive) {
            pending = null;
            notice.textContent = e.message;
          } else
            notice.replaceChildren(
              el('span', '结果待确认；请按原命令号重试，期间暂停其他操作。'),
              el('small', pending.key),
              button('按原命令号重试', send),
            );
        } finally {
          busy = false;
          if (!pending) previous.forEach(([n, d]) => (n.disabled = d));
        }
      }
      const authorForm = (parent, activity) => {
        const details = el('details', undefined, 'academic-form');
        details.append(el('summary', activity ? '编辑活动草稿' : '新建文字活动'));
        if (
          authorFlow &&
          ((!activity && authorFlow.action === 'compose' && !authoredTarget) ||
            activity?.id === authoredTarget)
        )
          details.open = true;
        const f = el('form');
        const field = (text, input) => {
          const l = el('label', text);
          input.setAttribute('aria-label', text);
          l.append(input);
          f.append(l);
          return input;
        };
        const title = field('活动标题', el('input'));
        title.required = true;
        title.maxLength = 120;
        title.value = activity?.title ?? '';
        const prompt = field('活动要求', el('textarea'));
        prompt.required = true;
        prompt.maxLength = 2000;
        prompt.rows = 5;
        const baseline = { title: activity?.title ?? '', prompt: activity?.prompt ?? '' };
        prompt.value = activity?.prompt ?? '';
        const deadline = field('截止时间（本机时区，可不设）', el('input'));
        deadline.type = 'datetime-local';
        if (activity?.deadline_at) {
          const d = new Date(Number(activity.deadline_at));
          deadline.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        }
        const resubmit = field('允许重交', el('select'));
        for (const [v, t] of [
          ['false', '不允许'],
          ['true', '允许，保留每次提交版本'],
        ]) {
          const o = el('option', t);
          o.value = v;
          resubmit.append(o);
        }
        resubmit.value = String(activity?.allow_resubmit ?? false);
        const maximum = field('最多尝试次数（留空表示不限）', el('input'));
        maximum.type = 'number';
        maximum.min = '1';
        maximum.max = '1000';
        maximum.value = activity?.max_attempts ?? '';
        f.append(el('p', '恢复已有尝试和重交不扣次数；规则随发布版本固定。', 'muted'));
        const save = el('button', '保存草稿', 'button primary');
        save.type = 'submit';
        f.append(save);
        let accepted = false;
        const accept = (command) => {
          if (
            f.isConnected &&
            (activity
              ? command.type === 'EDIT_ACTIVITY' && command.id === activity.id
              : command.type === 'CREATE_ACTIVITY')
          )
            accepted = true;
        };
        const unsaved = () =>
          !accepted &&
          (title.value.trim() !== baseline.title ||
            prompt.value !== baseline.prompt ||
            deadline.value !== initialRules.deadline ||
            resubmit.value !== initialRules.resubmit ||
            maximum.value !== initialRules.maximum);
        const initialRules = {
          deadline: deadline.value,
          resubmit: resubmit.value,
          maximum: maximum.value,
        };
        const beforeLeave = (e) => {
          if (f.isConnected && unsaved()) {
            e.preventDefault();
            e.returnValue = '';
          }
        };
        const onLeave = (e) => {
          if (!f.isConnected || !unsaved() || !e.target.closest?.('a[href]')) return;
          if (!confirm('活动草稿有未保存修改，确认放弃并离开？')) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        };
        if (authorFlow) {
          authorAcknowledgements.add(accept);
          f.addEventListener('input', () => {
            accepted = false;
          });
          window.addEventListener('beforeunload', beforeLeave);
          document.addEventListener('click', onLeave, true);
          cleanup.add(() => {
            authorAcknowledgements.delete(accept);
            window.removeEventListener('beforeunload', beforeLeave);
            document.removeEventListener('click', onLeave, true);
          });
        }
        f.onsubmit = (e) => {
          e.preventDefault();
          void action({
            type: activity ? 'EDIT_ACTIVITY' : 'CREATE_ACTIVITY',
            ...(activity ? { id: activity.id, revision: activity.revision } : {}),
            title: title.value.trim(),
            prompt: prompt.value,
            deadlineAt: deadline.value ? new Date(deadline.value).getTime() : null,
            allowResubmit: resubmit.value === 'true',
            maxAttempts: maximum.value ? Number(maximum.value) : null,
          });
        };
        details.append(f);
        parent.append(details);
      };

      // Each list owns its cursor and nested views. No page is used to infer a global latest record.
      function list(parent, kind, target, draw, teacher = false) {
        let cursor = [null],
          index = 0,
          q =
            kind === 'activities' && options.activityId
              ? options.activityId
              : kind === 'activities' && authorFlow?.action === 'edit'
                ? authorFlow.target
                : kind === 'activities' &&
                    (/^#activity-[0-9a-f-]{36}$/.test(location.hash) ||
                      /^#classroom-activity-[0-9a-f-]{36}-[1-9][0-9]{0,14}-[0-9a-f-]{36}$/.test(
                        location.hash,
                      ))
                  ? location.hash.startsWith('#classroom-')
                    ? location.hash.slice(20, 56)
                    : location.hash.slice(10)
                  : '',
          state = 'ALL',
          member = '',
          limit = '20',
          epoch = 0,
          loading = false,
          dead = false;
        let displayed = null;
        const children = new Set();
        const destroy = () => {
          dead = true;
          epoch++;
          children.forEach((fn) => fn());
          children.clear();
        };
        cleanup.add(destroy);
        function reset() {
          cursor = [null];
          index = 0;
          q = '';
          state = 'ALL';
          member = '';
        }
        const names = { activities: '活动', attempts: '尝试', submissions: '提交' };
        async function load(preserveAttachments = false) {
          if (dead || !live() || loading || busy || pending) return;
          if (dirty(parent, !preserveAttachments) && !(await confirmLeave())) {
            if (displayed) ({ cursor, index, q, state, member, limit } = displayed);
            return;
          }
          loading = true;
          const version = ++epoch;
          parent
            .querySelectorAll('button,input,select,textarea')
            .forEach((n) => (n.disabled = true));
          try {
            const data = await request(kind, {
              limit,
              cursor: cursor[index],
              ...(kind === 'activities'
                ? { q, state }
                : kind === 'attempts'
                  ? {
                      activity: target,
                      state,
                      ...(member ? { member } : {}),
                      ...(!teacher && pinnedAttempt && classroomActivity[1] === target
                        ? { id: pinnedAttempt }
                        : {}),
                    }
                  : { attempt: target }),
            });
            if (dead || !live() || version !== epoch || !parent.isConnected) return;
            children.forEach((fn) => fn());
            children.clear();
            parent.replaceChildren();
            displayed = { cursor: [...cursor], index, q, state, member, limit };
            const isTeacher = data.mode === 'TEACHER';
            if (kind === 'activities' && isTeacher && authorFlow) {
              if (authorFlow.action === 'compose' && !authoredTarget)
                notice.textContent = '为原章节新建活动，保存后可返回并加入目录。';
              updateReturn();
            }
            if (kind === 'activities' && isTeacher) {
              authorForm(parent);
              const quizCreate = el('details');
              quizCreate.append(el('summary', '新建课程测验'));
              const quizRoot = el('div');
              quizCreate.append(quizRoot);
              parent.append(quizCreate);
              let mounted;
              quizCreate.addEventListener('toggle', () => {
                if (quizCreate.open && !mounted)
                  mounted = window.zhibanQuiz.render(tenant, offering.id, quizRoot);
              });
              children.add(() => mounted?.());
            }
            const f = el('form', undefined, 'course-filters'),
              commit = [];
            if (kind === 'activities' || (kind === 'attempts' && teacher)) {
              const l = el('label', kind === 'activities' ? '搜索活动' : '完整学生成员 ID'),
                input = el('input');
              input.value = kind === 'activities' ? q : member;
              input.maxLength = kind === 'activities' ? 120 : 36;
              if (kind === 'attempts') {
                input.pattern =
                  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
                input.title = '请输入完整学生成员 ID（UUID），或留空查询全部学生；此处不支持姓名。';
                input.oninvalid = () => input.setCustomValidity(input.title);
                input.oninput = () => input.setCustomValidity('');
                f.append(
                  el(
                    'p',
                    '请输入完整学生成员 ID，或留空查看全部；按姓名查找已提交作答可使用“待评分与成绩”。',
                    'muted',
                  ),
                );
              }
              l.append(input);
              f.append(l);
              commit.push(() => {
                if (kind === 'activities') q = input.value.trim();
                else member = input.value.trim();
              });
            }
            if (kind !== 'submissions') {
              const l = el('label', names[kind] + '状态'),
                select = el('select');
              for (const [v, t] of kind === 'activities'
                ? [
                    ['ALL', '全部'],
                    ['DRAFT', '草稿'],
                    ['PUBLISHED', '已发布'],
                    ['WITHDRAWN', '已撤回'],
                  ]
                : [
                    ['ALL', '全部'],
                    ['IN_PROGRESS', '草稿'],
                    ['SUBMITTED', '已提交'],
                  ]) {
                const o = el('option', t);
                o.value = v;
                select.append(o);
              }
              select.value = state;
              commit.push(() => (state = select.value));
              l.append(select);
              f.append(l);
            }
            const l = el('label', names[kind] + '每页条数'),
              size = el('select');
            for (const v of ['10', '20', '50']) {
              const o = el('option', v);
              o.value = v;
              size.append(o);
            }
            size.value = limit;
            commit.push(() => (limit = size.value));
            l.append(size);
            f.append(l);
            const search = el(
              'button',
              kind === 'submissions' ? '刷新提交' : '查询' + names[kind],
              'button secondary',
            );
            search.type = 'submit';
            f.append(search);
            f.onsubmit = (e) => {
              e.preventDefault();
              if (loading || busy || pending) return;
              if (!f.reportValidity()) return;
              commit.forEach((fn) => fn());
              cursor = [null];
              index = 0;
              void load();
            };
            if (!(kind === 'activities' && options.activityId)) parent.append(f);
            if (kind === 'activities')
              parent.append(
                button('刷新活动', () => {
                  cursor = [null];
                  index = 0;
                  return load();
                }),
              );
            const rows = el('div', undefined, 'learning-' + kind + '-list');
            parent.append(rows);
            for (const row of data.rows) draw(row, rows, data, children);
            if (!data.rows.length)
              rows.append(el('p', '暂无匹配' + names[kind] + '记录。', 'muted'));
            const nav = el('nav', undefined, 'course-pagination');
            nav.setAttribute('aria-label', names[kind] + '分页');
            const prev = button('上一页' + names[kind], () => {
                if (!loading && !busy && !pending && index > 0) {
                  index--;
                  return load();
                }
              }),
              next = button('下一页' + names[kind], () => {
                if (!loading && !busy && !pending && data.nextCursor) {
                  cursor[++index] = data.nextCursor;
                  return load();
                }
              });
            prev.disabled = index === 0;
            next.disabled = !data.nextCursor;
            nav.append(prev, el('span', `第 ${index + 1} 页 · 本页 ${data.rows.length} 条`), next);
            parent.append(nav);
          } catch (e) {
            if (!dead && live() && version === epoch) {
              children.forEach((fn) => fn());
              children.clear();
              const filters = parent.querySelector(':scope > form');
              const message = el(
                'p',
                e.code === 'INVALID_INPUT' ? '筛选条件无效，请修改筛选条件后重新查询。' : e.message,
                'notice',
              );
              message.setAttribute('role', 'alert');
              parent.replaceChildren(
                ...(filters ? [filters] : []),
                message,
                button('重新读取' + names[kind], load),
              );
              filters?.querySelectorAll('button,input,select').forEach((n) => (n.disabled = false));
            }
          } finally {
            loading = false;
          }
        }
        return {
          load,
          reset,
          destroy: () => {
            destroy();
            cleanup.delete(destroy);
          },
        };
      }
      function attempts(activity, parent, teacher, owners) {
        const details = el('details');
        details.append(el('summary', teacher ? '查看学生尝试' : '我的尝试'));
        const panel = el('section');
        details.append(panel);
        parent.append(details);
        let mounted = null;
        const open = () => {
          if (!details.open || mounted) return;
          mounted = list(
            panel,
            'attempts',
            activity.id,
            (t, rows, data, children) => {
              const history = el('details', undefined, 'learning-attempt');
              history.open = !teacher && t.latest_attempt;
              history.append(
                el(
                  'summary',
                  `${teacher ? (t.display_name || person(t.membership_id)) + ' · ' : ''}尝试 ${t.attempt_no} · 活动版本 ${t.activity_version} · ${t.status === 'SUBMITTED' ? '已提交' : '草稿'}${t.latest_attempt ? ' · 最新尝试' : ''}`,
                ),
                el('p', t.prompt, 'learning-text'),
                el(
                  'p',
                  `此尝试规则：${date(t.deadline_at)} · ${t.allow_resubmit ? '可重交' : '不可重交'}`,
                  'muted',
                ),
              );
              rows.append(history);
              if (t.lab_notebook_id) {
                const lab = el('a', '打开实验记录与报告', 'button secondary');
                const courseId =
                  new URLSearchParams(window.zhibanCoursePage?.query ?? location.search).get(
                    'course',
                  ) ?? offering.course_id;
                lab.href = courseId
                  ? `/zhiban/${teacher ? 'teacher' : 'student'}/courses/${courseId}/classroom-plan?space=${tenant}&offering=${offering.id}#notebook-${t.lab_notebook_id}`
                  : `/zhiban?space=${tenant}`;
                history.append(lab);
              }
              if (activity.activity_type === 'QUIZ') {
                if (!teacher) {
                  const quizRoot = el('div');
                  history.append(quizRoot);
                  children.add(
                    window.zhibanQuiz.render(tenant, offering.id, quizRoot, { attempt: t.id }),
                  );
                }
                const submissions = el('section');
                history.append(submissions);
                const mounted = list(
                  submissions,
                  'submissions',
                  t.id,
                  (s, container, _data, owned) => {
                    const quizRoot = el('div');
                    container.append(quizRoot);
                    owned.add(
                      window.zhibanQuiz.render(tenant, offering.id, quizRoot, { submission: s.id }),
                    );
                  },
                );
                children.add(() => mounted.destroy());
                return;
              }
              if (!teacher && !t.lab_notebook_id) {
                const answer = el('textarea');
                answer.rows = 6;
                answer.maxLength = 4000;
                answer.value = t.draft;
                answer.setAttribute('aria-label', `尝试 ${t.attempt_no} 作答`);
                const writable =
                  activity.status === 'PUBLISHED' &&
                  offering.status === 'OPEN' &&
                  t.latest_attempt &&
                  (t.status === 'IN_PROGRESS' || t.allow_resubmit) &&
                  (t.deadline_at === null || Date.now() < Number(t.deadline_at));
                answer.disabled = !writable;
                if (writable) {
                  answer.dataset.attempt = t.id;
                  drafts.set(answer, t.draft);
                  children.add(() => drafts.delete(answer));
                }
                history.append(answer);
                if (writable && attachmentsEnabled) {
                  const files = el('section'),
                    label = el('label', '本次提交附件（文档／图片／音视频，最多1 MiB，可选）'),
                    picker = el('input');
                  picker.type = 'file';
                  picker.accept = attachmentAccept;
                  label.append(picker);
                  const info = el('p');
                  const existing = attachmentDrafts.get(t.id);
                  if (existing) {
                    existing.root = files;
                    info.textContent = existing.attachment
                      ? '已选择：' + existing.attachment.name
                      : '正在读取附件…';
                  }
                  picker.onchange = async () => {
                    const file = picker.files[0];
                    if (!file) return;
                    if (
                      file.size < 1 ||
                      file.size > 1048576 ||
                      !fileMime(file.name, file.type) ||
                      !attachmentAccept
                        .split(',')
                        .includes('.' + file.name.split('.').pop().toLowerCase())
                    ) {
                      attachmentDrafts.delete(t.id);
                      info.textContent = '请选择1 MiB以内的受支持文档、图片或音视频。';
                      picker.value = '';
                      return;
                    }
                    const entry = { root: files, attachment: null };
                    attachmentDrafts.set(t.id, entry);
                    info.textContent = '正在读取附件…';
                    try {
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      let raw = '';
                      for (let i = 0; i < bytes.length; i += 8192)
                        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
                      if (attachmentDrafts.get(t.id) !== entry) return;
                      entry.attachment = {
                        name: file.name,
                        mime: fileMime(file.name, file.type),
                        base64: btoa(raw),
                      };
                      info.textContent =
                        '已选择：' + file.name + '；仅正式提交才上传，保存文字草稿不上传附件。';
                    } catch {
                      attachmentDrafts.delete(t.id);
                      info.textContent = '读取附件失败，请重新选择。';
                    }
                  };
                  files.append(
                    el(
                      'p',
                      attachmentMode === 'TRUSTED_SCANNER'
                        ? '附件正式提交前由 ClamAV 扫描；检出风险或扫描失败时不会创建提交。'
                        : '当前仅为已登记合成样例模式；真实文件尚未配置恶意软件扫描，默认拒绝提交。',
                    ),
                  );
                  files.append(
                    label,
                    info,
                    button('移除待提交附件', () => {
                      attachmentDrafts.delete(t.id);
                      picker.value = '';
                      info.textContent = '未选择附件。';
                    }),
                  );
                  history.append(files);
                }

                if (writable)
                  for (const [type, label] of [
                    ['SAVE_DRAFT', '保存作答草稿'],
                    ['SUBMIT', t.status === 'SUBMITTED' ? '提交新版本' : '最终提交'],
                  ]) {
                    const submit = (value) => {
                      const selected = attachmentDrafts.get(t.id);
                      if (type === 'SUBMIT' && selected && !selected.attachment) {
                        notice.textContent = '附件尚未读取完成，请稍后提交。';
                        return;
                      }

                      focusActivity = activity.id;
                      focusAttempt = t.id;
                      return action({
                        type,
                        id: t.id,
                        revision: t.revision,
                        answer: value,
                        ...(type === 'SUBMIT' && selected?.attachment
                          ? { attachment: selected.attachment }
                          : {}),
                      });
                    };
                    if (type === 'SUBMIT' && !t.allow_resubmit) {
                      const confirm = el('section', undefined, 'learning-submit-confirm');
                      confirm.hidden = true;
                      confirm.setAttribute('role', 'group');
                      confirm.setAttribute('aria-label', '最终提交确认');
                      let snapshot = '';
                      const dismiss = () => {
                        confirm.hidden = true;
                        answer.disabled = false;
                      };
                      confirm.append(
                        el('p', '本次尝试提交后不可修改或重交。请确认当前作答已完成。', 'notice'),
                        button('确认最终提交', () => {
                          dismiss();
                          return submit(snapshot);
                        }),
                        button('取消提交', () => {
                          dismiss();
                          answer.focus();
                        }),
                      );
                      history.append(
                        button(label, () => {
                          snapshot = answer.value;
                          answer.disabled = true;
                          confirm.hidden = false;
                          confirm.querySelector('button').focus();
                        }),
                        confirm,
                      );
                    } else history.append(button(label, () => submit(answer.value)));
                  }
              }
              const submitted = el('details');
              submitted.append(el('summary', '查看提交版本与成绩'));
              const body = el('section');
              submitted.append(body);
              history.append(submitted);
              let versions = null;
              const show = () => {
                if (!submitted.open || versions) return;
                versions = list(body, 'submissions', t.id, (s, output) => {
                  const card = el('section', undefined, 'learning-submission');
                  card.append(
                    el(
                      'h5',
                      `提交版本 ${s.version}${s.latest_submission ? ' · 最新提交' : ''} · ${date(s.submitted_at)}`,
                    ),
                    el('p', s.answer, 'learning-text'),
                  );
                  if (attachmentsEnabled) {
                    const files = el('section');
                    files.setAttribute('aria-label', '提交附件');
                    card.append(files);
                    void window.zhibanSubmissionFiles(tenant, offering.id, s.id, files);
                  }
                  const assessment = el('details');
                  assessment.append(el('summary', teacher ? '人工评分与成绩' : '查看成绩与反馈'));
                  const gradeRoot = el('section');
                  assessment.append(gradeRoot);
                  let initialized = false;
                  assessment.addEventListener('toggle', () => {
                    if (assessment.open && !initialized) {
                      initialized = true;
                      if (activity.activity_type === 'QUIZ') {
                        owners.add(
                          window.zhibanQuiz.render(tenant, offering.id, gradeRoot, {
                            submission: s.id,
                          }),
                        );
                        return;
                      }
                      void window.zhibanAssessment.render(tenant, offering, gradeRoot, person, {
                        paged: true,
                        activities: [activity],
                        attempts: [t],
                        submissions: [s],
                      });
                    }
                  });
                  card.append(assessment);
                  output.append(card);
                });
                children.add(versions.destroy);
                void versions.load();
              };
              submitted.addEventListener('toggle', show);
              if (t.id === focusAttempt) {
                history.open = true;
                submitted.open = true;
                show();
              }
            },
            teacher,
          );
          void mounted.load();
        };
        details.addEventListener('toggle', open);
        owners.add(() => mounted?.destroy());
        if (activity.id === focusActivity && activity.activity_type !== 'QUIZ') {
          details.open = true;
          open();
        }
        return () => {
          if (!live()) return;
          details.open = true;
          open();
        };
      }
      const activities = list(content, 'activities', null, (a, rows, data, owners) => {
        const teacher = data.mode === 'TEACHER',
          card = el('section', undefined, 'learning-activity');
        rows.append(card);
        // Public fixed rubric disclosure; the original submit remains server-authorized.
        if(a.status === 'PUBLISHED') {
          const ac=new AbortController(); owners.add(()=>ac.abort());
          fetch(`/api/zhiban/autograde/${tenant}/offerings/${offering.id}?mode=${teacher?'TEACHER':'STUDENT'}&activity=${a.id}`,{headers:{'x-zhiban-request':'identity-v1'},cache:'no-store',signal:ac.signal})
            .then(async r=>r.ok?await r.json():null).then(data=>{
              if(ac.signal.aborted||!data)return;
              const policy=data.rows.find(p=>p.id===a.id&&p.enabled&&p.activity_version===p.published_version);
              if(policy)card.prepend(el('p',`本活动已启用 AI 服务正式评分（${policy.provider} / ${policy.model}）。固定评分规则：${policy.rubric}。可在课程“AI 正式评分”查看本人成绩并申诉。`,'muted'));
            }).catch(()=>{});
        }
        if (!teacher && pinnedAttempt && classroomActivity[1] === a.id) {
          const search = new URLSearchParams(location.search),
            resource = search.get('jointResource'),
            publication = search.get('jointPublication'),
            dispatch = search.get('jointDispatch');
          if (
            [resource, publication, dispatch].every((x) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x ?? ''),
            )
          ) {
            const back = el('a', '返回本次课堂互动', 'button secondary');
            back.href = `/api/zhiban/content/${tenant}/offerings/${offering.id}/resources/${resource}/player?publication=${publication}&dispatch=${dispatch}`;
            card.append(
              back,
              el('p', '本页作答固定于本次课堂首次进入的尝试；互动内结果不自动计分。', 'muted'),
            );
          }
        }
        if (a.activity_type === 'QUIZ') {
          const quizRoot = el('div');
          card.append(quizRoot);
          const stop = window.zhibanQuiz.render(
            tenant,
            offering.id,
            quizRoot,
            !teacher && pinnedAttempt && classroomActivity[1] === a.id
              ? { attempt: pinnedAttempt }
              : { activity: a.id },
          );
          owners.add(stop);
          attempts(a, card, teacher, owners);
          return;
        }
        card.append(
          el('h4', a.title),
          el(
            'p',
            `${a.status === 'DRAFT' ? '草稿' : a.status === 'WITHDRAWN' ? '已撤回' : '已发布'} · 版本 ${a.published_version} · ${date(a.deadline_at)} · ${a.allow_resubmit ? '允许重交' : '不允许重交'} · 尝试 ${a.max_attempts ?? '不限'} 次`,
            'muted',
          ),
          el('p', a.prompt, 'learning-text'),
        );
        if (teacher) {
          authorForm(card, a);
          card.append(
            button('发布新版本', () =>
              action({ type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision }),
            ),
          );
          if (a.status === 'PUBLISHED')
            card.append(
              button('撤回活动', () =>
                action({ type: 'WITHDRAW_ACTIVITY', id: a.id, revision: a.revision }),
              ),
            );
          card.append(el('p', '编辑只改草稿；已开始的尝试仍使用原发布版本。', 'muted'));
        } else if (a.status === 'PUBLISHED' && !(pinnedAttempt && classroomActivity[1] === a.id)) {
          const previous = Number(a.latest_attempt_no),
            active = a.has_active_attempt;
          if (previous > 0)
            card.append(button(active ? '继续未完成作答' : '查看已提交尝试', () => openAttempts()));
          if (!active) {
            const confirm = el('details', undefined, 'learning-start-confirm');
            confirm.append(
              el('summary', previous ? '新建下一次尝试' : '开始首次尝试'),
              el(
                'p',
                `开始将占用 1 次尝试次数；当前已用 ${previous} 次，上限 ${a.max_attempts ?? '不限'} 次。使用当前发布版本 ${a.published_version}，${date(a.deadline_at)}。`,
              ),
              el(
                'p',
                '仅查看旧提交或在允许重交的原尝试中提交新版本，不需要新建尝试。并发变化、截止及次数限制以服务器最终判定为准。',
                'muted',
              ),
            );
            const start = button('确认开始新尝试', () => {
              focusActivity = a.id;
              const match =
                /^#classroom-activity-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(
                  location.hash,
                );
              return action({
                type: 'START_ATTEMPT',
                id: a.id,
                ...(match?.[1] === a.id ? { expectedVersion: match[2] } : {}),
              });
            });
            const expired = a.deadline_at !== null && Date.now() >= Number(a.deadline_at),
              exhausted = a.max_attempts !== null && previous >= a.max_attempts;
            start.disabled = expired || exhausted;
            if (exhausted)
              confirm.append(el('p', '已达到此活动的尝试次数上限，可查看历史尝试。', 'muted'));
            else if (expired)
              confirm.append(el('p', '已超过当前发布版本的截止时间，不能新建尝试。', 'muted'));
            confirm.append(
              start,
              button('取消新建尝试', () => {
                confirm.open = false;
              }),
            );
            card.append(confirm);
          }
        }
        const openAttempts = attempts(a, card, teacher, owners);
        if (!teacher && pinnedAttempt && classroomActivity[1] === a.id) {
          card.append(
            el(
              'p',
              '当前只显示本课堂首次绑定的尝试；创建下一次尝试请从普通学习活动进入。',
              'muted',
            ),
          );
          openAttempts();
        }
      });
      function destroy() {
        if (closed) return;
        closed = true;
        document.removeEventListener('click', pendingLeave, true);
        controllers.forEach((c) => c.abort());
        cleanup.forEach((fn) => fn());
        cleanup.clear();
        pending = null;
        for (const [id, entry] of attachmentDrafts)
          if (root.contains(entry.root)) attachmentDrafts.delete(id);
        root.replaceChildren();
        for (const [input] of drafts) if (!input.isConnected) drafts.delete(input);
        observer.disconnect();
        channel?.close();
        window.removeEventListener('pagehide', destroy);
      }
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      if (channel) channel.onmessage = destroy;
      const observer = new MutationObserver(() => {
        if (!root.isConnected) destroy();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('pagehide', destroy, { once: true });
      await activities.load();
      return destroy;
    },
  };
})();
