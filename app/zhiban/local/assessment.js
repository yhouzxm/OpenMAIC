/* Published score snapshots are server-authorized and tied to an exact submission. */
(() => {
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  window.zhibanSubmissionFiles = async (tenant, offering, submission, root) => {
    const base = `/api/zhiban/learning/${tenant}/offerings/${offering}/attachments?submission=${submission}`;
    const headers = { 'x-zhiban-request': 'identity-v1' };
    try {
      const r = await fetch(base, { headers, credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('附件暂不可访问，请刷新并确认权限。');
      const data = await r.json();
      if (!root.isConnected) return;
      root.replaceChildren();
      if (!data.files.length) {
        root.append(el('p', '本提交无附件。'));
        return;
      }
      for (const f of data.files) {
        const button = el('button', `下载附件 ${f.name}（${f.size} 字节）`);
        button.type = 'button';
        const status = el('p');
        status.setAttribute('role', 'status');
        button.onclick = async () => {
          button.disabled = true;
          const c = new AbortController(),
            timer = setTimeout(() => c.abort(), 10000);
          try {
            const response = await fetch(base + '&file=' + f.id, {
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
            });
            if (!response.ok) throw new Error('附件下载失败，当前权限或文件状态已变化。');
            const blob = await response.blob();
            if (!root.isConnected) return;
            const url = URL.createObjectURL(blob),
              a = el('a');
            a.href = url;
            a.download = f.name;
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.textContent = '附件文件已生成。';
          } catch (e) {
            if (root.isConnected) status.textContent = e.message;
          } finally {
            clearTimeout(timer);
            button.disabled = false;
          }
        };
        root.append(
          el(
            'p',
            f.clearance_status === 'LOCAL_SYNTHETIC_PINNED'
              ? '本地已登记样例；不代表真实恶意软件扫描通过。'
              : f.clearance_status === 'TRUSTED_SCANNER'
                ? '已通过 ClamAV 扫描；下载后仍请谨慎处理文件。'
                : '附件未获可信扫描放行。',
          ),
          button,
          status,
        );
        button.disabled = !['LOCAL_SYNTHETIC_PINNED', 'TRUSTED_SCANNER'].includes(
          f.clearance_status,
        );
      }
    } catch (e) {
      if (root.isConnected) root.replaceChildren(el('p', e.message));
    }
  };
  const points = (value) => (Number(value) / 100).toFixed(2);
  window.zhibanAssessment = {
    async render(tenant, offering, root, person, learning, onChanged = () => {}) {
      let state,
        busy = false,
        pending = null,
        closed = false,
        cursors = [null],
        page = 0;
      const controllers = new Set();
      const dirtyKey = 'grade:' + crypto.randomUUID();
      let unsaved = false;
      const markDirty = (value) => {
        unsaved = value;
        window.zhibanCoursePage?.setDirty(dirtyKey, value, root);
      };
      const live = () => !closed && root.isConnected;
      const notice = el('p');
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      const request = async (command, key) => {
        const c = new AbortController();
        controllers.add(c);
        const timer = setTimeout(() => c.abort(), 10000);
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
              throw Object.assign(new Error('登录已失效或安全令牌暂不可用'), {
                definitive: csrf.status >= 400 && csrf.status < 500,
              });
            headers['x-zhiban-csrf'] = (await csrf.json()).csrfToken;
            headers['x-zhiban-command'] = key;
            headers['Content-Type'] = 'application/json';
          }
          if (!live()) throw new Error('视图已关闭');
          const params =
            learning.paged && !command
              ? '/publications?' +
                new URLSearchParams({
                  submission: learning.submissions[0].id,
                  limit: '20',
                  ...(cursors[page] ? { cursor: cursors[page] } : {}),
                })
              : '';
          const response = await fetch(
            `/api/zhiban/assessment/${tenant}/offerings/${offering.id}${params}`,
            {
              method: command ? 'POST' : 'GET',
              headers,
              credentials: 'same-origin',
              cache: 'no-store',
              signal: c.signal,
              ...(command ? { body: JSON.stringify(command) } : {}),
            },
          );
          const data = await response.json();
          if (!response.ok)
            throw Object.assign(
              new Error(
                {
                  CONFLICT: '成绩或提交已变更，请刷新后重试。',
                  FORBIDDEN: '当前无评分或成绩查看权限。',
                  UNAUTHENTICATED: '登录已失效。',
                  INVALID_INPUT: '请检查分数、满分和更正说明。',
                  INVALID_STATE: '已发布成绩须通过更正操作修改。',
                }[data.error?.code] || '评分暂时不可用。',
              ),
              { definitive: response.status >= 400 && response.status < 500 },
            );
          if (learning.review && !command) {
            if (data.mode !== 'TEACHER' || !data.review)
              throw Object.assign(new Error('当前无评分权限。'), { definitive: true });
            const r = data.review;
            learning = {
              ...learning,
              activities: [{ id: r.activity_id, title: r.title, activity_type: r.activity_type }],
              attempts: [
                {
                  id: r.attempt_id,
                  activity_id: r.activity_id,
                  membership_id: r.membership_id,
                  attempt_no: r.attempt_no,
                },
              ],
              submissions: [r],
            };
          }
          return learning.paged && !command ? { ...data, publications: data.rows } : data;
        } finally {
          clearTimeout(timer);
          controllers.delete(c);
        }
      };
      const action = async (command, retry = false) => {
        if (busy || !live() || (pending && !retry)) return;
        if (
          unsaved &&
          !retry &&
          (!command || !['SAVE_GRADE', 'CORRECT_GRADE'].includes(command.type)) &&
          !confirm('有未保存的评分修改，确认放弃后继续？')
        )
          return;
        if (command) pending = { command, key: crypto.randomUUID() };
        busy = true;
        let committed = false;
        const controls = [...root.querySelectorAll('button,input,textarea,select')].map((n) => [
          n,
          n.disabled,
        ]);
        controls.forEach(([n]) => (n.disabled = true));
        try {
          if (pending) {
            await request(pending.command, pending.key);
            if (!live()) return;
            pending = null;
            committed = true;
            markDirty(false);
            cursors = [null];
            page = 0;
            notice.textContent = '操作已完成。';
            void onChanged();
          }
          state = await request();
          if (live()) draw();
        } catch (error) {
          if (!live()) return;
          if (pending && !error.definitive) {
            notice.replaceChildren(
              el('span', '结果待确认；请按原命令号重试，期间暂停其他操作。'),
              el('small', pending.key),
              button('按原命令号重试', () => action(null, true)),
            );
          } else {
            pending = null;
            notice.textContent = (committed ? '操作已完成，读取失败：' : '') + error.message;
            if (!command && !committed) {
              root.replaceChildren(
                notice,
                button('重新读取成绩', () => action()),
              );
            }
          }
        } finally {
          busy = false;
          if (!pending) controls.forEach(([n, d]) => (n.disabled = d));
        }
      };
      const button = (text, fn) => {
        const b = el('button', text);
        b.type = 'button';
        b.className = 'button secondary';
        b.onclick = fn;
        return b;
      };
      const quizCleanups = new Set();
      const draw = () => {
        quizCleanups.forEach((stop) => stop());
        quizCleanups.clear();
        markDirty(false);
        const teacher = state.mode === 'TEACHER';
        root.replaceChildren(el('h4', teacher ? '人工评分与成绩' : '查看成绩与反馈'), notice);
        root.append(button('刷新成绩', () => void action()));
        root.append(
          el(
            'p',
            teacher
              ? '成绩按具体提交版本发布；更正保留原成绩和公开说明。不计算课程总评。'
              : '这里只显示教师已发布的成绩与反馈，按具体提交版本保留，不计算课程总评。',
          ),
        );
        if (teacher)
          for (const submission of learning.submissions) {
            const attempt = learning.attempts.find((t) => t.id === submission.attempt_id);
            if (!attempt) continue;
            const latest = learning.paged
              ? submission.latest_submission
              : submission.version ===
                Math.max(
                  ...learning.submissions
                    .filter((s) => s.attempt_id === attempt.id)
                    .map((s) => s.version),
                );
            const grade = state.grades.find((g) => g.submission_id === submission.id);
            const published = grade?.published_version > 0;
            if (!latest && !published) continue;
            const card = el('details');
            card.open = !!learning.paged;
            card.className = 'academic-form';
            card.append(
              el(
                'summary',
                `${learning.activities.find((a) => a.id === attempt.activity_id)?.title ?? '学习活动'} · ${person(attempt.membership_id)} · 尝试 ${attempt.attempt_no} · 提交版本 ${submission.version}${latest ? '' : '（历史提交）'}`,
              ),
            );
            if (
              learning.activities.find((a) => a.id === attempt.activity_id)?.activity_type ===
              'QUIZ'
            ) {
              const quizRoot = el('div');
              card.append(quizRoot);
              quizCleanups.add(
                window.zhibanQuiz.render(tenant, offering.id, quizRoot, {
                  submission: submission.id,
                  onChanged: () => {
                    cursors = [null];
                    page = 0;
                    void action();
                    void onChanged();
                  },
                }),
              );
              root.append(card);
              continue;
            }
            card.append(el('p', submission.answer));
            if (state.submissionAttachments) {
              const files = el('section');
              files.setAttribute('aria-label', '提交附件');
              card.append(files);
              void window.zhibanSubmissionFiles(tenant, offering.id, submission.id, files);
            }
            const f = el('form');
            const field = (label, tag, value) => {
              const l = el('label', label),
                n = el(tag);
              n.setAttribute('aria-label', label);
              n.value = value ?? '';
              l.append(n);
              f.append(l);
              return n;
            };
            const maximum = field('满分', 'input', grade ? points(grade.max_points) : '');
            const score = field('得分', 'input', grade ? points(grade.score_points) : '');
            for (const n of [maximum, score]) {
              n.type = 'number';
              n.step = '0.01';
              n.min = n === maximum ? '0.01' : '0';
              n.max = '1000';
              n.required = true;
            }
            const feedback = field('评分反馈', 'textarea', grade?.feedback);
            feedback.maxLength = 2000;
            const reason = published ? field('公开更正说明', 'textarea', '') : null;
            if (reason) {
              reason.required = true;
              reason.maxLength = 1000;
            }
            const fields = [maximum, score, feedback, ...(reason ? [reason] : [])];
            const baseline = fields.map((n) => n.value);
            f.addEventListener('input', () =>
              markDirty(fields.some((n, i) => n.value !== baseline[i])),
            );
            const save = el('button', published ? '发布更正' : '保存评分草稿');
            save.type = 'submit';
            save.className = 'button primary';
            f.append(save);
            f.onsubmit = (e) => {
              e.preventDefault();
              void action({
                type: published ? 'CORRECT_GRADE' : 'SAVE_GRADE',
                submissionId: submission.id,
                revision: grade?.revision ?? null,
                score: score.value,
                maxScore: maximum.value,
                feedback: feedback.value,
                ...(published ? { reason: reason.value } : {}),
              });
            };
            card.append(f);
            if (grade && !published)
              card.append(
                button(
                  '发布成绩',
                  () =>
                    void action({
                      type: 'PUBLISH_GRADE',
                      submissionId: submission.id,
                      revision: grade.revision,
                    }),
                ),
              );
            root.append(card);
          }
        if (!state.publications.length) root.append(el('p', '尚无已发布成绩。'));
        if (learning.paged) {
          const nav = el('nav');
          nav.className = 'course-pagination';
          nav.setAttribute('aria-label', '成绩历史分页');
          const prev = button('上一页成绩历史', () => {
              if (!busy && page > 0) {
                page--;
                void action();
              }
            }),
            next = button('下一页成绩历史', () => {
              if (!busy && state.nextCursor) {
                cursors[++page] = state.nextCursor;
                void action();
              }
            });
          prev.disabled = page === 0;
          next.disabled = !state.nextCursor;
          nav.append(
            prev,
            el('span', `第 ${page + 1} 页 · 本页 ${state.publications.length} 条`),
            next,
          );
          root.append(nav);
        }
        for (const p of state.publications) {
          const section = el('section');
          section.className = 'learning-activity';
          section.append(
            el(
              'h5',
              `${learning.activities.find((a) => a.id === p.activity_id)?.title ?? '学习活动'} · ${teacher ? person(p.membership_id) + ' · ' : ''}尝试 ${p.attempt_no} · 提交版本 ${p.submission_version} · 成绩版本 ${p.version}（${p.version === (learning.paged ? p.current_version : Math.max(...state.publications.filter((q) => q.grade_id === p.grade_id).map((q) => q.version))) ? '该提交当前成绩' : '更正前成绩'}）${p.latest_submission ? '' : '（历史提交，新提交尚需另行评分）'}`,
            ),
            el(
              'p',
              `${points(p.score_points)} / ${points(p.max_points)} · ${new Date(Number(p.published_at)).toLocaleString('zh-CN')}`,
            ),
            el('p', p.feedback),
          );
          if (p.published_by === null) section.append(el('p', '受限 AI 服务正式评分 · 可从课程“AI 正式评分”提出本人申诉；人工更正保留原记录。'));
          if (p.reason) section.append(el('p', '更正说明：' + p.reason));
          root.append(section);
        }
      };
      function destroy() {
        if (closed) return;
        closed = true;
        quizCleanups.forEach((stop) => stop());
        quizCleanups.clear();
        markDirty(false);
        pending = null;
        controllers.forEach((c) => c.abort());
        observer.disconnect();
        channel?.close();
        window.removeEventListener('pagehide', destroy);
        root.replaceChildren();
      }
      const observer = new MutationObserver(() => {
        if (!root.isConnected) destroy();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const channel =
        typeof BroadcastChannel === 'function' ? new BroadcastChannel('zhiban-session') : null;
      if (channel) channel.onmessage = destroy;
      window.addEventListener('pagehide', destroy, { once: true });
      root.append(el('p', '正在读取成绩…'));
      try {
        state = await request();
        if (root.isConnected) draw();
      } catch (error) {
        if (live())
          root.replaceChildren(
            el('p', error.message),
            button('重新读取成绩', () => action()),
          );
      }
      return destroy;
    },
  };
})();
