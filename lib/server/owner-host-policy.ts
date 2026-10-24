/** Optional host fences. No policy changes for deployments that do not register one. */
import type { Queryable } from '@openmaic/storage/document/pg';
type Policy = {
  execution(owner: string): Promise<void>;
  document(owner: string, stage: string, mode: string, queryable: Queryable): Promise<void>;
};
let policy: Policy | undefined;
export function configureOwnerHostPolicy(value: Policy) {
  if (policy) throw Error('Owner host policy already configured');
  policy = value;
}
export async function assertOwnerExecution(owner: string) {
  await policy?.execution(owner);
}
export async function assertOwnerDocument(
  owner: string,
  stage: string,
  mode: string,
  q: Queryable,
) {
  await policy?.document(owner, stage, mode, q);
}
