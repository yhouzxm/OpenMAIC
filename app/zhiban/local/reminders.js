/* Explicit in-app confirmation. A GET never marks a reminder confirmed. */
(() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function mount(root, tenant, offering, record = null) {
    const base = `/api/zhiban/reminders/${tenant}/offerings/${offering}`;
    let disposed = false,
      busy = false,
      pending = null,
      cursors = [null],
      page = 0,
      hasPending = false;
    const controller = new AbortController();
    const heading = el('h2', record ? '学生可见提醒与回执' : '我的站内提醒');
    const help = el(
      'p',
      record
        ? '单独撰写学生可见内容；私有跟进说明不会自动发送。每条跟进最多一条待确认提醒。'
        : '点击“我已知悉”生成确认回执；查看列表不会自动确认。确认不代表完成学习或提交作业。',
      'muted',
    );
    const message = el('p', '', 'notice');
    message.setAttribute('role', 'status');
    const list = el('div'),
      toolbar = el('div'),
      refresh = el('button', '刷新提醒与回执', 'button secondary');
    root.append(heading, help, message, toolbar, list);
    toolbar.append(refresh);
    let form, title, body, submit;
    const dirty = () =>
      window.zhibanCoursePage?.setDirty(
        'reminder',
        !!(title?.value.trim() || body?.value.trim() || pending),
        form,
      );
    const unavailable = () => {
      if (form) {
        submit.disabled = true;
        title.disabled = true;
        body.disabled = true;
      }
    };
    async function request(query = '', command = null, key = null) {
      const headers = { 'x-zhiban-request': 'identity-v1' };
      if (command) {
        const r = await fetch('/api/zhiban/identity/csrf', {
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!r.ok)
          throw Object.assign(Error('登录已失效，请返回工作台。'), {
            definitive: true,
            blocked: true,
          });
        headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
        headers['x-zhiban-command'] = key;
        headers['content-type'] = 'application/json';
      }
      const r = await fetch(base + query, {
        headers,
        method: command ? 'POST' : 'GET',
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
      const data = await r.json();
      if (!r.ok)
        throw Object.assign(
          Error(
            r.status === 409
              ? '已有待确认提醒或跟进版本已变化，请刷新回执并核对跟进。'
              : r.status === 401 || r.status === 403
                ? '当前账户、角色或课程名单已变化，不能访问或发送提醒。'
                : r.status === 404
                  ? '该提醒或跟进不可访问。'
                  : r.status === 400
                    ? '提醒参数无效。'
                    : '站内提醒暂不可用；若提交结果不确定，请保留原命令重试。',
          ),
          {
            definitive: r.status >= 400 && r.status < 500,
            blocked: [401, 403, 404].includes(r.status),
          },
        );
      return data;
    }
    async function load() {
      if (busy || disposed) return;
      busy = true;
      refresh.disabled = true;
      try {
        const q = new URLSearchParams();
        if (record) q.set('case', record.id);
        if (cursors[page]) q.set('cursor', cursors[page]);
        const data = await request(q.size ? '?' + q : '');
        if (disposed) return;
        list.replaceChildren();
        hasPending = data.rows.some((r) => r.confirmed_at === null);
        if (!data.rows.length) list.append(el('p', '暂无提醒。'));
        for (const r of data.rows) {
          const card = el('article', undefined, 'card');
          card.append(
            el('h3', r.title),
            el('p', r.body, 'followup-note-body'),
            el('p', `${r.activity_title} · 发布版本 ${r.activity_version}`),
            el(
              'p',
              `${r.sender_name} · 送达站内 ${new Date(Number(r.sent_at)).toLocaleString('zh-CN')}`,
            ),
            el(
              'p',
              r.confirmed_at === null
                ? '待学生确认'
                : `学生已确认 · ${new Date(Number(r.confirmed_at)).toLocaleString('zh-CN')}`,
            ),
          );
          if (!record && r.confirmed_at === null) {
            const ack = el('button', '我已知悉', 'button');
            ack.onclick = async () => {
              if (busy) return;
              busy = true;
              ack.disabled = true;
              refresh.disabled = true;
              // This key survives uncertain responses and repeated clicks for this delivery.
              ack.dataset.commandKey ||= crypto.randomUUID();
              try {
                await request('', { type: 'CONFIRM_REMINDER', id: r.id }, ack.dataset.commandKey);
                message.textContent = '已记录确认回执。';
                busy = false;
                await load();
              } catch (e) {
                message.textContent = e.message;
                if (!e.blocked) ack.disabled = false;
              } finally {
                busy = false;
                refresh.disabled = false;
              }
            };
            card.append(ack);
          }
          list.append(card);
        }
        const prev = el('button', '上一页提醒', 'button secondary'),
          next = el('button', '下一页提醒', 'button secondary');
        prev.disabled = page === 0;
        next.disabled = !data.next;
        prev.onclick = () => {
          page--;
          void load();
        };
        next.onclick = () => {
          cursors[++page] = data.next;
          void load();
        };
        list.append(el('p', `提醒第 ${page + 1} 页`), prev, next);
        if (form) submit.disabled = hasPending || record.state !== 'OPEN';
      } catch (e) {
        if (disposed) return;
        message.textContent = e.message;
        list.replaceChildren();
        if (e.blocked) unavailable();
      } finally {
        busy = false;
        if (!disposed) refresh.disabled = false;
      }
    }
    if (record) {
      form = el('form');
      title = el('input');
      title.maxLength = 120;
      title.required = true;
      title.setAttribute('aria-label', '学生可见提醒标题');
      body = el('textarea');
      body.maxLength = 2000;
      body.required = true;
      body.rows = 4;
      body.setAttribute('aria-label', '学生可见提醒正文');
      submit = el('button', '发送站内提醒', 'button');
      submit.type = 'submit';
      const tl = el('label', '学生可见提醒标题'),
        bl = el('label', '学生可见提醒正文');
      tl.append(title);
      bl.append(body);
      form.append(
        tl,
        bl,
        submit,
        el(
          'p',
          record.state === 'OPEN'
            ? '送达站内不等于已阅读；学生确认后可再次提醒。'
            : '跟进已结案；需重新打开后才能发送新提醒。',
          'muted',
        ),
      );
      root.insertBefore(form, toolbar);
      title.oninput = body.oninput = () => {
        if (!busy && !pending) dirty();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy || disposed) return;
        pending ||= {
          key: crypto.randomUUID(),
          command: {
            type: 'SEND_REMINDER',
            caseId: record.id,
            revision: record.revision,
            title: title.value,
            body: body.value,
          },
        };
        busy = true;
        title.disabled = body.disabled = submit.disabled = refresh.disabled = true;
        dirty();
        try {
          await request('', pending.command, pending.key);
          if (disposed) return;
          pending = null;
          submit.textContent = '发送站内提醒';
          title.value = body.value = '';
          dirty();
          message.textContent = '已送达学生站内，等待学生确认。';
          busy = false;
          page = 0;
          cursors = [null];
          await load();
        } catch (e) {
          if (disposed) return;
          message.textContent = e.message;
          if (e.definitive) pending = null;
          submit.textContent = pending ? '重试同一条提醒' : '发送站内提醒';
          if (e.blocked) unavailable();
          else submit.disabled = false;
        } finally {
          busy = false;
          if (!disposed) {
            refresh.disabled = false;
            title.disabled = body.disabled = !!pending;
            dirty();
          }
        }
      };
    }
    refresh.onclick = () => {
      page = 0;
      cursors = [null];
      void load();
    };
    void load();
    const dispose = () => {
      disposed = true;
      controller.abort();
      window.zhibanCoursePage?.setDirty('reminder', false);
    };
    window.addEventListener('pagehide', dispose, { once: true });
    const channel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
    if (channel)
      channel.onmessage = () => {
        dispose();
        root.replaceChildren(el('p', '登录状态已变化，请返回工作台。'));
      };
    return () => {
      dispose();
      channel?.close();
      window.removeEventListener('pagehide', dispose);
    };
  }
  window.zhibanReminders = { mount };
  if (document.body.dataset.courseSurface === 'reminder')
    void (async () => {
      if (window.zhibanCoursePage && !(await window.zhibanCoursePage.ready)) return;
      const p = new URLSearchParams(window.zhibanCoursePage?.query ?? location.search);
      mount(document.getElementById('reminders'), p.get('tenant'), p.get('offering'));
    })();
})();
