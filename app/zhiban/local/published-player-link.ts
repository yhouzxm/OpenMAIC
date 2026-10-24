export function publishedPlayerHref(
  tenant: string,
  offering: string,
  resource: string,
  publication: string,
) {
  return `/api/zhiban/content/${tenant}/offerings/${offering}/resources/${resource}/player?publication=${publication}`;
}
