/* Own published learning records only. Credentials stay in the HttpOnly cookie. */
(async () => {
  if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
  const root = document.getElementById('personal'),
    params = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
  const tenant = params.get('tenant'),
    offering = params.get('offering');
  let generation = 0,
    controller,
    state,
    filter = 'ALL';
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  const labels = {
    NEW: '尚未开始',
    STARTED: '已开始 · 未提交',
    WAITING: '已提交 · 待发布成绩',
    GRADED: '成绩已发布',
  };
  function status(a) {
    return !a
      ? 'NEW'
      : a.gradeVersion !== null
        ? 'GRADED'
        : a.submissionVersion !== null
          ? 'WAITING'
          : 'STARTED';
  }
  function date(n) {
    return n === null ? '—' : new Date(n).toLocaleString('zh-CN');
  }
  function score(a) {
    return !a || a.gradeVersion === null ? '—' : a.scorePoints / 100 + ' / ' + a.maxPoints / 100;
  }
  function clear() {
    state = null;
    root.replaceChildren();
  }
  function error(text) {
    clear();
    const p = el('p', text, 'notice');
    p.setAttribute('role', 'alert');
    root.append(p);
    const back = el('a', '返回工作台', 'button secondary');
    back.href = '/zhiban';
    root.append(back);
  }
  function publication(parent, a) {
    if (!a || a.gradeVersion === null) return;
    const box = el('div', undefined, 'published-feedback');
    box.append(
      el('p', '已发布成绩 ' + score(a) + ' · v' + a.gradeVersion + ' · ' + date(a.publishedAt)),
    );
    if (a.feedback) box.append(el('p', '教师反馈：' + a.feedback, 'feedback-text'));
    if (a.correctionReason) box.append(el('p', '更正说明：' + a.correctionReason, 'feedback-text'));
    parent.append(box);
  }
  function render() {
    root.replaceChildren();
    const heading = el('div', undefined, 'personal-heading'),
      intro = el('div');
    intro.append(el('p', '我的学习', 'eyebrow'), el('h1', state.offering.title));
    const refresh = el('button', '刷新数据', 'button secondary');
    refresh.type = 'button';
    refresh.onclick = () => void load();
    heading.append(intro, refresh);
    root.append(heading);
    root.append(el('p', '查询时间：' + date(state.asOf), 'muted'));
    const back = el(
      'a',
      nestedContext ? '返回课程工作区' : '返回工作台继续学习',
      'button secondary',
    );
    back.href = courseReturn;
    if (!window.zhibanCoursePage?.embedded) root.append(back);
    const cards = el('section', undefined, 'personal-metrics');
    cards.setAttribute('aria-label', '我的学习汇总');
    const s = state.summary;
    for (const [name, value] of [
      ['当前发布活动', s.activities],
      ['已开始', s.started],
      ['已提交', s.submitted],
      ['未提交', s.notSubmitted],
      ['成绩已发布', s.graded],
      ['待发布成绩', s.awaitingGrade],
      ['平均得分率', s.averagePercent === null ? '—' : s.averagePercent + '%'],
    ]) {
      const c = el('article', undefined, 'card');
      c.append(el('span', name), el('strong', String(value)));
      cards.append(c);
    }
    root.append(
      cards,
      el(
        'p',
        '汇总仅计算当前发布版本，每项活动取最新尝试及其最新提交。仅计已发布人工成绩；平均得分率为各活动得分率的未加权平均，不是课程总评。',
        'personal-note',
      ),
    );
    root.append(el('h2', '当前学习活动'));
    if (!state.activities.length)
      root.append(el('p', '暂无当前发布活动。已有尝试仍可在下方历史记录中查看。', 'empty-state'));
    else {
      const label = el('label', '筛选活动状态'),
        select = el('select');
      for (const [key, value] of Object.entries({ ALL: '全部活动', ...labels })) {
        const o = el('option', value);
        o.value = key;
        o.selected = key === filter;
        select.append(o);
      }
      label.append(select);
      root.append(label);
      const count = el('p', undefined, 'muted');
      count.setAttribute('aria-live', 'polite');
      const list = el('div', undefined, 'personal-activities');
      root.append(count, list);
      function activities() {
        list.replaceChildren();
        const selected = state.activities.filter(
          (a) => filter === 'ALL' || status(a.latest) === filter,
        );
        count.textContent = '显示 ' + selected.length + ' / ' + state.activities.length + ' 项活动';
        for (const a of selected) {
          const card = el('article', undefined, 'card personal-activity');
          card.append(
            el('h3', a.title),
            el(
              'span',
              labels[status(a.latest)],
              'personal-status ' + status(a.latest).toLowerCase(),
            ),
          );
          card.append(
            el(
              'p',
              '发布版本 ' +
                a.version +
                ' · 截止时间：' +
                (a.deadlineAt === null ? '未设置' : date(a.deadlineAt)),
              'muted',
            ),
          );
          if (a.latest)
            card.append(
              el(
                'p',
                '最新尝试 #' +
                  a.latest.attemptNo +
                  ' · ' +
                  (a.latest.submissionVersion === null
                    ? '尚未提交'
                    : '提交 v' + a.latest.submissionVersion + ' · ' + date(a.latest.submittedAt)),
              ),
            );
          publication(card, a.latest);
          list.append(card);
        }
        if (!selected.length) list.append(el('p', '没有符合筛选条件的活动。', 'empty-state'));
      }
      select.onchange = () => {
        filter = select.value;
        activities();
      };
      activities();
    }
    root.append(
      el('h2', '我的尝试与历史成绩'),
      el(
        'p',
        '包含旧发布版本和已撤下活动的本人尝试。每次尝试仅展示最新提交及其最新已发布成绩，历史记录不重复计入当前汇总。',
        'personal-note',
      ),
    );
    if (!state.history.length) root.append(el('p', '你还没有开始学习活动。', 'empty-state'));
    for (const a of state.history) {
      const details = el('details', undefined, 'personal-history');
      details.append(
        el(
          'summary',
          a.title +
            ' · 发布版本 ' +
            a.activityVersion +
            ' · 尝试 #' +
            a.attemptNo +
            ' · ' +
            labels[status(a)],
        ),
      );
      const body = el('div');
      body.append(
        el(
          'p',
          a.submissionVersion === null
            ? '尚未提交'
            : '提交 v' + a.submissionVersion + ' · ' + date(a.submittedAt),
        ),
      );
      publication(body, a);
      details.append(body);
      root.append(details);
    }
  }
  async function load() {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const requestController = controller;
    const timer = setTimeout(() => requestController.abort(), 10000);
    clear();
    root.setAttribute('aria-busy', 'true');
    root.append(el('p', '正在读取你的学习概览…', 'muted'));
    try {
      const r = await fetch(
        '/api/zhiban/progress/' +
          encodeURIComponent(tenant) +
          '/offerings/' +
          encodeURIComponent(offering),
        {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: requestController.signal,
        },
      );
      if (current !== generation) return;
      if (!r.ok) {
        error(
          r.status === 401
            ? '登录已失效，请返回工作台重新登录。'
            : r.status === 403
              ? '当前身份无法查看该教学班的个人概览。'
              : '学习概览暂不可用，请稍后从工作台重新进入。',
        );
        return;
      }
      const result = await r.json();
      if (current !== generation) return;
      state = result;
      render();
    } catch {
      if (current === generation) error('读取失败，请检查连接后从工作台重新进入。');
    } finally {
      clearTimeout(timer);
      if (current === generation) root.setAttribute('aria-busy', 'false');
    }
  }
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  if (channel)
    channel.onmessage = () => {
      generation++;
      controller?.abort();
      root.setAttribute('aria-busy', 'false');
      error('登录状态已变化，请返回工作台。');
    };
  window.addEventListener('pagehide', () => {
    generation++;
    controller?.abort();
    clear();
    channel?.close();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const course = params.get('course');
  const simpleContext = [...params.keys()].sort().join(',') === 'offering,tenant';
  const nestedContext =
    [...params.keys()].sort().join(',') === 'course,offering,role,tenant' &&
    params.get('role') === 'student' &&
    uuid.test(course);
  const validContext = simpleContext || nestedContext;
  const courseReturn = nestedContext
    ? `/zhiban/student/courses/${course}/grades?space=${tenant}&offering=${offering}`
    : '/zhiban?space=' + encodeURIComponent(tenant || '');
  if (!tenant || !offering || !uuid.test(tenant) || !uuid.test(offering) || !validContext) {
    error('教学班地址无效，请从工作台进入个人概览。');
    root.setAttribute('aria-busy', 'false');
  } else void load();
})();
