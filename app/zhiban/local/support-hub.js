/* Read-only course navigation. Teacher private risk reviews never enter student requests. */
(async () => {
  const root = document.getElementById('support-hub');
  const route =
    /^\/zhiban\/(teacher|student)\/courses\/([0-9a-f-]{36})\/(profiles|risks|analysis|support)$/.exec(
      location.pathname,
    );
  const input = new URLSearchParams(location.search),
    uuid = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v ?? '');
  const role = route?.[1],
    course = route?.[2],
    kind = ['profiles', 'analysis'].includes(route?.[3]) ? 'profile' : 'support';
  const tenant = input.get('space'),
    offering = input.get('offering'),
    hubCourse = input.get('hubCourse');
  const globalPath = `/zhiban/${role}/${kind === 'support' ? 'risks' : role === 'teacher' ? 'profiles' : 'profile'}`;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const link = (text, href) => {
    const n = el('a', text);
    n.href = href;
    n.className = 'button secondary';
    return n;
  };
  const globalHref = () => {
    if (!route) return '/zhiban';
    const p = new URLSearchParams();
    if (uuid(tenant)) p.set('space', tenant);
    if (hubCourse || !uuid(offering)) p.set('courseId', course);
    return globalPath + (p.size ? '?' + p : '');
  };
  let dead = false;
  const controller = new AbortController();
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  const stop = () => {
    dead = true;
    controller.abort();
    channel?.close();
    root.replaceChildren(
      el('p', '会话已变化，请返回工作台重新进入。'),
      link('返回工作台', '/zhiban'),
    );
  };
  if (channel) channel.onmessage = stop;
  window.addEventListener('pagehide', stop, { once: true });
  function error(text) {
    if (!dead)
      root.replaceChildren(
        el('h1', '学习证据与支持'),
        el('p', text),
        link('返回画像与支持课程列表', globalHref()),
        link('返回工作台', '/zhiban' + (uuid(tenant) ? '?space=' + tenant : '')),
      );
  }
  if (
    !route ||
    !uuid(course) ||
    (role === 'teacher'
      ? !['profiles', 'risks'].includes(route[3])
      : !['analysis', 'support'].includes(route[3])) ||
    [...input.keys()].some((k) => !['space', 'offering', 'hubCourse'].includes(k)) ||
    new Set(input.keys()).size !== [...input.keys()].length ||
    (tenant !== null && !uuid(tenant)) ||
    (offering !== null && !uuid(offering)) ||
    (hubCourse !== null && hubCourse !== course)
  ) {
    error('课程支持地址无效，请从工作台进入。');
    return;
  }
  if (!tenant || !offering) {
    error('请先选择课程所在空间和教学班。');
    return;
  }
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(`/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=50`, {
      headers: { 'x-zhiban-request': 'identity-v1' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!r.ok)
      throw Error(
        r.status === 401 ? '请先返回工作台登录。' : '当前课程不可访问，或课程关系已变化。',
      );
    const data = await r.json(),
      row =
        data.mode === 'MEMBER' &&
        data.rows.find(
          (o) => o.id === offering && o.course_id === course && o.mode === role.toUpperCase(),
        );
    if (!row) throw Error('当前课程不可访问，或课程关系已变化。');
    if (dead) return;
    root.replaceChildren(
      el('h1', kind === 'profile' ? '课程学习证据与观察' : '课程风险与学习支持'),
      el('h2', row.course_name),
      el('p', `${row.name} · ${row.term_name} · ${row.status === 'OPEN' ? '开放' : '关闭'}`),
      link('返回画像与支持课程列表', globalHref()),
      link(
        '返回课程工作区',
        `/zhiban/${role}/courses/${course}?space=${tenant}&offering=${offering}`,
      ),
    );
    root.append(
      el(
        'p',
        '画像维度仍在审阅中。此处展示学习证据，不计算能力分、排名或自动诊断，不根据空数据判断掌握程度。',
      ),
    );
    root.append(
      el(
        'p',
        role === 'teacher'
          ? '规则审阅与跟进记录按现有任教权限保持私有；只有明确发布的内容才向学生展示。'
          : '这里只进入本人已公开的观察、纠错、提醒和补救任务；不展示教师私有风险标签或审阅记录。',
      ),
    );
    const links =
      kind === 'profile'
        ? [
            ['learning-profile', '学习证据与教师观察', '查看可追溯来源、已发布观察及纠错处理。'],
            [
              'concepts',
              '概念证据与纠错',
              '沿已有正式来源与教师明确判断核对；失分不直接等于概念错误。',
            ],
            [
              'grades',
              role === 'teacher' ? '课程成绩簿' : '本人课程成绩',
              '沿用正式发布成绩，不生成能力维度。',
            ],
          ]
        : role === 'teacher'
          ? [
              ['risk', '风险规则与教师审阅', '查看规则事实与私有人工审阅，不自动处分。'],
              ['analytics', '待跟进与教学统计', '进入原教师统计、待跟进名单及人工记录。'],
              ['remediation', '补救计划与效果回看', '按已有发布、学生任务和教师评估闭环处理。'],
              ['concepts', '概念证据与纠错', '按现有精确授权处理证据与发布。'],
            ]
          : [
              ['reminders', '本人站内提醒与回执', '读取不会自动确认，也不代表完成学习。'],
              ['remediation', '本人补救任务与反馈', '沿原任务、本人反馈和教师复核回看。'],
              ['concepts', '本人公开概念纠错', '只读取本人可见的明确发布记录。'],
              ['learning-profile', '本人已发布学习观察', '核对证据，使用原本人纠错入口。'],
            ];
    const list = el('section');
    list.setAttribute('aria-label', '已有画像与支持功能');
    root.append(list);
    for (const [part, title, description] of links) {
      const card = el('article');
      card.className = 'learning-activity';
      const q = new URLSearchParams({ space: tenant, offering, supportFrom: kind });
      if (hubCourse) q.set('hubCourse', hubCourse);
      card.append(
        el('h2', title),
        el('p', description),
        link(
          '打开' + title,
          `/zhiban/${role}/courses/${course}/${part}?${q}${part === 'analytics' ? '#followups' : ''}`,
        ),
      );
      list.append(card);
    }
    const other = kind === 'profile' ? 'support' : 'profile',
      section =
        other === 'profile'
          ? role === 'teacher'
            ? 'profiles'
            : 'analysis'
          : role === 'teacher'
            ? 'risks'
            : 'support';
    root.append(
      link(
        kind === 'profile' ? '查看本课程学习支持' : '查看本课程学习证据',
        `/zhiban/${role}/courses/${course}/${section}?space=${tenant}&offering=${offering}${hubCourse ? '&hubCourse=' + hubCourse : ''}`,
      ),
    );
  } catch (e) {
    error(e.message);
  } finally {
    clearTimeout(timer);
  }
})();
