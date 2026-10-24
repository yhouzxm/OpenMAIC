(async () => {
  if (window.zhibanAdminShell && !(await window.zhibanAdminShell.ready)) return;
  const root = document.getElementById('directory-results'),
    params = new URLSearchParams(location.search),
    tenant = params.get('tenant');
  if (
    !tenant ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenant) ||
    [...params.keys()].join(',') !== 'tenant'
  ) {
    const p = document.createElement('p');
    p.textContent = '空间地址无效，请从工作台进入。';
    p.setAttribute('role', 'alert');
    root.append(p);
    return;
  }
  window.zhibanDirectory.mount(tenant, root);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
})();
