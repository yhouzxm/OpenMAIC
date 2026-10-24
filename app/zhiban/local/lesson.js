/* Course-scoped native generation; output remains private until explicitly adopted and published. */
(async () => {
  const course = window.zhibanCoursePage;
  if (!course || !(await course.ready) || document.body.dataset.courseSurface !== 'content') return;
  const p = new URLSearchParams(course.query);
  if (p.get('role') !== 'teacher') return;
  const base = `/api/zhiban/content/${p.get('tenant')}/offerings/${p.get('offering')}/ai`;
  let quizMode = false;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const panel = el('section');
  panel.className = 'lesson-panel';
  panel.setAttribute('aria-label', '教师 AI 备课');
  const details = el('details'),
    summary = el('summary', '教师 AI 备课：生成 → 采用 → 发布');
  details.append(summary);
  details.open = course.authoringEntry;
  const nativeEntry = el('a', '打开原生备课工作台：完整课件与资产 →');
  nativeEntry.className = 'button primary';
  nativeEntry.href = `/zhiban/native-workbench?tenant=${p.get('tenant')}&offering=${p.get('offering')}${p.get('course') ? '&returnCourse=' + p.get('course') : ''}`;
  panel.append(nativeEntry, details);
  const root = document.querySelector('#root');
  const workspace = el('div');
  workspace.className = 'course-panel lesson-workspace';
  root.before(workspace);
  workspace.append(panel, root);
  const notice = el('p'),
    status = el('p');
  status.setAttribute('role', 'status');
  const label = el('label', '备课要求'),
    brief = el('textarea');
  brief.setAttribute('aria-label', '备课要求');
  brief.maxLength = 8000;
  brief.rows = 4;
  label.append(brief);
  const start = el('button', '生成讲义草稿'),
    refresh = el('button', '刷新生成任务');
  start.className = 'button primary';
  refresh.className = 'button secondary';
  const kindLabel = el('label', '生成内容类型'),
    kind = el('select');
  kind.setAttribute('aria-label', '生成内容类型');
  for (const [value, title] of [
    ['handout', '文字讲义'],
    ['quiz', '课程测验'],
  ]) {
    const option = el('option', title);
    option.value = value;
    kind.append(option);
  }
  kindLabel.append(kind);
  kind.onchange = () => {
    if (busy || pending) {
      kind.value = quizMode ? 'quiz' : 'handout';
      return;
    }
    quizMode = kind.value === 'quiz';
    start.textContent = quizMode ? '生成测验草稿' : '生成讲义草稿';
    void act(load);
  };
  const list = el('div');
  const adoptedEditors = el('section'),
    openedQuizzes = new Map();
  details.append(
    el(
      'p',
      '复用原生生成任务，先确认大纲再生成。采用的是文字讲义，不包含动画、音视频及互动；请审核后保存并发布。',
    ),
    notice,
    kindLabel,
    label,
    start,
    refresh,
    status,
    list,
    adoptedEditors,
  );
  let busy = false,
    pending = null;
  const errors = {
    MODEL_CONFIGURATION_REQUIRED:
      '尚未配置生成模型。请由维护人员配置 openmaic.yml 后重启；现有手工备课不受影响。',
    FORBIDDEN: '任教资格或登录状态已变化，请重新进入课程。',
    UNAUTHENTICATED: '登录已失效，请返回工作台。',
    CONFLICT: '任务状态已变化，请刷新；不确定结果可保留原操作重试。',
    GENERATION_NOT_COMPLETE: '生成尚未完成，暂不能采用。',
    UNSUPPORTED_GENERATED_CONTENT: '结果含未支持的场景或无效内容，不能采用。',
    QUIZ_OUTLINE_REQUIRED: '测验大纲须全部为quiz场景，请取消并重新生成。',
    CONFLICT: '源内容已变更或采用发生冲突，请重新审核当前结果。',
    GENERATED_PAGE_TOO_LONG: '生成页面文字过长，不能直接采用。请调整备课要求重新生成。',
  };
  async function api(body, key) {
    const headers = { 'x-zhiban-request': 'identity-v1' };
    if (body) {
      const csrf = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
      if (!csrf.ok) throw Error(errors.UNAUTHENTICATED);
      headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
      headers['Content-Type'] = 'application/json';
      headers['x-zhiban-command'] = key;
    }
    const r = await fetch(base + (quizMode ? '?kind=quiz' : ''), {
      headers,
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const v = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(errors[v.error?.code] ?? '生成服务暂不可用，请保留要求并刷新任务。'),
        { definitive: r.status >= 400 && r.status < 500 },
      );
    return v;
  }
  const states = {
    preparing: '准备中',
    outlining: '生成大纲',
    awaiting_outline_confirmation: '待教师确认大纲',
    generating: '生成正文',
    paused: '已暂停，可重试',
    completed: '已生成，待审核采用',
    ended: '已取消',
  };
  function button(parent, text, work) {
    const b = el('button', text);
    b.type = 'button';
    b.className = 'button secondary';
    b.onclick = () => act(work);
    parent.append(b);
    return b;
  }
  async function act(work) {
    if (busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    status.textContent = '处理中…';
    try {
      await work();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      busy = false;
      panel.removeAttribute('aria-busy');
    }
  }
  async function send(body) {
    const intent = JSON.stringify(body);
    if (pending && pending.intent !== intent)
      throw Error('上次操作结果尚未确认，请先重试原操作并刷新任务。');
    pending ??= { intent, key: crypto.randomUUID().replaceAll('-', '') };
    try {
      const result = await api(body, pending.key);
      pending = null;
      return result;
    } catch (e) {
      if (e.definitive || e.message === errors.MODEL_CONFIGURATION_REQUIRED) pending = null;
      throw e;
    }
  }
  async function load() {
    const v = await api();
    list.replaceChildren();
    notice.textContent = v.capability.ready
      ? '模型已配置；每次生成会调用配置的模型并可能产生费用。'
      : '尚未配置生成模型；可继续使用下方手工讲义编辑。';
    start.disabled = !v.capability.ready;
    start.title = v.capability.ready ? '' : errors.MODEL_CONFIGURATION_REQUIRED;
    for (const run of v.runs) {
      const item = el('article');
      item.append(
        el(
          'h3',
          run.outline?.courseTitle ??
            run.input.requirement.split('教师要求：\n')[1]?.slice(0, 60) ??
            '备课任务',
        ),
      );
      item.append(
        el(
          'p',
          `${states[run.state] ?? run.state} · ${run.progress.scenesCompleted}/${run.progress.scenesTotal} 页`,
        ),
      );
      if (run.error) item.append(el('p', `原因：${run.error.errorCode}。重试将继续原生检查点。`));
      if (run.outline) {
        const outlines = el('ol');
        for (const o of run.outline.outlines) outlines.append(el('li', o.title ?? o.id));
        item.append(outlines);
      }
      if (run.state === 'awaiting_outline_confirmation')
        button(item, '确认大纲并生成正文', async () => {
          await send({ type: 'CONFIRM', runId: run.id, outlineRevision: run.outline.revision });
          await load();
          status.textContent = '已确认大纲，请稍后刷新。';
        });
      if (run.state === 'paused')
        button(item, '重试生成', async () => {
          await send({ type: 'RETRY', runId: run.id });
          await load();
          status.textContent = '已提交重试。';
        });
      if (quizMode && run.state === 'completed')
        button(item, '审核生成测验', async () => {
          const preview = await send({ type: 'PREVIEW', runId: run.id });
          const box = el('section');
          box.append(
            el(
              'p',
              '仅采用为当前教学班正式测验草稿，使用原生单选／多选／简答。请核对题干、正确答案和分值；不会自动发布或替学生评分。',
            ),
          );
          box.append(el('h3', preview.title));
          for (const [index, question] of preview.content.questions.entries()) {
            const item = el('section');
            const type = { single: '单选', multiple: '多选', short_answer: '简答' }[question.type];
            item.append(el('h4', `${index + 1}. ${question.question}`));
            item.append(el('p', `${type} · ${question.points ?? 1} 分`));
            if (question.options) {
              const options = el('ul');
              for (const option of question.options)
                options.append(el('li', `${option.value}：${option.label}`));
              item.append(options);
            }
            item.append(
              el('p', `参考答案：${(question.answer ?? []).join('；') || '请教师补充核对'}`),
            );
            if (question.analysis) item.append(el('p', `解析：${question.analysis}`));
            box.append(item);
          }

          button(box, '采用为可编辑测验草稿', async () => {
            const result = await send({
              type: 'ADOPT',
              runId: run.id,
              sourceHash: preview.sourceHash,
            });
            if (openedQuizzes.has(result.id)) {
              openedQuizzes.get(result.id).scrollIntoView();
              return;
            }
            const editor = el('div');
            adoptedEditors.append(editor);
            openedQuizzes.set(result.id, editor);
            window.zhibanQuiz.render(p.get('tenant'), p.get('offering'), editor, {
              activity: result.id,
            });
            status.textContent =
              '已采用为独立测验草稿；请在下方审核保存并显式发布，再通过课程目录编排供学生学习。';
          });
          item.append(box);
        });
      if (!quizMode && run.state === 'completed')
        button(item, '审核生成讲义', async () => {
          const preview = await send({ type: 'PREVIEW', runId: run.id });
          const box = el('section');
          box.append(
            el(
              'p',
              '将采用为文字草稿：布局、媒体及讲解动作不随之采用；公式保留为可编辑纯文本，复杂写法保留 LaTeX 原式；比较符号转为全角文本。发布前请逐页检查。',
            ),
          );
          if (preview.omitted.length)
            box.append(el('p', `未采用的元素：${preview.omitted.join('、')}`));
          for (const [i, s] of preview.draft.slides.entries()) {
            box.append(el('h4', `第 ${i + 1} 页`));
            for (const e of s.elements) box.append(el('pre', e.text));
          }
          const adoptButton = button(box, '采用为可编辑讲义草稿', async () => {
            const result = await send({ type: 'ADOPT', runId: run.id });
            status.textContent = '已采用。请在讲义编辑器审核并显式发布。';
            const link = el('a', '打开已采用草稿');
            link.href =
              course.href(course.authoringEntry ? 'agents' : 'resources') +
              '#resource-' +
              result.id +
              '-draft';
            link.onclick = (event) => {
              if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
              event.preventDefault();
              // Fallback after a cancelled automatic switch: shell leave protection runs first.
              location.assign(link.href);
              location.reload();
            };
            box.append(link);
            window.dispatchEvent(
              new CustomEvent('zhiban:open-content-draft', { detail: { id: result.id } }),
            );
          });
          adoptButton.dataset.courseInPlace = 'content-adoption';
          item.append(box);
          status.textContent = '请审核文字，再决定是否采用。';
        });
      if (!['ended', 'completed'].includes(run.state))
        button(item, '取消任务', async () => {
          if (!confirm('取消此生成任务？已发生的模型调用不会退款。')) return;
          await send({ type: 'CANCEL', runId: run.id });
          await load();
          status.textContent = '已取消任务。';
        });
      list.append(item);
    }
    status.textContent = v.runs.length
      ? `已读取 ${v.runs.length} 个备课任务。`
      : '暂无备课任务；填写要求后可开始生成。';
  }
  brief.addEventListener('input', () => course.setDirty('lesson-brief', !!brief.value, panel));
  start.onclick = () =>
    act(async () => {
      await send({ type: 'START', requirement: brief.value });
      brief.value = '';
      course.setDirty('lesson-brief', false, panel);
      await load();
      status.textContent = '任务已创建，请稍后刷新并确认大纲。';
    });
  refresh.onclick = () =>
    act(async () => {
      await load();
      status.textContent = '任务已刷新。';
    });
  await act(load);
})();
