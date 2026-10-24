/* Outline references never replace Content or Learning authorization. */
(() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const identity = new RegExp('^' + uuid + '$');
  function flow(path = location.pathname, hash = location.hash, search = location.search) {
    const route = new RegExp(
      '^/zhiban/teacher/courses/(' + uuid + ')(?:/(resources|classrooms))?$',
    ).exec(path);
    const intent = new RegExp(
      '^#(compose|edit|attach)-(' + uuid + ')-(LECTURE|ACTIVITY|MATERIAL)(?:-(' + uuid + '))?$',
    ).exec(hash);
    const query = new URLSearchParams(search);
    if (
      !route ||
      !intent ||
      [...query.keys()].sort().join(',') !== 'offering,space' ||
      ![query.get('space'), query.get('offering')].every((x) => identity.test(x ?? ''))
    )
      return null;
    const [, action, chapter, kind, target] = intent;
    if (
      (action === 'compose') === !!target ||
      (action === 'attach'
        ? !!route[2]
        : route[2] !== (kind !== 'ACTIVITY' ? 'resources' : 'classrooms'))
    )
      return null;
    const base = `/zhiban/teacher/courses/${route[1]}?space=${query.get('space')}&offering=${query.get('offering')}`;
    return {
      action,
      chapter,
      kind,
      target,
      returnUrl(id) {
        if (!identity.test(id)) throw Error('内容地址无效');
        return base + `#attach-${chapter}-${kind}-${id}`;
      },
    };
  }
  window.zhibanCurriculum = {
    flow,
    async render(tenant, offering, root, role, href) {
      let closed = false,
        busy = false,
        pending = null,
        dirty = false,
        value = null,
        chapters = [],
        received = false,
        focusChapter = null;
      const controllers = new Set();
      const notice = el('p', undefined, 'notice'),
        toolbar = el('div', undefined, 'outline-toolbar'),
        tree = el('div', undefined, 'outline-tree');
      notice.setAttribute('role', 'status');
      root.className = 'curriculum';
      root.replaceChildren(el('h3', '章节与单元'), notice, toolbar, tree);
      const live = () => !closed && root.isConnected;
      const guard = () => !dirty || confirm('课程目录有未保存修改，确认放弃并离开？');
      const clickGuard = (e) => {
        const link = e.target.closest?.('a[href]');
        if (link?.dataset.authorLaunch && (dirty || busy || pending)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          notice.textContent = '请先保存目录草稿，再进入内容编辑；原章节与排序会保留。';
          return;
        }
        if (!link || !dirty) return;
        if (!guard()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else dirty = false;
      };
      const unload = (e) => {
        if (dirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      document.addEventListener('click', clickGuard, true);
      window.addEventListener('beforeunload', unload);
      function button(label, fn, disabled = false) {
        const b = el('button', label, 'button secondary');
        b.type = 'button';
        b.disabled = disabled || busy || !!pending;
        b.onclick = () => void fn();
        return b;
      }
      const changed = () => {
        dirty = true;
        notice.textContent = '目录有未保存修改；学生仍看到上次发布的目录。';
      };
      async function request(command = null, key = null) {
        const c = new AbortController();
        controllers.add(c);
        const timer = setTimeout(() => c.abort(), 10000);
        const headers = { 'x-zhiban-request': 'identity-v1' };
        try {
          if (command) {
            const r = await fetch('/api/zhiban/identity/csrf', {
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
            });
            if (!r.ok) throw Error('登录已失效。');
            headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
            headers['x-zhiban-command'] = key;
            headers['Content-Type'] = 'application/json';
          }
          const r = await fetch(`/api/zhiban/learning/${tenant}/offerings/${offering.id}/outline`, {
            method: command ? 'POST' : 'GET',
            headers,
            credentials: 'same-origin',
            cache: 'no-store',
            signal: c.signal,
            ...(command ? { body: JSON.stringify(command) } : {}),
          });
          const data = await r.json();
          if (!r.ok)
            throw Object.assign(
              Error(
                {
                  CONFLICT: '目录已被其他教师修改；本地修改保留，请刷新后重新编排。',
                  INVALID_INPUT: '规则或目录格式无效：请检查先修循环、重复活动与最多 8 项先修。',
                  INVALID_STATE:
                    '引用的内容未发布、已撤回、不属于当前教学班，或规则绑定版本已过期；练习测验不支持完成规则。',
                  FORBIDDEN: '当前任教或选课资格已失效。',
                }[data.error?.code] || '课程目录暂时不可用。',
              ),
              { definitive: r.status >= 400 && r.status < 500 },
            );
          return data;
        } finally {
          clearTimeout(timer);
          controllers.delete(c);
        }
      }
      async function load() {
        const data = await request();
        if (!live()) return;
        value = data;
        chapters = structuredClone(data.chapters);
        dirty = false;
        const incoming = flow();
        if (!received && incoming?.action === 'attach' && value.mode === 'TEACHER') {
          received = true;
          const chapter = chapters.find((c) => c.id === incoming.chapter);
          const target = (
            incoming.kind === 'LECTURE'
              ? value.resources
              : incoming.kind === 'MATERIAL'
                ? (value.materials ?? [])
                : value.activities
          ).find((r) => r.id === incoming.target);
          if (!chapter) notice.textContent = '原章节已移除。内容已保留，请选择其他章节加入。';
          else if (!target) notice.textContent = '该内容当前不可访问，请刷新后重新选择。';
          else {
            focusChapter = chapter.id;
            if (!chapter.units.some((u) => u.kind === incoming.kind && u.target === target.id)) {
              if (chapters.reduce((n, c) => n + c.units.length, 0) >= 200)
                notice.textContent = '目录已达 200 单元上限，内容已保留。';
              else {
                chapter.units.push({
                  id: crypto.randomUUID(),
                  title: target.title,
                  kind: incoming.kind,
                  target: target.id,
                });
                changed();
                notice.textContent =
                  '已加入原章节的目录草稿，请保存目录；对学生发布仍需内容及目录各自发布。';
              }
            } else notice.textContent = '已返回原章节；现有单元保留，没有重复添加。';
          }
          history.replaceState(
            null,
            '',
            location.pathname + location.search + '#chapter-' + incoming.chapter,
          );
        }
        draw();
        if (focusChapter)
          root
            .querySelector('[data-chapter="' + focusChapter + '"]')
            ?.scrollIntoView({ block: 'center' });
      }
      async function send() {
        if (busy || !pending) return;
        busy = true;
        notice.textContent = '正在提交目录操作…';
        draw();
        let completed = false;
        try {
          await request(pending.command, pending.key);
          completed = true;
          pending = null;
          dirty = false;
          await load();
          notice.textContent =
            '目录已' +
            (value.publicationNo
              ? '保存，当前发布版本 ' + value.publicationNo
              : '保存；尚未发布给学生') +
            '。';
        } catch (e) {
          if (!live()) return;
          if (e.definitive || completed) pending = null;
          notice.textContent = e.message + (pending ? ' 结果待确认，请使用“重试同一操作”。' : '');
        } finally {
          busy = false;
          if (live()) draw();
        }
      }
      const action = async (type) => {
        if (busy || pending) return;
        pending = {
          command: {
            type,
            revision: value.revision,
            ...(type === 'SAVE_OUTLINE' ? { chapters: structuredClone(chapters) } : {}),
          },
          key: crypto.randomUUID(),
        };
        await send();
      };
      function move(items, index, delta) {
        [items[index], items[index + delta]] = [items[index + delta], items[index]];
        changed();
        draw();
      }
      function titleInput(item, label) {
        const input = el('input');
        input.value = item.title;
        input.maxLength = 120;
        input.required = true;
        input.setAttribute('aria-label', label);
        input.disabled = busy || !!pending;
        input.oninput = () => {
          item.title = input.value;
          changed();
        };
        return input;
      }
      function progressEditor(unit, row) {
        const panel = el('details');
        panel.open = !!unit.progress;
        panel.append(
          el('summary', '完成与先修规则' + (unit.progress ? '（已配置草稿）' : '（关闭）')),
        );
        const label = (text, input) => {
          input.setAttribute('aria-label', text);
          const l = el('label', text + ' ');
          l.append(input);
          panel.append(l);
        };
        const enabled = el('input');
        enabled.type = 'checkbox';
        enabled.checked = !!unit.progress;
        enabled.disabled = busy || !!pending;
        enabled.onchange = () => {
          if (enabled.checked) {
            const a = value.activities.find((a) => a.id === unit.target);
            if (!a?.publishedVersion || a.status !== 'PUBLISHED') {
              enabled.checked = false;
              notice.textContent = '请先发布该活动，再设置完成规则。';
              return;
            }
            unit.progress = {
              kind: 'SUBMITTED',
              version: Number(a.publishedVersion),
              required: true,
              thresholdBps: 0,
              requires: [],
            };
          } else delete unit.progress;
          changed();
          draw();
        };
        label('启用完成规则 · ' + unit.title, enabled);
        if (unit.progress) {
          const rule = unit.progress,
            kind = el('select');
          for (const [v, t] of [
            ['SUBMITTED', '正式提交成功'],
            ['PUBLISHED_GRADE', '已发布成绩达到阈值'],
          ]) {
            const opt = el('option', t);
            opt.value = v;
            kind.append(opt);
          }
          kind.value = rule.kind;
          kind.disabled = busy || !!pending;
          kind.onchange = () => {
            rule.kind = kind.value;
            rule.thresholdBps = kind.value === 'SUBMITTED' ? 0 : 6000;
            changed();
            draw();
          };
          label('完成依据 · ' + unit.title, kind);
          const required = el('input');
          required.type = 'checkbox';
          required.checked = rule.required;
          required.disabled = busy || !!pending;
          required.onchange = () => {
            rule.required = required.checked;
            changed();
          };
          label('计入必修完成数 · ' + unit.title, required);
          if (rule.kind === 'PUBLISHED_GRADE') {
            const score = el('input');
            score.type = 'number';
            score.min = '0';
            score.max = '100';
            score.step = '0.01';
            score.value = String(rule.thresholdBps / 100);
            score.disabled = busy || !!pending;
            score.oninput = () => {
              rule.thresholdBps = Math.round(Number(score.value) * 100);
              changed();
            };
            label('成绩百分比阈值 · ' + unit.title, score);
          }
          panel.append(el('p', '绑定活动版本 ' + rule.version + '；换版后须重新绑定并发布目录。'));
          panel.append(
            button('绑定当前版本 · ' + unit.title, () => {
              const a = value.activities.find((a) => a.id === unit.target);
              if (!a?.publishedVersion || a.status !== 'PUBLISHED') {
                notice.textContent = '请先发布活动。';
                return;
              }
              rule.version = Number(a.publishedVersion);
              changed();
              draw();
            }),
          );
          const deps = el('select');
          deps.multiple = true;
          deps.disabled = busy || !!pending;
          for (const other of chapters
            .flatMap((c) => c.units)
            .filter((u) => u.kind === 'ACTIVITY' && u.target !== unit.target && u.progress)) {
            const opt = el('option', other.title);
            opt.value = other.target;
            opt.selected = rule.requires.includes(other.target);
            deps.append(opt);
          }
          deps.onchange = () => {
            rule.requires = Array.from(deps.selectedOptions, (o) => o.value);
            changed();
          };
          label('先修活动（最多 8 项） · ' + unit.title, deps);
          panel.append(
            button('清空先修 · ' + unit.title, () => {
              rule.requires = [];
              changed();
              draw();
            }),
          );
          if (
            rule.requires.some(
              (id) => !chapters.flatMap((c) => c.units).some((u) => u.target === id && u.progress),
            )
          )
            panel.append(el('p', '部分先修已移除或关闭，请清除并重新选择后保存。', 'notice'));
          panel.append(
            el(
              'p',
              '先给前置活动启用规则，再选择先修。只限制新作答及新课堂进入；已有作答和历史保留。',
              'muted',
            ),
          );
        }
        row.append(panel);
      }
      function draw() {
        if (!value) return;
        const teacher = value.mode === 'TEACHER';
        toolbar.replaceChildren();
        tree.replaceChildren();
        toolbar.append(el('p', `已发布目录版本 ${value.publicationNo}`));
        if (!teacher && value.progress?.configured) {
          const p = value.progress;
          toolbar.append(
            el(
              'p',
              p.required
                ? `必修活动完成 ${p.satisfied} / ${p.required}（目录版本 ${p.publicationNo}）`
                : '已配置规则，尚无必修活动；不计算完成百分比。',
            ),
          );
          toolbar.append(
            button('刷新学习进度', async () => {
              try {
                await load();
              } catch (e) {
                notice.textContent = e.message;
              }
            }),
          );
        }
        if (pending) {
          const retry = button('重试同一操作', send);
          retry.disabled = busy;
          toolbar.append(retry);
        }
        if (teacher) {
          toolbar.append(
            button(
              '新增章节',
              () => {
                chapters.push({ id: crypto.randomUUID(), title: '新章节', units: [] });
                changed();
                draw();
              },
              chapters.length >= 50,
            ),
            button('保存目录草稿', () => action('SAVE_OUTLINE')),
            button('发布已保存目录', () => {
              if (dirty) {
                notice.textContent = '请先保存目录草稿，再发布。';
                return;
              }
              return action('PUBLISH_OUTLINE');
            }),
            button('刷新目录', async () => {
              if (!guard()) return;
              try {
                await load();
                notice.textContent = '已读取最新目录。';
              } catch (e) {
                notice.textContent = e.message;
              }
            }),
          );
          toolbar.append(
            el(
              'p',
              '目录及完成规则独立保存并显式发布；默认自由学习。规则只统计正式提交或已发布成绩，阅读和互动不计完成。',
              'muted',
            ),
          );
        }
        if (!chapters.length)
          tree.append(
            el(
              'p',
              teacher
                ? '尚未编排章节，点击“新增章节”开始。'
                : '教师尚未发布课程目录，可从课程导航查看已有讲义与学习活动。',
              'muted',
            ),
          );
        chapters.forEach((chapter, ci) => {
          const card = el('section', undefined, 'outline-chapter');
          card.dataset.chapter = chapter.id;
          card.append(el('h4', `${ci + 1}. ${chapter.title}`));
          if (teacher) {
            card.append(
              titleInput(chapter, `章节 ${ci + 1} 名称`),
              button('章节上移', () => move(chapters, ci, -1), ci === 0),
              button('章节下移', () => move(chapters, ci, 1), ci === chapters.length - 1),
              button('移除章节', () => {
                if (confirm('移除该章节及目录中的单元？原讲义、活动和历史记录会保留。')) {
                  chapters.splice(ci, 1);
                  changed();
                  draw();
                }
              }),
            );
          }
          const units = el('ol');
          card.append(units);
          chapter.units.forEach((unit, ui) => {
            const row = el('li', undefined, 'outline-unit');
            const a = el(
              'a',
              `${unit.kind === 'LECTURE' ? '讲义' : unit.kind === 'MATERIAL' ? '资源' : '活动'} · ${unit.title}`,
            );
            a.href =
              href(
                unit.kind !== 'ACTIVITY'
                  ? 'resources'
                  : role === 'teacher'
                    ? 'classrooms'
                    : 'coursework',
              ) +
              `#${unit.kind === 'LECTURE' ? 'resource' : unit.kind === 'MATERIAL' ? 'material' : 'activity'}-${unit.target}`;
            row.append(a);
            const progress = value.progress?.rows.find((p) => p.activityId === unit.target);
            if (!teacher && progress) {
              const names = progress.blockedBy.map(
                (id) =>
                  chapters.flatMap((c) => c.units).find((u) => u.target === id)?.title ??
                  '先修活动',
              );
              row.append(
                el(
                  'p',
                  progress.stale
                    ? '规则版本已过期，请联系教师更新；已有作答可继续。'
                    : (progress.complete ? '已满足完成依据' : '尚未满足完成依据') +
                        (names.length
                          ? '；新进入需先完成：' + names.join('、')
                          : '；新进入无先修阻拦'),
                ),
              );
            }
            if (teacher) {
              const edit = el(
                'a',
                unit.kind === 'LECTURE'
                  ? '编辑讲义并返回本章'
                  : unit.kind === 'MATERIAL'
                    ? '管理资源并返回本章'
                    : '编辑活动并返回本章',
                'button secondary',
              );
              edit.href =
                href(unit.kind !== 'ACTIVITY' ? 'resources' : 'classrooms') +
                (unit.kind === 'MATERIAL'
                  ? `#material-${unit.target}`
                  : `#edit-${chapter.id}-${unit.kind}-${unit.target}`);
              edit.dataset.authorLaunch = 'true';
              row.append(edit);
              if (unit.kind === 'ACTIVITY') progressEditor(unit, row);
              row.append(
                titleInput(unit, `单元 ${ci + 1}.${ui + 1} 名称`),
                button('单元上移', () => move(chapter.units, ui, -1), ui === 0),
                button(
                  '单元下移',
                  () => move(chapter.units, ui, 1),
                  ui === chapter.units.length - 1,
                ),
              );
              const destination = el('select');
              destination.setAttribute('aria-label', `单元 ${ci + 1}.${ui + 1} 移动到章节`);
              destination.disabled = busy || !!pending;
              chapters.forEach((c, i) => {
                const opt = el('option', `${i + 1}. ${c.title}`);
                opt.value = c.id;
                destination.append(opt);
              });
              destination.value = chapter.id;
              destination.onchange = () => {
                const target = chapters.find((c) => c.id === destination.value);
                chapter.units.splice(ui, 1);
                target.units.push(unit);
                changed();
                draw();
              };
              row.append(
                destination,
                button('移除单元', () => {
                  chapter.units.splice(ui, 1);
                  changed();
                  draw();
                }),
              );
            }
            units.append(row);
          });
          if (teacher) {
            const launch = el('div', undefined, 'outline-toolbar');
            for (const [kind, label, surface] of [
              ['LECTURE', '本章新建讲义', 'resources'],
              ['MATERIAL', '本章上传资源', 'resources'],
              ['ACTIVITY', '本章新建活动', 'classrooms'],
            ]) {
              const a = el('a', label, 'button secondary');
              a.href = href(surface) + `#compose-${chapter.id}-${kind}`;
              a.dataset.authorLaunch = 'true';
              launch.append(a);
            }
            card.append(launch);
            const f = el('form', undefined, 'outline-add');
            const select = el('select');
            select.setAttribute('aria-label', `章节 ${ci + 1} 添加内容`);
            const choices = [
              ...value.resources.map((r) => ({
                kind: 'LECTURE',
                id: r.id,
                title: r.title,
                status: r.state,
              })),
              ...(value.materials ?? [])
                .filter((m) => m.status !== 'ARCHIVED')
                .map((m) => ({ kind: 'MATERIAL', ...m })),
              ...value.activities.map((a) => ({ kind: 'ACTIVITY', ...a })),
            ];
            const empty = el('option', '请选择已有讲义、资源或活动');
            empty.value = '';
            select.append(empty);
            choices.forEach((x, i) => {
              const opt = el(
                'option',
                `${x.kind === 'LECTURE' ? '讲义' : x.kind === 'MATERIAL' ? '资源' : '活动'} · ${x.title} · ${x.status}`,
              );
              opt.value = String(i);
              select.append(opt);
            });
            select.disabled = busy || !!pending;
            const add = button('添加单元', () => {
              if (select.value === '') return;
              const x = choices[Number(select.value)];
              if (chapters.reduce((n, c) => n + c.units.length, 0) >= 200) {
                notice.textContent = '每个目录最多 200 个单元。';
                return;
              }
              chapter.units.push({
                id: crypto.randomUUID(),
                title: x.title,
                kind: x.kind,
                target: x.id,
              });
              changed();
              draw();
            });
            f.onsubmit = (e) => e.preventDefault();
            f.append(select, add);
            card.append(f);
          }
          tree.append(card);
        });
      }
      try {
        await load();
      } catch (e) {
        if (live()) notice.textContent = e.message;
      }
      return () => {
        closed = true;
        controllers.forEach((c) => c.abort());
        document.removeEventListener('click', clickGuard, true);
        window.removeEventListener('beforeunload', unload);
      };
    },
  };
})();
