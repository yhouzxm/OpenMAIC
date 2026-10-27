/* Course chrome only. Every business read/write remains server-authorized. */
(() => {
  // Reuse the portal's local vector presentation on standalone course surfaces.
  if (!window.zhibanAdminShell && !document.querySelector('script[src="/zhiban/admin-shell.js"]')) {
    const presentation = document.createElement('script');
    presentation.src = '/zhiban/admin-shell.js';
    document.head.append(presentation);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const path =
    /^\/zhiban\/(teacher|student)\/courses\/([0-9a-f-]{36})\/(settings|teachers|tools|agents|resources|grades|analytics|reminders|remediation|risk|concepts|learning-profile|attainment|auto-grading|evidence-profile|tutor|classroom-plan|pbl|learning-center)(?:\/([0-9a-f-]{36}))?$/.exec(
      location.pathname,
    );
  const input = new URLSearchParams(location.search);
  const authoringEntry = path?.[1] === 'teacher' && path?.[3] === 'agents';
  const toolsEntry = path?.[1] === 'student' && path?.[3] === 'tools';
  const surface = document.body.dataset.courseSurface;
  const embedded = !!path || input.has('course') || input.has('role');
  const role = path?.[1] ?? input.get('role');
  const course = path?.[2] ?? input.get('course');
  const tenant = input.get(path ? 'space' : 'tenant');
  const offering = input.get('offering');
  const section =
    path?.[3] ??
    {
      content: 'resources',
      grading: 'grades',
      analytics: 'analytics',
      progress: 'grades',
      reminder: 'reminders',
      remediation: 'remediation',
      risk: 'risk',
      concept: 'concepts',
      learner: 'learning-profile',
      ema: 'evidence-profile',
      attainment: 'attainment',
      'auto-grading': 'auto-grading',
      tutor: 'tutor',
      flow: 'classroom-plan',
      pbl: 'pbl',
    }[surface];
  const query = path
    ? new URLSearchParams({ tenant, offering, course, role }).toString()
    : location.search;
  let authorizedOffering = null,
    authorizedInfo = null;
  const dirty = new Map();
  let leaving = false;
  const setDirty = (key, value, root) => {
    if (value) {
      dirty.set(key, root);
      leaving = false;
    } else dirty.delete(key);
  };
  document.addEventListener(
    'click',
    (event) => {
      const control = event.target.closest?.('a[href],button');
      if (!control || !dirty.size || control.disabled || event.defaultPrevented) return;
      if (control.dataset.courseLogout || control.closest('dialog[data-course-logout-dialog]'))
        return;
      if (
        control.tagName === 'BUTTON' &&
        control.dataset.courseInPlace === 'content-adoption' &&
        control.closest('.lesson-panel')
      )
        return;
      if (
        control.tagName === 'BUTTON' &&
        [...dirty.values()].some((root) => root?.contains(control))
      )
        return;
      if (!confirm('有未保存的修改，确认放弃修改并离开？')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (control.tagName === 'A') leaving = true;
    },
    true,
  );
  window.addEventListener('beforeunload', (event) => {
    if (dirty.size && !leaving) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const classroomContext =
    /^#classroom-resource-([0-9a-f-]{36})-([1-9][0-9]{0,14})-([0-9a-f-]{36})$/.exec(location.hash);
  const href = (part = '') =>
    `/zhiban/${role}/courses/${course}${part ? '/' + part : ''}?space=${tenant}&offering=${offering}${part === 'agents' && input.get('aiCourse') === course ? '&aiCourse=' + course : ''}`;
  if (classroomContext) {
    const addReturn = () => {
      const a = el('a', '返回本次课堂', 'button secondary');
      a.href =
        href(role === 'teacher' ? 'classrooms' : 'coursework') +
        '#classroom-' +
        classroomContext[3];
      document.body.prepend(a);
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', addReturn, { once: true });
    else addReturn();
  }
  // Presentation adapter for the existing content bundle. Never changes content or authorization.
  // Keeping the installed bundle immutable lets the current disposable classroom stay running.
  if (surface === 'content') {
    const root = document.querySelector('main#root');
    if (root) {
      const teacherNote = '编辑草稿后保存，再显式发布。预览不产生学习完成或成绩。';
      const readerNote = '这里只展示已发布讲义。阅读预览不代表已完成作答或获得成绩。';
      const teacherEmpty = '选择教学内容以查看或编辑。';
      const readerEmpty = '请选择已发布讲义进行阅读。';
      const adapt = () => {
        const canEdit = !!root.querySelector('input[aria-label="新内容标题"]');
        for (const p of root.querySelectorAll(
          ':scope > p:not([role]), :scope > .content-layout > .content-editor > p:not([role])',
        )) {
          const text = p.textContent;
          const next = [teacherNote, readerNote].includes(text)
            ? canEdit
              ? teacherNote
              : readerNote
            : [teacherEmpty, readerEmpty].includes(text)
              ? canEdit
                ? teacherEmpty
                : readerEmpty
              : null;
          if (next && next !== text) p.textContent = next;
        }
      };
      const observer = new MutationObserver(adapt);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      adapt();
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
  }
  async function bootstrap() {
    if (!embedded) return true;
    const main = document.querySelector('main');
    const loading = el('p', '正在确认课程访问权限…', 'loading');
    main.hidden = true;
    main.before(loading);
    try {
      const keys = [...input.keys()].sort().join(',');
      const gradeCourse = input.get('gradeCourse'),
        supportFrom = input.get('supportFrom'),
        hubCourse = input.get('hubCourse'),
        aiCourse = input.get('aiCourse'),
        toolsCourse = input.get('toolsCourse');
      const expected = path
        ? [
            'offering',
            'space',
            ...(gradeCourse !== null ? ['gradeCourse'] : []),
            ...(supportFrom !== null ? ['supportFrom'] : []),
            ...(hubCourse !== null ? ['hubCourse'] : []),
            ...(aiCourse !== null ? ['aiCourse'] : []),
            ...(toolsCourse !== null ? ['toolsCourse'] : []),
          ]
            .sort()
            .join(',')
        : 'course,offering,role,tenant';
      if (
        gradeCourse !== null &&
        (!path ||
          section !== 'grades' ||
          !uuid.test(gradeCourse) ||
          gradeCourse !== course ||
          supportFrom !== null)
      )
        throw new Error('成绩返回地址无效，请从成绩入口进入。');
      if (
        supportFrom !== null &&
        (!path ||
          !['profile', 'support'].includes(supportFrom) ||
          ![
            'grades',
            'learning-profile',
            'concepts',
            'risk',
            'reminders',
            'remediation',
            'analytics',
          ].includes(section))
      )
        throw new Error('学习支持返回地址无效，请从课程入口进入。');
      if (
        hubCourse !== null &&
        (supportFrom === null || hubCourse !== course || !uuid.test(hubCourse))
      )
        throw new Error('学习支持返回地址无效，请从课程入口进入。');
      if (aiCourse !== null && (!authoringEntry || aiCourse !== course || !uuid.test(aiCourse)))
        throw new Error('备课返回地址无效，请从课程入口进入。');
      if (authoringEntry && (!tenant || !offering))
        throw new Error('请先选择备课课程所在空间和教学班。');
      if (
        toolsCourse !== null &&
        (!toolsEntry || toolsCourse !== course || !uuid.test(toolsCourse))
      )
        throw new Error('辅导返回地址无效，请从课程入口进入。');
      if (toolsEntry && (!tenant || !offering))
        throw new Error('请先选择辅导课程所在空间和教学班。');
      if (surface === 'course-administration' && (!tenant || !offering))
        throw new Error('请先在我的课程选择教学班，再进入课程设置或任教名单。');
      const expectedRole = toolsEntry
        ? ['student']
        : authoringEntry
          ? ['teacher']
          : [
                'content',
                'remediation',
                'concept',
                'learner',
                'ema',
                'attainment',
                'auto-grading',
                'tutor',
                'flow',
                'pbl',
              ].includes(surface)
            ? ['teacher', 'student']
            : [['progress', 'reminder'].includes(surface) ? 'student' : 'teacher'];
      if (
        keys !== expected ||
        !expectedRole.includes(role) ||
        ![tenant, offering, course].every((x) => uuid.test(x ?? '')) ||
        (path?.[4] && !uuid.test(path[4]))
      )
        throw new Error('课程地址无效，请从课程列表进入。');
      const response = await fetch(
        `/api/zhiban/workspace/${tenant}/courses?q=${offering}&limit=50`,
        {
          headers: { 'x-zhiban-request': 'identity-v1' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? '登录已失效，请返回工作台登录。'
            : '当前课程不可访问，或课程关系已变化。',
        );
      const data = await response.json();
      const o =
        data.mode === 'MEMBER' &&
        data.rows.find(
          (row) =>
            row.id === offering && row.course_id === course && row.mode === role.toUpperCase(),
        );
      if (!o) throw new Error('当前课程不可访问，或课程关系已变化。');
      authorizedOffering = Object.freeze({ id: o.id, status: o.status });
      authorizedInfo = Object.freeze({ ...o });
      document.body.classList.add('portal');
      document.body.dataset.screen = 'course';
      const top = document.querySelector('.topbar');
      const brand = top.querySelector('.brand');
      brand.textContent = '智伴·创学';
      brand.href = `/zhiban?space=${tenant}`;
      top.querySelector('.local').textContent =
        role === 'teacher' ? '教师课程工作区' : '学生课程工作区';
      const wrap = el('section', undefined, `course-workspace ${role}-course`);
      const hero = el('header', undefined, 'course-hero');
      const copy = el('div', undefined, 'course-hero-copy');
      const back = el('a', '← 返回我的课程', 'button secondary');
      back.href = `${role === 'teacher' ? '/zhiban/teacher/courses' : '/zhiban'}?space=${tenant}`;
      if (toolsEntry || (role === 'student' && section === 'tutor')) {
        const toolsBack = el('a', '返回 AI 学习辅导课程列表', 'button secondary');
        toolsBack.href = `/zhiban/student/tools?space=${tenant}${toolsCourse ? '&courseId=' + toolsCourse : ''}`;
        copy.append(toolsBack);
      }
      if (authoringEntry) {
        const authoringBack = el('a', '返回教师 AI 备课课程列表', 'button secondary');
        authoringBack.href = `/zhiban/teacher/agents?space=${tenant}${aiCourse ? '&courseId=' + aiCourse : ''}`;
        copy.append(authoringBack);
      }
      if (section === 'grades') {
        const gradesBack = el('a', '返回全局成绩入口', 'button secondary');
        gradesBack.href = `/zhiban/${role}/grades?space=${tenant}${gradeCourse ? '&courseId=' + gradeCourse : ''}`;
        copy.append(gradesBack);
      }
      if (supportFrom) {
        const supportBack = el('a', '返回学习证据与支持入口', 'button secondary');
        const hub =
          supportFrom === 'profile'
            ? role === 'teacher'
              ? 'profiles'
              : 'analysis'
            : role === 'teacher'
              ? 'risks'
              : 'support';
        supportBack.href = `/zhiban/${role}/courses/${course}/${hub}?space=${tenant}&offering=${offering}${hubCourse ? '&hubCourse=' + hubCourse : ''}`;
        copy.append(supportBack);
      }
      copy.append(
        back,
        el('h1', o.course_name),
        el(
          'p',
          `${o.name} · ${o.term_name} · ${o.status === 'OPEN' ? '开放' : '已关闭'} · 发布版本 ${o.course_version}`,
        ),
      );
      hero.append(copy);
      if (role === 'student') hero.append(el('div', '▤', 'course-hero-cover'));
      const body = el('div', undefined, 'course-body');
      const nav = el('nav', undefined, 'course-inner-nav');
      nav.setAttribute('aria-label', '课程内导航');
      const items =
        role === 'teacher'
          ? [
              ['', '课程概览'],
              ['classrooms', '课堂与互动'],
              ['resources', '讲义与图片'],
              ['agents', 'AI 备课'],
              ['learning-center', '学习中心'],
              ['discussions', '课程讨论'],
              ['students', '选课学生'],
              ['teachers', '任教名单'],
              ['settings', '课程设置'],
              ['grades', '学生成绩'],
              ['analytics', '教学分析'],
              ['remediation', '补救计划'],
              ['risk', '风险规则与审阅'],
              ['concepts', '概念纠错'],
              ['learning-profile', '学习观察与纠错'],
              ['evidence-profile', '六维证据与 EMA'],
              ['attainment', '校内证书'],
              ['auto-grading', 'AI 正式评分'],
              ['classroom-plan', '教案与实验'],
              ['course-results', '课堂成果与共享结果'],
              ['pbl', 'PBL 小组项目'],
              ['tutor', 'AI 学习辅导'],
            ]
          : [
              ['', '目录'],
              ['introduction', '课程简介'],
              ['coursework', '学习活动'],
              ['resources', '课程资源'],
              ['learning-center', '学习中心'],
              ['discussions', '课程讨论'],
              ['grades', '学习成绩'],
              ['reminders', '站内提醒'],
              ['remediation', '补救任务'],
              ['concepts', '概念纠错'],
              ['learning-profile', '学习观察与纠错'],
              ['evidence-profile', '六维证据与 EMA'],
              ['attainment', '校内证书'],
              ['auto-grading', 'AI 正式评分'],
              ['classroom-plan', '教案与实验'],
              ['course-results', '课堂成果与共享结果'],
              ['pbl', 'PBL 小组项目'],
              ['tools', 'AI 学习辅导'],
            ];
      for (const [part, label] of items) {
        const a = el('a', label);
        a.href = part==='course-results'?`/zhiban/course-results?tenant=${tenant}&offering=${offering}`:href(part);
        if (part === section || (role === 'student' && part === 'tools' && section === 'tutor'))
          a.setAttribute('aria-current', 'page');
        nav.append(a);
      }
      main.classList.add('course-panel', 'course-surface');
      main.removeAttribute('hidden');
      loading.replaceWith(wrap);
      body.append(nav, main);
      wrap.append(hero, body);
      document.title = `${o.course_name} · ${items.find(([part]) => part === section)?.[1] ?? '课程工作区'}`;
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      const logout = el('button', '退出登录', 'button secondary');
      logout.type = 'button';
      logout.dataset.courseLogout = 'true';
      const sessionNotice = el('span');
      sessionNotice.setAttribute('role', 'status');
      const profile = el('a', '个人资料与账户', 'button secondary');
      profile.href = `/zhiban/profile?tenant=${tenant}`;
      top.append(profile, logout, sessionNotice);
      let signingOut = false;
      logout.onclick = async () => {
        if (signingOut) return;
        signingOut = true;
        logout.disabled = true;
        if (dirty.size) {
          const confirmed = await new Promise((resolve) => {
            const dialog = el('dialog');
            dialog.dataset.courseLogoutDialog = 'true';
            dialog.setAttribute('aria-label', '退出登录确认');
            dialog.append(el('p', '有未保存修改。退出将放弃这些修改，已保存的作答和成绩会保留。'));
            const finish = (value) => {
              dialog.close();
              dialog.remove();
              resolve(value);
            };
            const stay = el('button', '取消，继续编辑', 'button secondary');
            stay.type = 'button';
            stay.onclick = () => finish(false);
            const leave = el('button', '放弃未保存修改并退出', 'button primary');
            leave.type = 'button';
            leave.onclick = () => finish(true);
            dialog.oncancel = (event) => {
              event.preventDefault();
              finish(false);
            };
            dialog.append(stay, leave);
            document.body.append(dialog);
            dialog.showModal();
            stay.focus();
          });
          if (!confirmed) {
            signingOut = false;
            logout.disabled = false;
            logout.focus();
            return;
          }
        }
        sessionNotice.textContent = '正在退出…';
        const headers = { 'x-zhiban-request': 'identity-v1' };
        const leave = () => {
          dirty.clear();
          leaving = true;
          main.hidden = true;
          channel?.postMessage('session-changed');
          location.replace('/zhiban');
        };
        try {
          const csrf = await fetch('/api/zhiban/identity/csrf', {
            headers,
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
          });
          if (csrf.status === 401) {
            leave();
            return;
          }
          if (!csrf.ok) throw Error('csrf');
          const token = (await csrf.json()).csrfToken;
          if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('csrf');
          const response = await fetch('/api/zhiban/identity/logout', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'x-zhiban-csrf': token },
            credentials: 'same-origin',
            cache: 'no-store',
            body: '{}',
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok && response.status !== 401) throw Error('logout');
          leave();
        } catch {
          sessionNotice.textContent = '退出未完成，请重试。';
          signingOut = false;
          logout.disabled = false;
        }
      };
      if (channel)
        channel.onmessage = () => {
          dirty.clear();
          leaving = true;
          channel.close();
          location.reload();
        };
      window.addEventListener(
        'pagehide',
        () => {
          dirty.clear();
          channel?.close();
        },
        { once: true },
      );
      return true;
    } catch (error) {
      main.remove();
      loading.className = 'notice';
      loading.textContent = error.message;
      const back = el('a', '返回工作台');
      back.href = '/zhiban';
      loading.after(back);
      if (authoringEntry && uuid.test(course)) {
        const select = el('a', '返回教师 AI 备课课程列表');
        select.href = `/zhiban/teacher/agents?${uuid.test(tenant ?? '') ? 'space=' + tenant + '&' : ''}courseId=${course}`;
        back.after(select);
      }
      if (toolsEntry && uuid.test(course)) {
        const select = el('a', '返回 AI 学习辅导课程列表');
        select.href = `/zhiban/student/tools?${uuid.test(tenant ?? '') ? 'space=' + tenant + '&' : ''}courseId=${course}`;
        back.after(select);
      }
      return false;
    }
  }
  window.zhibanCoursePage = {
    query,
    embedded,
    authoringEntry,
    href,
    setDirty,
    get info() {
      return authorizedInfo;
    },
    get offering() {
      return authorizedOffering;
    },
    ready: bootstrap(),
  };
})();
