/* Standalone entry; the workbench mounts the same view after server-side role selection. */
(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('management-content'),
    message = document.getElementById('management-message'),
    params = new URLSearchParams(location.search),
    tenant = params.get('tenant');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !tenant ||
    !uuid.test(tenant) ||
    [...params.keys()].some(
      (k) => !['tenant', 'section', 'offering'].includes(k) || params.getAll(k).length !== 1,
    ) ||
    (params.has('section') &&
      !Object.hasOwn(window.zhibanAdminShell.labels, params.get('section'))) ||
    (params.has('offering') && !uuid.test(params.get('offering')))
  ) {
    message.textContent = '空间地址无效，请从工作台进入。';
    return;
  }
  window.zhibanManagement.mount(tenant, root, message, {
    section: params.get('section') || 'offerings',
    offering: params.get('offering'),
    route: true,
  });
})();
