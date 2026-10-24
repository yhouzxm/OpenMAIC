/* Bounded teacher gradebook. Navigation never supplies authorization. */
window.zhibanGradebook = {
  async render(root, tenant, offering, review) {
    let dead = false,
      busy = false,
      exporting = false,
      refreshAgain = false,
      q = '',
      limit = '20',
      activityLimit = '5',
      students = [null],
      activities = [null],
      studentPage = 0,
      activityPage = 0;
    const el = (tag, text) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const button = (text, fn) => {
      const b = el('button', text);
      b.type = 'button';
      b.onclick = () => void fn();
      return b;
    };
    let controller, exportController;
    async function load() {
      if (dead) return;
      if (busy) {
        refreshAgain = true;
        return;
      }
      busy = true;
      root.querySelectorAll('button,input,select').forEach((n) => (n.disabled = true));
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const params = new URLSearchParams({ q, limit, activityLimit });
        if (students[studentPage]) params.set('cursor', students[studentPage]);
        if (activities[activityPage]) params.set('activityCursor', activities[activityPage]);
        const response = await fetch(
          `/api/zhiban/assessment/${tenant}/offerings/${offering}/gradebook?${params}`,
          {
            headers: { 'x-zhiban-request': 'identity-v1' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? '当前教师课程权限已变化。'
              : response.status === 401
                ? '登录已失效。'
                : '成绩簿读取失败，请重试。',
          );
        const data = await response.json();
        if (dead) return;
        root.replaceChildren();
        root.append(el('h2', '课程成绩簿'));
        root.append(
          el(
            'p',
            '当前在班学生 × 当前发布活动。每格取该版本最新尝试、最新提交及其最新公开成绩；未提交不记零分。本表是单项成绩；课程总评由“课程总评与成绩申诉”中的显式权重及发布快照独立处理。',
          ),
        );
        const form = el('form');
        form.className = 'course-filters';
        const label = el('label', '搜索成绩簿学生'),
          input = el('input');
        input.value = q;
        input.maxLength = 120;
        label.append(input);
        form.append(label);
        const size = (title, values, current) => {
          const l = el('label', title),
            s = el('select');
          s.setAttribute('aria-label', title);
          values.forEach((v) => {
            const o = el('option', v);
            o.value = v;
            s.append(o);
          });
          s.value = current;
          l.append(s);
          form.append(l);
          return s;
        };
        const studentSize = size('成绩簿学生每页条数', ['10', '20', '50'], limit),
          activitySize = size('成绩簿活动每页列数', ['5', '10'], activityLimit);
        const search = el('button', '查询成绩簿');
        search.type = 'submit';
        form.append(search);
        form.onsubmit = (e) => {
          e.preventDefault();
          if (busy) return;
          q = input.value.trim();
          limit = studentSize.value;
          activityLimit = activitySize.value;
          students = [null];
          activities = [null];
          studentPage = activityPage = 0;
          return load();
        };
        const download = async (all) => {
          if (dead || busy || exporting) return;
          exporting = true;
          const controls = [...root.querySelectorAll('button,input,select')].map((node) => [
            node,
            node.disabled,
          ]);
          controls.forEach(([node]) => (node.disabled = true));
          exportStatus.textContent = '正在按当前已查询条件重新读取并生成文件…';
          exportController = new AbortController();
          const timer = setTimeout(() => exportController.abort(), 10000);
          try {
            const response = await fetch(
              `/api/zhiban/assessment/${tenant}/offerings/${offering}/${all ? 'gradebook-export.csv' : 'gradebook.csv'}?${all ? new URLSearchParams({ q }) : params}`,
              {
                headers: { 'x-zhiban-request': 'identity-v1' },
                credentials: 'same-origin',
                cache: 'no-store',
                signal: exportController.signal,
              },
            );
            if (!response.ok)
              throw new Error(
                response.status === 403
                  ? '权限已变化，无法导出。'
                  : response.status === 413
                    ? '导出超限：最多500名学生、100项活动、10,000条记录、8 MiB；请缩小学生筛选或使用当前页导出。'
                    : response.status === 401
                      ? '登录已失效，无法导出。'
                      : '导出失败，请重试。',
              );
            if (!response.headers.get('content-type')?.startsWith('text/csv'))
              throw new Error('导出响应格式无效。');
            const blob = await response.blob();
            if (dead) return;
            if (blob.size > (all ? 8 : 2) * 1024 * 1024) throw new Error('导出超过文件上限。');
            const url = URL.createObjectURL(blob),
              link = el('a');
            link.href = url;
            link.download = `zhiban-gradebook-${all ? 'filtered-' : ''}${offering}.csv`;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            exportStatus.textContent = all
              ? '跨页 CSV 已生成（按已查询的学生筛选，含全部匹配在班学生与当前发布活动；以下载时单次快照为准）。'
              : '当前页 CSV 已生成（按下载时数据，不含其他分页）。';
          } catch (e) {
            if (!dead) exportStatus.textContent = e.message;
          } finally {
            clearTimeout(timer);
            exporting = false;
            if (!dead)
              controls.forEach(([node, disabled]) => {
                if (node.isConnected) node.disabled = disabled;
              });
          }
        };
        const exportButton = button('导出当前页 CSV', () => download(false));
        const filterExportButton = button('按查询条件跨页导出 CSV', () => download(true));
        const exportStatus = el('p');
        exportStatus.setAttribute('role', 'status');
        root.append(form, button('刷新成绩簿', load));
        if (data.csvPageExport === true)
          root.append(
            exportButton,
            el(
              'p',
              '仅导出当前学生页 × 当前活动页，最多50人×10项、500条记录；使用已查询的筛选，以下载时数据为准。空页仅含表头，不含答题正文、反馈或评分草稿。',
            ),
            exportStatus,
          );
        if (data.csvFilterExport)
          root.append(
            filterExportButton,
            el(
              'p',
              '跨页导出使用已查询的学生筛选，忽略当前学生页和活动页。最多500名学生、100项当前发布活动、10,000条记录、8 MiB；超限不生成文件。仅含公开成绩，未提交不记零分。',
            ),
          );
        root.append(
          el(
            'p',
            `查询时间：${new Date(data.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`,
          ),
        );
        if (!data.rows.length) root.append(el('p', '暂无匹配的在班学生。'));
        if (!data.activities.length) root.append(el('p', '当前活动页暂无已发布活动。'));
        if (data.rows.length && data.activities.length) {
          const wrap = el('div');
          wrap.className = 'gradebook-scroll';
          wrap.setAttribute('role', 'region');
          wrap.setAttribute('aria-label', '课程成绩表');
          wrap.tabIndex = 0;
          const table = el('table');
          table.className = 'management-table';
          const caption = el('caption', '学生与活动成绩（公开成绩）');
          table.append(caption);
          const head = el('thead'),
            tr = el('tr');
          const sh = el('th', '学生');
          sh.scope = 'col';
          tr.append(sh);
          data.activities.forEach((a) => {
            const th = el('th', `${a.title} · v${a.version}`);
            th.scope = 'col';
            tr.append(th);
          });
          head.append(tr);
          table.append(head);
          const body = el('tbody');
          data.rows.forEach((row) => {
            const tr = el('tr'),
              th = el('th', row.display_name);
            th.scope = 'row';
            th.append(el('small', row.membership_id));
            tr.append(th);
            row.cells.forEach((cell) => {
              const td = el('td');
              const text = {
                NOT_STARTED: '未开始',
                IN_PROGRESS: '已开始 · 未提交',
                AWAITING_GRADE: '已提交 · 待发布成绩',
                PUBLISHED: `${(cell.score_points / 100).toFixed(2)} / ${(cell.max_points / 100).toFixed(2)}`,
              }[cell.state];
              td.append(el('p', text));
              if (cell.attempt_no)
                td.append(
                  el(
                    'small',
                    `尝试 ${cell.attempt_no}${cell.submission_version ? ' · 提交 v' + cell.submission_version : ''}${cell.grade_version ? ' · 成绩 v' + cell.grade_version : ''}`,
                  ),
                );
              if (cell.submission_id)
                td.append(
                  button(cell.state === 'PUBLISHED' ? '查看该提交成绩' : '评分该提交', () =>
                    review({
                      id: cell.submission_id,
                      membership_id: row.membership_id,
                      student_name: row.display_name,
                      activity_title: data.activities.find((a) => a.id === cell.activity_id).title,
                    }),
                  ),
                );
              tr.append(td);
            });
            body.append(tr);
          });
          table.append(body);
          wrap.append(table);
          root.append(wrap);
        }
        for (const axis of ['student', 'activity']) {
          const isStudent = axis === 'student',
            history = isStudent ? students : activities,
            page = isStudent ? studentPage : activityPage,
            next = isStudent ? data.nextCursor : data.activityNextCursor,
            title = isStudent ? '学生' : '活动';
          const nav = el('nav');
          nav.setAttribute('aria-label', '成绩簿' + title + '分页');
          const prev = button('上一页' + title, () => {
              if (busy || page === 0) return;
              if (isStudent) studentPage--;
              else activityPage--;
              return load();
            }),
            more = button('下一页' + title, () => {
              if (busy || !next) return;
              history[page + 1] = next;
              if (isStudent) studentPage++;
              else activityPage++;
              return load();
            });
          prev.disabled = page === 0;
          more.disabled = !next;
          nav.append(
            prev,
            el(
              'span',
              `第 ${page + 1} 页 · 本页 ${isStudent ? data.rows.length : data.activities.length} ${isStudent ? '人' : '项'}`,
            ),
            more,
          );
          root.append(nav);
        }
      } catch (e) {
        if (!dead) root.replaceChildren(el('p', e.message), button('重试成绩簿', load));
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (refreshAgain && !dead) {
          refreshAgain = false;
          void load();
        }
      }
    }
    await load();
    return Object.assign(
      () => {
        dead = true;
        controller?.abort();
        exportController?.abort();
        root.replaceChildren();
      },
      { refresh: load },
    );
  },
};
