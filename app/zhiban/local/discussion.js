/* Offering-scoped discussion; all identity, relationships and transitions are server-authorized. */
(() => {
  const states = { DRAFT: '草稿', OPEN: '开放', CLOSED: '已关闭', ARCHIVED: '已归档' };
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  window.zhibanDiscussion = {
    async render(tenant, offering, root) {
      const base = `/api/zhiban/learning/${tenant}/offerings/${offering.id}/discussions`;
      let dead = false,
        busy = false,
        pending = null,
        list,
        posts,
        events,
        selected = null;
      let state = 'ALL',
        limit = '20',
        topicCursors = [null],
        topicPage = 0;
      let postCursors = [null],
        postPage = 0,
        eventCursors = [null],
        eventPage = 0,
        showEvents = false;
      let title = '',
        description = '',
        body = '',
        parentId = null,
        parentName = '';
      let editTitle = '',
        editDescription = '',
        editBaseline = '',
        reasons = {};
      const controllers = new Set();
      const dirty = () =>
        !!(
          title ||
          description ||
          body ||
          parentId ||
          Object.values(reasons).some(Boolean) ||
          (selected && editBaseline !== JSON.stringify([editTitle, editDescription]))
        );
      const notice = el('p');
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      const leave = () => {
        if (pending || busy) {
          notice.textContent = '操作结果待确认，请先按原命令重试。';
          return false;
        }
        return !dirty() || confirm('有未发送的讨论内容，确认放弃并离开？');
      };
      const clear = () => {
        title = '';
        description = '';
        body = '';
        parentId = null;
        parentName = '';
        reasons = {};
        editBaseline = JSON.stringify([editTitle, editDescription]);
      };
      async function request(path = '', command, key) {
        const c = new AbortController();
        controllers.add(c);
        const timer = setTimeout(() => c.abort(), 15000);
        try {
          const headers = { 'x-zhiban-request': 'identity-v1' };
          if (command) {
            const csrf = await fetch('/api/zhiban/identity/csrf', {
              credentials: 'same-origin',
              headers,
              signal: c.signal,
            });
            if (!csrf.ok)
              throw Object.assign(Error('登录或安全令牌不可用，请重新登录。'), {
                definitive: csrf.status >= 400 && csrf.status < 500,
              });
            headers['Content-Type'] = 'application/json';
            headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
            headers['x-zhiban-command'] = key;
          }
          const r = await fetch(base + path, {
            method: command ? 'POST' : 'GET',
            headers,
            body: command ? JSON.stringify(command) : undefined,
            credentials: 'same-origin',
            cache: 'no-store',
            signal: c.signal,
          });
          const data = await r.json();
          if (!r.ok)
            throw Object.assign(
              Error(
                {
                  FORBIDDEN: '课程资格或权限已变化，请返回课程列表。',
                  NOT_FOUND: '主题或回复对象不可访问，请读取最新状态。',
                  CONFLICT: '内容状态已变化，请读取最新状态后重试。',
                  INVALID_STATE: '讨论当前不可执行此操作，请读取最新状态。',
                  INVALID_INPUT: '请检查标题、内容和管理原因。',
                  UNAUTHENTICATED: '登录已失效。',
                  SERVICE_UNAVAILABLE: '课程讨论尚未就绪或服务暂不可用。',
                }[data.error?.code] ?? '操作暂未完成。',
              ),
              { definitive: r.status >= 400 && r.status < 500, status: r.status },
            );
          return data;
        } finally {
          clearTimeout(timer);
          controllers.delete(c);
        }
      }
      const params = (cursor) =>
        '?' + new URLSearchParams({ limit, ...(cursor ? { cursor } : {}) });
      async function refresh() {
        list = await request(params(topicCursors[topicPage]) + '&state=' + state);
        if (selected) {
          posts = await request(`/${selected}/posts` + params(postCursors[postPage]));
          if (!editBaseline) {
            editTitle = posts.topic.title;
            editDescription = posts.topic.description;
            editBaseline = JSON.stringify([editTitle, editDescription]);
          }
          events = showEvents
            ? await request(`/${selected}/events` + params(eventCursors[eventPage]))
            : null;
        }
      }
      async function readLatest() {
        if (busy || pending || dead) return;
        busy = true;
        lock();
        notice.textContent = '正在读取最新讨论，未发送内容会保留…';
        try {
          await refresh();
          if (!dead) {
            draw();
            notice.textContent = '已读取最新状态；未发送内容仍保留，请核对后再操作。';
          }
        } catch (e) {
          if (!dead) {
            if ([401, 403, 404].includes(e.status)) {
              list = null;
              posts = null;
              events = null;
              draw();
            }
            notice.textContent = e.message;
          }
        } finally {
          busy = false;
          lock();
        }
      }
      async function act(command, retry = false) {
        if (dead || busy || (pending && !retry)) return;
        if (
          !retry &&
          ['OPEN_TOPIC', 'CLOSE_TOPIC', 'ARCHIVE_TOPIC'].includes(command.type) &&
          dirty()
        ) {
          if (!confirm('有未发送的内容，确认放弃后改变讨论状态？')) return;
          clear();
        }
        pending ??= { command, key: crypto.randomUUID() };
        const work = pending;
        busy = true;
        lock();
        notice.textContent = '正在确认操作…';
        try {
          const result = await request('', work.command, work.key);
          pending = null;
          if (work.command.type === 'CREATE_TOPIC') {
            selected = result.id;
            posts = null;
            events = null;
            title = '';
            description = '';
            editBaseline = '';
          }
          if (work.command.type === 'EDIT_TOPIC')
            editBaseline = JSON.stringify([editTitle, editDescription]);
          if (work.command.type === 'POST_MESSAGE') {
            body = '';
            parentId = null;
            parentName = '';
          }
          if (['HIDE_POST', 'RESTORE_POST'].includes(work.command.type))
            delete reasons[work.command.id];
          topicCursors = [null];
          topicPage = 0;
          // Keep the current post page after appending or moderating, so an older reply target stays visible.
          eventCursors = [null];
          eventPage = 0;
          await refresh();
          if (!dead) {
            draw();
            notice.textContent = '操作已确认。';
          }
        } catch (e) {
          if (dead) return;
          if (e.definitive) pending = null;
          draw();
          notice.textContent =
            e.message +
            (pending ? ' 结果未知；内容已保留，请按原命令重试。' : ' 输入已保留，可读取最新状态。');
        } finally {
          busy = false;
          lock();
        }
      }
      function lock() {
        root.querySelectorAll('input,textarea,select,button').forEach((n) => {
          n.disabled = busy || !!pending || n.dataset.blocked === 'true';
          if (n.dataset.retry) n.disabled = busy || !pending;
        });
      }
      const button = (text, fn, blocked = false) => {
        const n = el('button', text, 'button secondary');
        n.type = 'button';
        n.dataset.blocked = String(blocked);
        n.onclick = () => void fn();
        return n;
      };
      function field(form, text, value, change, max, multiline = false) {
        const label = el('label', text),
          input = el(multiline ? 'textarea' : 'input');
        input.setAttribute('aria-label', text);
        input.value = value;
        input.maxLength = max;
        if (multiline) input.rows = 4;
        input.oninput = () => change(input.value);
        label.append(input);
        form.append(label);
        return input;
      }
      function pager(parent, name, page, cursors, next, change) {
        const nav = el('nav', undefined, 'course-pagination');
        nav.setAttribute('aria-label', name + '分页');
        nav.append(
          button('上一页' + name, () => change(page - 1), page === 0),
          el('span', `第 ${page + 1} 页`),
          button(
            '下一页' + name,
            () => {
              cursors[page + 1] = next;
              return change(page + 1);
            },
            !next,
          ),
        );
        parent.append(nav);
      }
      async function select(id) {
        if (!leave()) return;
        clear();
        selected = id;
        posts = null;
        events = null;
        editBaseline = '';
        postCursors = [null];
        postPage = 0;
        showEvents = false;
        await readLatest();
      }
      function draw() {
        if (dead) return;
        root.replaceChildren(
          el('h2', '课程讨论'),
          el('p', '本教学班师生共享的纯文本讨论；发言不计学习完成或成绩。'),
          notice,
        );
        if (pending) {
          const retry = button('按原命令重试', () => act(pending.command, true));
          retry.dataset.retry = 'true';
          root.append(retry);
        } else root.append(button('读取最新讨论状态', readLatest));
        if (!list) {
          lock();
          return;
        }
        const teacher = list.mode === 'TEACHER',
          writable = list.writable;
        if (!writable) root.append(el('p', '教学班已关闭，讨论历史只读。'));
        if (teacher && writable) {
          const form = el('form', undefined, 'academic-form');
          form.append(el('h3', '新建讨论主题'));
          field(
            form,
            '主题标题',
            title,
            (v) => {
              title = v;
            },
            120,
          ).required = true;
          field(
            form,
            '主题说明',
            description,
            (v) => {
              description = v;
            },
            2000,
            true,
          );
          const save = el('button', '保存主题草稿', 'button primary');
          save.type = 'submit';
          form.append(save);
          form.onsubmit = (e) => {
            e.preventDefault();
            if (form.reportValidity()) void act({ type: 'CREATE_TOPIC', title, description });
          };
          root.append(form);
        }
        const filters = el('div', undefined, 'course-filters');
        if (teacher) {
          const f = field(filters, '主题状态', state, () => {}, 20);
          const s = el('select');
          s.setAttribute('aria-label', '主题状态');
          for (const [value, label] of [['ALL', '全部'], ...Object.entries(states)]) {
            const o = el('option', label);
            o.value = value;
            s.append(o);
          }
          s.value = state;
          f.replaceWith(s);
          s.onchange = async () => {
            if (!leave()) {
              s.value = state;
              return;
            }
            clear();
            state = s.value;
            topicCursors = [null];
            topicPage = 0;
            await readLatest();
          };
        }
        const size = el('select');
        size.setAttribute('aria-label', '讨论每页条数');
        for (const v of ['10', '20', '50']) {
          const o = el('option', v);
          o.value = v;
          size.append(o);
        }
        size.value = limit;
        size.onchange = async () => {
          if (!leave()) {
            size.value = limit;
            return;
          }
          clear();
          limit = size.value;
          topicCursors = [null];
          postCursors = [null];
          eventCursors = [null];
          topicPage = postPage = eventPage = 0;
          await readLatest();
        };
        filters.append(el('label', '每页条数'), size);
        root.append(filters);
        const topics = el('section');
        topics.setAttribute('aria-label', '讨论主题列表');
        root.append(topics);
        for (const topic of list.rows) {
          const card = el('article', undefined, 'learning-activity');
          card.append(
            el('h3', topic.title),
            el('p', `${states[topic.state]} · ${topic.author_name}`),
            button('打开主题 ' + topic.title, () => select(topic.id)),
          );
          topics.append(card);
        }
        if (!list.rows.length) topics.append(el('p', '暂无可见讨论主题。'));
        pager(topics, '主题', topicPage, topicCursors, list.nextCursor, async (n) => {
          if (!leave()) return;
          clear();
          topicPage = n;
          await readLatest();
        });
        if (selected && posts) {
          const topic = posts.topic,
            panel = el('section');
          panel.setAttribute('aria-label', '当前讨论主题');
          root.append(panel);
          panel.append(
            el('h3', topic.title),
            el('p', `${states[topic.state]} · 版本 ${topic.revision}`),
            el('p', topic.description, 'discussion-text'),
          );
          if (teacher && writable) {
            if (topic.state === 'DRAFT') {
              const form = el('form', undefined, 'academic-form');
              field(
                form,
                '编辑主题标题',
                editTitle,
                (v) => {
                  editTitle = v;
                },
                120,
              ).required = true;
              field(
                form,
                '编辑主题说明',
                editDescription,
                (v) => {
                  editDescription = v;
                },
                2000,
                true,
              );
              const save = el('button', '保存主题修改', 'button primary');
              save.type = 'submit';
              form.append(save);
              form.onsubmit = (e) => {
                e.preventDefault();
                if (form.reportValidity())
                  void act({
                    type: 'EDIT_TOPIC',
                    id: topic.id,
                    revision: topic.revision,
                    title: editTitle,
                    description: editDescription,
                  });
              };
              panel.append(form);
            }
            if (['DRAFT', 'CLOSED'].includes(topic.state))
              panel.append(
                button(topic.state === 'DRAFT' ? '开放讨论' : '重新开放讨论', () =>
                  act({ type: 'OPEN_TOPIC', id: topic.id, revision: topic.revision }),
                ),
              );
            if (topic.state === 'OPEN')
              panel.append(
                button('关闭讨论', () =>
                  act({ type: 'CLOSE_TOPIC', id: topic.id, revision: topic.revision }),
                ),
              );
            if (topic.state !== 'ARCHIVED')
              panel.append(
                button(
                  '归档主题',
                  () =>
                    confirm('归档后学生不可见，且不能重新开放。确认归档？') &&
                    act({ type: 'ARCHIVE_TOPIC', id: topic.id, revision: topic.revision }),
                ),
              );
          }
          const messages = el('section');
          messages.setAttribute('aria-label', '主题发言');
          panel.append(messages);
          for (const post of posts.rows) {
            const card = el('article', undefined, 'learning-activity');
            card.dataset.postId = post.id;
            card.append(
              el('h4', post.author_name ?? '已隐藏发言'),
              el('p', new Date(Number(post.created_at)).toLocaleString('zh-CN')),
            );
            if (post.parent_id)
              card.append(el('p', '回复：' + (post.parent_author ?? '原发言已隐藏')));
            card.append(el('p', post.body ?? '此发言已由教师隐藏。', 'discussion-text'));
            if (post.state === 'HIDDEN' && teacher)
              card.append(el('p', '已隐藏，仅教师可见原文。'));
            if (writable && topic.state === 'OPEN' && post.state === 'VISIBLE')
              card.append(
                button('回复 ' + post.author_name, () => {
                  parentId = post.id;
                  parentName = post.author_name;
                  draw();
                }),
              );
            if (teacher && writable && ['OPEN', 'CLOSED'].includes(topic.state)) {
              field(
                card,
                '管理原因',
                reasons[post.id] ?? '',
                (v) => {
                  reasons[post.id] = v;
                },
                1000,
              );
              card.append(
                button(post.state === 'VISIBLE' ? '隐藏发言' : '恢复发言', () => {
                  if (!reasons[post.id]?.trim()) {
                    notice.textContent = '请填写管理原因。';
                    return;
                  }
                  return act({
                    type: post.state === 'VISIBLE' ? 'HIDE_POST' : 'RESTORE_POST',
                    topicId: topic.id,
                    id: post.id,
                    revision: post.revision,
                    reason: reasons[post.id],
                  });
                }),
              );
            }
            messages.append(card);
          }
          if (!posts.rows.length) messages.append(el('p', '暂无发言。'));
          pager(messages, '发言', postPage, postCursors, posts.nextCursor, async (n) => {
            if (!leave()) return;
            clear();
            postPage = n;
            await readLatest();
          });
          if (writable && topic.state === 'OPEN') {
            const form = el('form', undefined, 'academic-form');
            form.append(el('h4', parentId ? '回复 ' + parentName : '参与讨论'));
            if (parentId)
              form.append(
                button('取消回复对象', () => {
                  parentId = null;
                  parentName = '';
                  draw();
                }),
              );
            field(
              form,
              '讨论内容',
              body,
              (v) => {
                body = v;
              },
              4000,
              true,
            ).required = true;
            const send = el('button', '发送发言', 'button primary');
            send.type = 'submit';
            form.append(send);
            form.onsubmit = (e) => {
              e.preventDefault();
              if (form.reportValidity())
                void act({ type: 'POST_MESSAGE', topicId: topic.id, parentId, body });
            };
            panel.append(form);
          } else panel.append(el('p', '当前主题只读，不能发送或回复。'));
          if (teacher) {
            panel.append(
              button(showEvents ? '收起管理记录' : '查看管理记录', async () => {
                showEvents = !showEvents;
                await readLatest();
              }),
            );
            if (showEvents && events) {
              const audit = el('section');
              audit.setAttribute('aria-label', '讨论管理记录');
              panel.append(audit);
              for (const event of events.rows)
                audit.append(
                  el(
                    'p',
                    `${event.action === 'HIDE_POST' ? '隐藏' : '恢复'} · ${event.actor_name} · ${event.reason} · ${new Date(Number(event.created_at)).toLocaleString('zh-CN')}`,
                  ),
                );
              if (!events.rows.length) audit.append(el('p', '暂无管理记录。'));
              pager(audit, '管理记录', eventPage, eventCursors, events.nextCursor, async (n) => {
                eventPage = n;
                await readLatest();
              });
            }
          }
        }
        lock();
      }
      const click = (event) => {
        const control = event.target.closest?.('a[href],button');
        if (!control || root.contains(control) || (!dirty() && !pending)) return;
        if (!leave()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        } else clear();
      };
      const unload = (event) => {
        if (dirty() || pending) {
          event.preventDefault();
          event.returnValue = '';
        }
      };
      function destroy() {
        if (dead) return;
        dead = true;
        controllers.forEach((c) => c.abort());
        channel?.close();
        document.removeEventListener('click', click, true);
        window.removeEventListener('beforeunload', unload);
        window.removeEventListener('pagehide', destroy);
        root.replaceChildren();
      }
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      if (channel) channel.onmessage = destroy;
      document.addEventListener('click', click, true);
      window.addEventListener('beforeunload', unload);
      window.addEventListener('pagehide', destroy, { once: true });
      draw();
      await readLatest();
      return destroy;
    },
  };
})();
