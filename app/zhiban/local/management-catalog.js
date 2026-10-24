/* Bounded administrator master-data forms and teaching-class selectors. */
(() => {
  const titles = { courses: '课程', terms: '学期', classes: '行政班' };
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, run) => {
    const b = el('button', text, 'button secondary');
    b.type = 'button';
    b.addEventListener('click', () => void run());
    return b;
  };
  function field(form, label, { type = 'text', value = '', required = true, max = 120 } = {}) {
    const l = el('label', label),
      input = el('input');
    input.type = type;
    input.value = value;
    input.required = required;
    input.maxLength = max;
    l.append(input);
    form.append(l);
    return input;
  }
  function ownerPicker(parent, actions, course) {
    const details = el('details'),
      status = el('p'),
      results = el('div'),
      note = el('p'),
      controls = el('div', undefined, 'management-actions');
    details.setAttribute('aria-label', '课程负责人选择器');
    details.append(
      el('summary', '选择课程负责人'),
      el('p', '候选仅含本空间当前有效教师；负责人是课程信息，不自动授予任教权限。', 'muted'),
      status,
    );
    parent.append(details);
    const original = course?.owner_membership_id ?? null;
    let selected = original,
      selectedName = course?.owner_name ?? '',
      changed = false,
      dead = false,
      loading = false,
      epoch = 0,
      version = 0,
      loaded = false,
      q = '',
      page = 0,
      cursors = [null];
    const current = () => {
      status.textContent = selected
        ? '当前负责人：' + (selectedName || '未填写姓名') + ' · ' + selected
        : '当前负责人：未设置';
    };
    current();
    function choose(id, name, fresh) {
      selected = id;
      selectedName = name || '';
      changed = fresh;
      version++;
      current();
    }
    if (course)
      controls.append(
        button('保留原负责人', () => {
          if (!actions.blocked()) choose(original, course.owner_name, false);
        }),
      );
    controls.append(
      button('清除负责人', () => {
        if (!actions.blocked()) choose(null, '', false);
      }),
    );
    details.append(controls);
    const query = field(details, '搜索课程负责人', { required: false });
    const label = el('label', '负责人每页条数'),
      size = el('select');
    size.setAttribute('aria-label', '负责人每页条数');
    for (const n of [10, 20, 50]) {
      const o = el('option', String(n));
      o.value = String(n);
      size.append(o);
    }
    size.value = '20';
    label.append(size);
    const search = button('搜索负责人', () => {
        if (!actions.blocked() && !loading) {
          q = query.value.trim();
          page = 0;
          cursors = [null];
          void load();
        }
      }),
      prev = button('上一页负责人', () => {
        if (!actions.blocked() && !loading && page > 0) {
          page--;
          void load();
        }
      }),
      next = button('下一页负责人', () => {
        if (!actions.blocked() && !loading && cursors[page + 1]) {
          page++;
          void load();
        }
      });
    details.append(label, search, note, results, prev, next);
    note.setAttribute('role', 'status');
    function paging() {
      search.disabled = loading;
      size.disabled = loading;
      query.disabled = loading;
      prev.disabled = loading || page === 0;
      next.disabled = loading || !cursors[page + 1];
    }
    function params(extra = {}) {
      return {
        purpose: course ? 'EDIT_COURSE' : 'CREATE_COURSE',
        ...(course ? { courseId: course.id } : {}),
        ...extra,
      };
    }
    async function load() {
      if (dead || actions.blocked()) return;
      loading = true;
      const run = ++epoch;
      paging();
      note.textContent = '正在读取负责人候选…';
      try {
        const data = await actions.request(
          'owner-candidates',
          params({ q, limit: size.value, cursor: cursors[page] }),
        );
        if (dead || run !== epoch || !details.isConnected) return;
        loaded = true;
        results.replaceChildren();
        cursors.length = page + 1;
        cursors[page + 1] = data.nextCursor;
        for (const row of data.rows) {
          const item = el('article', undefined, 'management-card');
          item.append(
            el('p', row.name || '未填写姓名'),
            el('small', row.membership_id),
            button('选择负责人 ' + (row.name || row.membership_id), () => {
              if (!actions.blocked() && !loading) choose(row.membership_id, row.name, true);
            }),
          );
          results.append(item);
        }
        note.textContent =
          '第 ' +
          (page + 1) +
          ' 页 · ' +
          data.rows.length +
          ' 位候选' +
          (!data.rows.length && data.nextCursor ? '，可继续下一页' : '');
      } catch (e) {
        if (!dead && run === epoch) note.textContent = '读取失败：' + e.message;
      } finally {
        if (!dead && run === epoch) {
          loading = false;
          paging();
        }
      }
    }
    size.addEventListener('change', () => {
      if (!actions.blocked() && !loading) {
        q = query.value.trim();
        page = 0;
        cursors = [null];
        void load();
      }
    });
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        search.click();
      }
    });
    details.addEventListener('toggle', () => {
      if (details.open && !loaded && !loading) void load();
    });
    paging();
    return {
      read: () => selected,
      async validate() {
        if (!changed || selected === null) return;
        if (loading) throw new Error('请等待候选读取完成。');
        const id = selected,
          v = version;
        const data = await actions.request('owner-candidates', params({ q: id, limit: '10' }));
        if (dead || !details.isConnected || v !== version)
          throw new Error('负责人选择已失效，请重新选择。');
        if (!data.rows.some((row) => row.membership_id === id))
          throw new Error('所选教师已不在有效候选中，请重新选择、清除或保留原负责人。');
      },
      destroy() {
        dead = true;
        epoch++;
        selected = null;
        selectedName = '';
        results.replaceChildren();
        query.value = '';
      },
    };
  }
  function form(parent, title, build, submit, blocked) {
    const details = el('details', undefined, 'management-card'),
      f = el('form');
    details.setAttribute('aria-label', title);
    details.append(el('summary', title));
    const built = build(f),
      read = typeof built === 'function' ? built : built.read,
      error = el('p'),
      save = el(
        'button',
        title === '编辑课程' ? '保存课程' : title.replace('新建', '创建'),
        'button',
      );
    let dead = false,
      checking = false;
    error.setAttribute('role', 'alert');
    save.type = 'submit';
    f.append(error, save);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (blocked() || checking || dead) return;
      checking = true;
      error.textContent = '';
      const fields = [...f.querySelectorAll('input,select,button')].map((n) => [n, n.disabled]);
      fields.forEach(([n]) => (n.disabled = true));
      try {
        if (typeof built !== 'function') await built.validate?.();
        if (!dead && details.isConnected && !blocked()) await submit(read());
      } catch (e) {
        if (!dead) error.textContent = e.message;
      } finally {
        checking = false;
        if (!dead && !blocked()) fields.forEach(([n, disabled]) => (n.disabled = disabled));
      }
    });
    details.append(f);
    parent.append(details);
    return () => {
      dead = true;
      if (typeof built !== 'function') built.destroy?.();
    };
  }
  function createMaster(parent, kind, actions) {
    const title = titles[kind];
    return form(
      parent,
      '新建' + title,
      (f) => {
        const code = field(f, title + '编号'),
          name = field(f, title + '名称');
        const description =
          kind === 'courses' ? field(f, '课程简介', { required: false, max: 2000 }) : null;
        const starts = kind === 'terms' ? field(f, '开始日期', { type: 'date' }) : null,
          ends = kind === 'terms' ? field(f, '结束日期', { type: 'date' }) : null;
        const owner = kind === 'courses' ? ownerPicker(f, actions, null) : null;
        const read = () => ({
          type: { courses: 'CREATE_COURSE', terms: 'CREATE_TERM', classes: 'CREATE_CLASS' }[kind],
          code: code.value.trim(),
          name: name.value.trim(),
          ...(kind === 'courses'
            ? { description: description.value.trim(), ownerMembershipId: owner.read() }
            : {}),
          ...(kind === 'terms' ? { startsOn: starts.value, endsOn: ends.value } : {}),
        });
        return owner ? { read, validate: owner.validate, destroy: owner.destroy } : read;
      },
      actions.create,
      actions.blocked,
    );
  }
  function master(card, kind, row, actions) {
    const status = { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' };
    card.append(el('h2', row.name), el('p', row.code), el('small', row.id));
    if (kind === 'terms') card.append(el('p', `${row.starts_on} 至 ${row.ends_on}`));
    if (kind === 'classes' && row.head_teacher_id)
      card.append(el('p', '班主任成员 ID：' + row.head_teacher_id));
    if (kind === 'classes') {
      const a = el('a', '管理成员与班主任', 'button secondary');
      a.href = '/zhiban/relationships?tenant=' + actions.tenant + '&classId=' + row.id;
      card.append(a);
    }
    if (kind !== 'courses') return;
    card.append(
      el('p', `${status[row.status]} · 发布版本 ${row.published_version}`),
      el('p', row.description),
    );
    if (row.owner_membership_id)
      card.append(
        el(
          'small',
          '负责人：' + (row.owner_name || '未填写姓名') + ' · ' + row.owner_membership_id,
        ),
      );
    if (row.status === 'ARCHIVED') return;
    const destroy = form(
      card,
      '编辑课程',
      (f) => {
        const name = field(f, '课程名称', { value: row.name }),
          desc = field(f, '课程简介', { value: row.description, required: false, max: 2000 });
        const owner = ownerPicker(f, actions, row);
        return {
          validate: owner.validate,
          destroy: owner.destroy,
          read: () => ({
            type: 'EDIT_COURSE',
            id: row.id,
            revision: row.revision,
            name: name.value.trim(),
            description: desc.value.trim(),
            ownerMembershipId: owner.read(),
          }),
        };
      },
      actions.mutate,
      actions.blocked,
    );
    if (row.status === 'DRAFT')
      card.append(
        button(
          '发布课程',
          () =>
            !actions.blocked() &&
            actions.mutate({ type: 'PUBLISH_COURSE', id: row.id, revision: row.revision }),
        ),
      );
    const archive = el('details');
    archive.append(
      el('summary', '归档课程'),
      el('p', '归档后不能继续编辑该课程或使用它新建教学班。'),
      button(
        '确认归档课程',
        () =>
          !actions.blocked() &&
          actions.mutate({ type: 'ARCHIVE_COURSE', id: row.id, revision: row.revision }),
      ),
    );
    card.append(archive);
    return destroy;
  }
  function createOffering(parent, actions) {
    const details = el('details', undefined, 'management-card');
    details.append(el('summary', '新建教学班'));
    parent.append(details);
    const fields = el('form'),
      selectors = el('div', undefined, 'management-selectors');
    details.append(selectors, fields);
    fields.append(
      el('p', '课程使用提交时的已发布版本。行政班可不关联，选择不会自动添加任教或学生。', 'muted'),
    );
    const code = field(fields, '教学班编号'),
      name = field(fields, '教学班名称'),
      capacity = field(fields, '教学班容量', { type: 'number', value: '20' });
    capacity.min = '1';
    capacity.max = '1000';
    capacity.step = '1';
    const error = el('p');
    error.setAttribute('role', 'alert');
    fields.append(error);
    const save = el('button', '创建教学班', 'button');
    save.type = 'submit';
    fields.append(save);
    const chosen = { courses: null, terms: null, classes: null };
    let destroyed = false,
      loaded = false;
    const invalidate = [];
    function selector(kind) {
      const label = titles[kind],
        section = el('section', undefined, 'management-selector');
      section.setAttribute('aria-label', label + '选择器');
      selectors.append(section);
      section.append(el('h3', '选择' + label + (kind === 'classes' ? '（可选）' : '')));
      const selected = el('p', '尚未选择' + label);
      selected.setAttribute('role', 'status');
      section.append(selected);
      if (kind === 'classes')
        section.append(
          button('不关联行政班', () => {
            if (actions.blocked()) return;
            chosen.classes = null;
            selected.textContent = '不关联行政班';
          }),
        );
      const filters = el('form', undefined, 'management-filters'),
        input = field(filters, label + '搜索', { required: false });
      input.placeholder = '名称、编号或完整 ID';
      const sizeLabel = el('label', label + '每页条数'),
        size = el('select');
      size.setAttribute('aria-label', label + '每页条数');
      for (const v of ['10', '20', '50']) {
        const o = el('option', v);
        o.value = v;
        size.append(o);
      }
      sizeLabel.append(size);
      filters.append(sizeLabel);
      const search = el('button', '搜索' + label, 'button secondary');
      search.type = 'submit';
      filters.append(search);
      section.append(filters);
      const results = el('div', undefined, 'management-selector-results');
      section.append(results);
      let q = '',
        limit = '10',
        cursor = null,
        history = [null],
        index = 0,
        epoch = 0,
        loading = false;
      invalidate.push(() => epoch++);
      filters.addEventListener('submit', (e) => {
        e.preventDefault();
        if (actions.blocked() || loading) return;
        q = input.value.trim();
        limit = size.value;
        cursor = null;
        history = [null];
        index = 0;
        void load();
      });
      async function load() {
        if (destroyed || actions.blocked()) return;
        const version = ++epoch;
        loading = true;
        filters.querySelectorAll('input,button,select').forEach((n) => (n.disabled = true));
        results.replaceChildren(el('p', '正在读取' + label + '…'));
        try {
          const data = await actions.request(kind, {
            q,
            limit,
            state: kind === 'courses' ? 'PUBLISHED' : 'ALL',
            cursor,
          });
          if (destroyed || version !== epoch || !section.isConnected) return;
          results.replaceChildren();
          for (const row of data.rows) {
            const item = el('div', undefined, 'management-option');
            item.append(
              el(
                'span',
                `${row.name} · ${row.code}${kind === 'courses' ? ' · 版本 ' + row.published_version : ''}`,
              ),
              el('small', row.id),
              button('选择' + label + ' ' + row.name, () => {
                if (actions.blocked() || destroyed) return;
                chosen[kind] = row;
                selected.textContent = `已选${label}：${row.name} · ${row.code}${kind === 'courses' ? ' · 当前版本 ' + row.published_version : ''}`;
              }),
            );
            results.append(item);
          }
          if (!data.rows.length)
            results.append(
              el('p', index ? '本页无记录，请返回上一页或搜索。' : '未找到可选择的' + label + '。'),
            );
          const nav = el('nav', undefined, 'management-pagination');
          nav.setAttribute('aria-label', label + '选择分页');
          const prev = button('上一页' + label, () => {
              if (!loading && !actions.blocked() && index > 0) {
                cursor = history[--index];
                return load();
              }
            }),
            next = button('下一页' + label, () => {
              if (!loading && !actions.blocked() && data.nextCursor) {
                history[++index] = cursor = data.nextCursor;
                return load();
              }
            });
          prev.disabled = index === 0;
          next.disabled = !data.nextCursor;
          nav.append(prev, el('span', `第 ${index + 1} 页 · 本页 ${data.rows.length} 条`), next);
          results.append(nav);
        } catch (e) {
          if (!destroyed && version === epoch && section.isConnected)
            results.replaceChildren(el('p', e.message), button('重试' + label, load));
        } finally {
          if (!destroyed && version === epoch) {
            loading = false;
            filters
              .querySelectorAll('input,button,select')
              .forEach((n) => (n.disabled = actions.blocked()));
          }
        }
      }
      void load();
    }
    details.addEventListener('toggle', () => {
      if (details.open && !loaded && !actions.blocked()) {
        loaded = true;
        for (const kind of ['courses', 'terms', 'classes']) selector(kind);
      }
    });
    fields.addEventListener('submit', (e) => {
      e.preventDefault();
      if (actions.blocked() || destroyed) return;
      if (!chosen.courses || !chosen.terms) {
        error.textContent = '请先选择已发布课程和学期。';
        return;
      }
      error.textContent = '';
      void actions.create({
        type: 'CREATE_OFFERING',
        courseId: chosen.courses.id,
        termId: chosen.terms.id,
        classId: chosen.classes?.id || null,
        code: code.value.trim(),
        name: name.value.trim(),
        capacity: Number(capacity.value),
      });
    });
    return () => {
      destroyed = true;
      invalidate.forEach((fn) => fn());
      for (const kind of ['courses', 'terms', 'classes']) chosen[kind] = null;
    };
  }
  window.zhibanCatalog = { createMaster, master, createOffering };
})();
