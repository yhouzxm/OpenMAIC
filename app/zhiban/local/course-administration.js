/* Teacher read-only projection; no management commands or Identity directory access. */
(async () => {
  const shell = window.zhibanCoursePage;
  if (!shell || !(await shell.ready)) return;
  const root = document.getElementById('course-administration'),
    params = new URLSearchParams(shell.query),
    tenant = params.get('tenant'),
    offering = params.get('offering');
  const teachers = location.pathname.endsWith('/teachers'),
    info = shell.info;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const link = (title, part) => {
    const a = el('a', title);
    a.className = 'button secondary';
    a.href = shell.href(part);
    return a;
  };
  if (!teachers) {
    root.append(
      el('h1', '课程设置'),
      el(
        'p',
        '课程及教学班基础配置由管理员维护。这里展示本教学班引用的课程版本与当前配置；教师不在此修改课程负责人、容量、状态或任教关系。',
      ),
    );
    const list = el('dl');
    list.setAttribute('aria-label', '当前课程与教学班配置');
    for (const [name, value] of [
      ['课程名称', info.course_name],
      ['课程说明', info.course_description || '未填写'],
      ['引用课程版本', info.course_version],
      ['教学班名称', info.name],
      ['教学班代码', info.code],
      ['所属学期', info.term_name],
      ['教学班容量', info.capacity],
      ['教学班状态', info.status === 'OPEN' ? '开放' : '关闭'],
      ['教学班配置版本', info.revision],
    ])
      list.append(el('dt', name), el('dd', String(value)));
    root.append(
      list,
      el('h2', '教师可用的教学设置'),
      link('进入目录编排', ''),
      link('编辑讲义与图片', 'resources'),
      link('教师 AI 备课', 'agents'),
      link('设置课程 AI 辅导', 'tutor'),
      link('查看任教名单', 'teachers'),
    );
    const refresh = el('button', '刷新课程配置');
    refresh.onclick = () => location.reload();
    root.append(refresh);
    return;
  }
  let q = '',
    limit = '20',
    cursors = [null],
    index = 0,
    busy = false,
    dead = false;
  const controller = new AbortController();
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
  const stop = () => {
    dead = true;
    controller.abort();
    channel?.close();
    root.replaceChildren(el('p', '会话已变化，请从我的课程重新进入。'));
  };
  if (channel) channel.onmessage = stop;
  window.addEventListener('pagehide', stop, { once: true });
  async function load() {
    if (busy || dead) return;
    busy = true;
    root.querySelectorAll('input,select,button').forEach((n) => (n.disabled = true));
    try {
      const p = new URLSearchParams({ offering, q, limit });
      if (cursors[index]) p.set('cursor', cursors[index]);
      const r = await fetch(`/api/zhiban/workspace/${tenant}/teachers?${p}`, {
        headers: { 'x-zhiban-request': 'identity-v1' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!r.ok)
        throw Error(
          [401, 403].includes(r.status)
            ? '任教资格或会话已变化，请返回我的课程重新进入。'
            : '任教名单暂不可用，请刷新重试。',
        );
      const data = await r.json();
      if (dead) return;
      root.replaceChildren(
        el('h1', '任教名单'),
        el(
          'p',
          '只列本教学班当前任教关系及已登记姓名，不展示联系方式、登录标识或角色权限。关系记录不代表实时有效授权；实际访问仍需有效身份角色与任教关系共同满足。',
        ),
      );
      const form = el('form');
      form.className = 'course-filters';
      const label = el('label', '搜索任教姓名'),
        search = el('input');
      search.value = q;
      search.maxLength = 120;
      label.append(search);
      const sizeLabel = el('label', '任教名单每页条数'),
        size = el('select');
      size.setAttribute('aria-label', '任教名单每页条数');
      for (const v of ['10', '20', '50']) size.append(new Option(v, v));
      size.value = limit;
      sizeLabel.append(size);
      const submit = el('button', '查询任教名单');
      submit.type = 'submit';
      form.append(label, sizeLabel, submit);
      form.onsubmit = (e) => {
        e.preventDefault();
        if (busy) return;
        q = search.value.trim();
        limit = size.value;
        cursors = [null];
        index = 0;
        void load();
      };
      root.append(form);
      const list = el('section');
      list.setAttribute('aria-label', '本教学班任教关系');
      root.append(list);
      for (const row of data.rows) {
        const card = el('article');
        card.className = 'learning-activity';
        card.append(
          el('h2', row.name || '未登记姓名'),
          el('p', '任教关系：当前'),
          el('p', '任教起始：' + new Date(Number(row.valid_from)).toLocaleString('zh-CN')),
        );
        list.append(card);
      }
      if (!data.rows.length) list.append(el('p', '暂无匹配的任教关系。'));
      const button = (text, fn, disabled = false) => {
        const b = el('button', text);
        b.type = 'button';
        b.disabled = disabled;
        b.onclick = () => void fn();
        return b;
      };
      root.append(
        button(
          '上一页任教名单',
          () => {
            index--;
            return load();
          },
          index === 0,
        ),
        el('span', `第 ${index + 1} 页 · 本页 ${data.rows.length} 条`),
        button(
          '下一页任教名单',
          () => {
            cursors[index + 1] = data.nextCursor;
            index++;
            return load();
          },
          !data.nextCursor || index >= 99,
        ),
        button('刷新任教名单', load),
        link('查看课程设置', 'settings'),
      );
    } catch (e) {
      if (!dead) {
        root.replaceChildren(el('h1', '任教名单'), el('p', e.message), link('返回课程概览', ''));
        const retry = el('button', '重试任教名单');
        retry.onclick = () => {
          cursors = [null];
          index = 0;
          void load();
        };
        root.append(retry);
      }
    } finally {
      busy = false;
    }
  }
  await load();
})();
