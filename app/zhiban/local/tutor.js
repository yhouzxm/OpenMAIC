(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('tutor'),
    params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search),
    tenant = params.get('tenant'),
    offering = params.get('offering'),
    role = params.get('role'),
    mode = role === 'teacher' ? 'TEACHER' : 'STUDENT';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    ![tenant, offering, params.get('course')].every((x) => uuid.test(x ?? '')) ||
    !['teacher', 'student'].includes(role)
  ) {
    root.textContent = '课程地址无效，请从工作台进入。';
    return;
  }
  const base = `/api/zhiban/tutor/${tenant}/offerings/${offering}`;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = el('button', text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const label = (text, input) => {
    const l = el('label', text);
    l.append(input);
    return l;
  };
  const dirty = (key, value) => window.zhibanCoursePage?.setDirty('tutor-' + key, value, root);
  let policy = { enabled: false, revision: '0', guidance: '' },
    capability = { ready: false },
    session = null,
    selected = null,
    after = null,
    cursors = [null],
    page = 0,
    stopped = false,
    reading = false,
    pending = null,
    policyDirty = false,
    policyBase = null,
    commandBusy = false;
  const abort = new AbortController();
  root.append(
    el('h1', 'AI 辅导与学习伙伴'),
    el(
      'p',
      'AI 回答仅供学习参考，不构成正式评价或成绩。对话仅本人可见；教师不能查看学生私人对话。请勿发送密码或不必要的个人信息。',
      'tutor-note',
    ),
  );
  if (/^\/zhiban\/student\/courses\/[0-9a-f-]{36}\/tools$/.test(location.pathname))
    root.append(
      el(
        'p',
        '旧课程工具入口复用课程 Tutor；学习伙伴须教师单独启用，工具型 Agent 未启用。',
        'tutor-note',
      ),
    );
  const status = el('p', '', 'tutor-meta'),
    alert = el('p', '', 'tutor-alert');
  alert.setAttribute('role', 'alert');
  root.append(status, alert);
  const policyBox = el('details', undefined, 'tutor-policy'),
    summary = el('summary', '教师设置'),
    enabled = el('input'),
    peerEnabled = el('input'),
    guidance = el('textarea');
  enabled.type = peerEnabled.type = 'checkbox';
  guidance.maxLength = 2000;
  guidance.setAttribute('aria-label', '教师学习提示');
  const policySave = button('保存辅导设置', async () => {
    await act(policySave, async () => {
      await post({
        type: 'SET_POLICY',
        mode,
        revision: policyBase ?? policy.revision,
        enabled: enabled.checked,
        ...(policy.peer_enabled !== undefined ? { peerEnabled: peerEnabled.checked } : {}),
        guidance: guidance.value,
      });
      policyDirty = false;
      policyBase = null;
      dirty('policy', false);
      await refresh();
    });
  });
  const policyConflict = el('p', '', 'tutor-alert');
  const reloadPolicy = button('重新载入辅导设置', async () => {
    if (policyDirty && !confirm('重新载入会放弃尚未保存的辅导设置，是否继续？')) return;
    policyDirty = false;
    policyBase = null;
    dirty('policy', false);
    try {
      await refresh();
    } catch (e) {
      fail(e);
    }
  });
  policyBox.append(
    summary,
    label('为本教学班启用 AI 辅导', enabled),
    label('另行启用 AI 学习伙伴（私人学习讨论，不是真实同学）', peerEnabled),
    label('教师学习提示（师生可见）', guidance),
    el(
      'p',
      '关闭后不能新建或继续提问；生成中的回答也不会交付。已有私人历史仍可由本人查看。',
      'tutor-meta',
    ),
    policySave,
    reloadPolicy,
    policyConflict,
  );
  if (mode === 'TEACHER') root.append(policyBox);
  for (const n of [enabled, peerEnabled, guidance])
    n.addEventListener('input', () => {
      if (!policyDirty) policyBase = policy.revision;
      policyDirty = true;
      dirty('policy', true);
    });
  const layout = el('div', undefined, 'tutor-layout'),
    left = el('section', undefined, 'tutor-panel'),
    right = el('section', undefined, 'tutor-panel');
  layout.append(left, right);
  root.append(layout);
  const title = el('input'),
    source = el('select'),
    style = el('select');
  style.append(new Option('AI 辅导', 'TUTOR'), new Option('AI 学习伙伴', 'PEER'));
  style.setAttribute('aria-label', '对话方式');
  title.maxLength = 120;
  title.placeholder = '例如：复习串联电路';
  title.setAttribute('aria-label', '新对话标题');
  source.setAttribute('aria-label', '引用已发布讲义');
  source.append(new Option('不引用讲义，进行概念辅导', ''));
  for (const n of [title, source, style])
    n.addEventListener('input', () => dirty('new', !!title.value || !!source.value));
  const create = button('新建私人对话', async () =>
    act(create, async () => {
      const result = await post({
        type: 'CREATE_SESSION',
        mode,
        title: title.value,
        resourceId: source.value || null,
        ...(policy.peer_enabled !== undefined ? { style: style.value } : {}),
      });
      dirty('new', false);
      title.value = '';
      source.value = '';
      await select(result.id);
    }),
  );
  const sessions = el('div', undefined, 'tutor-sessions'),
    pager = el('div');
  const prev = button('上一页', async () => {
      if (page) {
        page--;
        after = cursors[page];
        await refreshList();
      }
    }),
    next = button('下一页', async () => {
      page++;
      after = cursors[page];
      await refreshList();
    });
  pager.append(prev, next);
  left.append(
    el('h2', '我的课程对话'),
    label('对话方式', style),
    label('对话主题', title),
    label('讲义上下文', source),
    el('p', '只引用可访问的已发布文字。图片、互动页和超长讲义暂不作为辅导上下文。', 'tutor-meta'),
    create,
    sessions,
    pager,
  );
  const heading = el('h2', '选择或新建对话'),
    reference = el('p', '', 'tutor-meta'),
    messages = el('div'),
    question = el('textarea');
  question.maxLength = 2000;
  question.setAttribute('aria-label', '向 AI 提问');
  question.placeholder = '写下你的疑问，也可以说明已经尝试过的思路。';
  question.addEventListener('input', () => dirty('question', !!question.value || !!pending));
  const send = button('发送问题', async () =>
    act(send, async () => {
      if (!pending)
        pending = {
          key: crypto.randomUUID(),
          payload: {
            type: 'ASK',
            mode,
            id: selected,
            revision: session.revision,
            message: question.value,
          },
        };
      dirty('question', true);
      await post(pending.payload, pending.key);
      pending = null;
      question.value = '';
      dirty('question', false);
      await refreshSession();
    }),
  );
  const cancel = button('停止生成', async () =>
    act(cancel, async () => {
      const run = messages.dataset.running;
      if (run) await post({ type: 'CANCEL', mode, id: selected, turnId: run });
      await refreshSession();
    }),
  );
  const close = button('结束此对话', async () =>
    act(close, async () => {
      if (pending) {
        alert.textContent = '请先重试确认上一条提交结果。';
        return;
      }
      if (question.value && !confirm('结束对话会放弃尚未发送的问题，是否继续？')) return;
      await post({ type: 'CLOSE_SESSION', mode, id: selected, revision: session.revision });
      question.value = '';
      dirty('question', false);
      await refreshSession();
      await refreshList();
    }),
  );
  const compose = el('div');
  compose.append(
    label('问题（最多 2000 字）', question),
    send,
    cancel,
    close,
    el(
      'p',
      '每个对话最多 30 次提问；每人每教学班同时生成一条。停止或网络中断不保证供应商侧不计费。',
      'tutor-meta',
    ),
  );
  right.append(heading, reference, messages, compose);
  compose.hidden = true;
  async function api(path, payload, key) {
    const headers = { 'x-zhiban-request': 'identity-v1' },
      signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]);
    if (payload) {
      const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store', signal });
      if (!r.ok) throw Object.assign(Error('登录已失效。'), { blocked: true });
      headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
      headers['content-type'] = 'application/json';
      headers['x-zhiban-command'] = key;
    }
    const r = await fetch(path, {
        method: payload ? 'POST' : 'GET',
        headers,
        cache: 'no-store',
        signal,
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      }),
      data = await r.json();
    if (!r.ok)
      throw Object.assign(
        Error(
          [401, 403].includes(r.status)
            ? '账户、角色或课程关系已变化，请返回工作台。'
            : r.status === 404
              ? '此私人对话不可访问。'
              : r.status === 409
                ? '辅导设置、讲义或对话已变化，或已有问题正在生成。请核对最新状态；讲义更新后请新建对话。'
                : r.status === 400
                  ? '请检查必填文字；只支持最多 12000 字的已发布文字讲义。'
                  : '服务或模型暂不可用。提交结果不确定时请重试同一提交。',
        ),
        {
          blocked: [401, 403, 404].includes(r.status),
          definitive: r.status >= 400 && r.status < 500,
        },
      );
    return data;
  }
  const uncertainKeys = new Map();
  async function post(payload, key) {
    const intent = JSON.stringify(payload);
    key ??= uncertainKeys.get(intent) ?? crypto.randomUUID();
    uncertainKeys.set(intent, key);
    try {
      const result = await api(base, payload, key);
      uncertainKeys.delete(intent);
      return result;
    } catch (e) {
      if (e.definitive) uncertainKeys.delete(intent);
      if (e.definitive && payload === pending?.payload) {
        pending = null;
        dirty('question', !!question.value);
      }
      throw e;
    }
  }
  function fail(e) {
    alert.textContent = e.message;
    if (e.blocked) {
      stopped = true;
      messages.replaceChildren();
      sessions.replaceChildren();
      compose.hidden = true;
      create.disabled = true;
      policyBox.hidden = true;
    }
  }
  async function act(b, fn) {
    if (commandBusy) return;
    commandBusy = true;
    b.disabled = true;
    alert.textContent = '';
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      commandBusy = false;
      controls();
      if (!stopped && b !== send && b !== create && b !== cancel && b !== close) b.disabled = false;
    }
  }
  function updatePolicy(data) {
    policy = data.policy;
    capability = data.capability;
    status.textContent =
      (policy.enabled ? '教师已启用本班 AI 辅导。' : '教师尚未启用本班 AI 辅导。') +
      (capability.tools ? ' 可只读检索所选固定讲义。' : ' 当前模型未声明工具能力，使用文字辅导。') +
      (capability.vision ? ' 支持受限已发布图片解读。' : ' 当前模型未声明视觉能力，不解读图片。') +
      (capability.ready ? ' 模型已配置。' : ' 模型尚不可用，请联系教师或管理员配置。') +
      (policy.guidance ? ' 教师提示：' + policy.guidance : '');
    policyConflict.textContent =
      policyDirty && policyBase !== policy.revision
        ? '辅导设置已被其他操作更新。输入已保留，请先核对或重新载入；保存不会静默覆盖新版本。'
        : '';
    peerEnabled.disabled = policy.peer_enabled === undefined;
    style.options[1].disabled = !policy.peer_enabled;
    if (!policy.peer_enabled) style.value = 'TUTOR';
    if (!policyDirty) {
      enabled.checked = policy.enabled;
      peerEnabled.checked = policy.peer_enabled === true;
      guidance.value = policy.guidance;
    }
    controls();
  }
  function controls() {
    const running = !!messages.dataset.running,
      open = session?.state === 'OPEN';
    create.disabled = stopped || commandBusy || !policy.enabled;
    send.disabled =
      stopped ||
      commandBusy ||
      !open ||
      running ||
      !policy.enabled ||
      (session?.style === 'PEER' && !policy.peer_enabled) ||
      !capability.ready;
    send.textContent = pending ? '重试同一提交' : '发送问题';
    question.disabled = stopped || !!pending || !open;
    cancel.hidden = !running;
    cancel.disabled = stopped || commandBusy;
    close.disabled = stopped || commandBusy || !open;
  }
  async function refreshList() {
    const data = await api(
      base + '?' + new URLSearchParams({ mode, ...(after ? { cursor: after } : {}) }),
    );
    updatePolicy(data);
    sessions.replaceChildren();
    for (const s of data.rows) {
      const b = button(
        s.title +
          (s.style === 'PEER' ? ' · AI 学习伙伴' : ' · AI 辅导') +
          (s.state === 'CLOSED' ? ' · 已结束' : ''),
        () => select(s.id),
      );
      b.setAttribute('aria-current', String(s.id === selected));
      sessions.append(b);
    }
    if (!data.rows.length) sessions.append(el('p', '还没有对话。', 'tutor-meta'));
    cursors[page + 1] = data.next;
    prev.disabled = page === 0;
    next.disabled = !data.next;
    const old = source.value;
    source.replaceChildren(new Option('不引用讲义，进行概念辅导', ''));
    for (const r of data.resources)
      source.append(new Option(`${r.title} · 发布第 ${r.publicationNo} 版`, r.id));
    source.value = old;
  }
  async function refreshSession() {
    if (!selected) return;
    const expected = selected,
      data = await api(base + '?' + new URLSearchParams({ mode, id: selected }));
    if (expected !== selected) return;
    session = data.session;
    updatePolicy(data);
    heading.textContent =
      session.title +
      (session.style === 'PEER' ? ' · AI 学习伙伴' : ' · AI 辅导') +
      (session.state === 'CLOSED' ? ' · 已结束' : '');
    reference.textContent = session.source
      ? `固定讲义：${session.source.title} · 发布第 ${session.source.publicationNo} 版。更换或重新发布讲义后，请新建对话。`
      : '未引用讲义；回答不会读取其他课程数据。';
    messages.replaceChildren();
    delete messages.dataset.running;
    const states = {
      RUNNING: '正在生成…',
      FAILED: '生成失败，可重新提问。',
      CANCELLED: '已停止，未交付回答。',
      BLOCKED: '权限、讲义或教师设置变化，回答未交付。请核对后新建对话。',
      EXPIRED: '生成已过期；服务不会自动重发。',
    };
    for (const t of data.rows) {
      const block = el('article', undefined, 'tutor-turn');
      block.append(el('p', '我：' + t.question, 'tutor-text tutor-question'));
      if (t.state === 'COMPLETED') {
        block.append(
          el('p', 'AI 学习建议', 'tutor-meta'),
          el('div', t.answer, 'tutor-text tutor-answer'),
        );
      } else block.append(el('p', states[t.state] ?? '未完成', 'tutor-meta'));
      if (t.model && t.state === 'COMPLETED')
        block.append(el('p', `${t.model.provider} / ${t.model.model}`, 'tutor-meta'));
      if (t.state === 'RUNNING') messages.dataset.running = t.id;
      messages.append(block);
    }
    if (!data.rows.length) messages.append(el('p', '从一个具体疑问开始。', 'tutor-meta'));
    compose.hidden = false;
    controls();
  }
  async function select(id) {
    if (id === selected) return;
    if (pending) {
      alert.textContent = '请先重试确认上一条提交结果。';
      return;
    }
    if (question.value && !confirm('切换对话会放弃尚未发送的问题，是否继续？')) return;
    selected = id;
    question.value = '';
    dirty('question', false);
    history.replaceState(null, '', '#session-' + id);
    await refreshSession();
    await refreshList();
  }
  async function refresh() {
    await refreshList();
    await refreshSession();
  }
  try {
    const match = /^#session-([0-9a-f-]{36})$/.exec(location.hash);
    selected = match ? match[1] : null;
    await refresh();
    root.setAttribute('aria-busy', 'false');
  } catch (e) {
    fail(e);
    root.setAttribute('aria-busy', 'false');
  }
  const timer = setInterval(async () => {
    if (stopped || reading || commandBusy) return;
    reading = true;
    try {
      if (selected) await refreshSession();
      else {
        const data = await api(base + '?mode=' + mode);
        updatePolicy(data);
      }
    } catch (e) {
      fail(e);
    } finally {
      reading = false;
    }
  }, 2500);
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearInterval(timer);
      abort.abort();
    },
    { once: true },
  );
})();
