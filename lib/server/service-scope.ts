/** Trusted embedded-host scope; never populated from a browser header or model body. */
import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage<string | undefined>();
export const currentServiceTenant = () => scope.getStore();
export const withServiceTenant = <T>(tenant: string | undefined, work: () => T): T =>
  scope.run(tenant, work);
