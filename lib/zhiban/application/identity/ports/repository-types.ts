declare const revisionBrand: unique symbol;

/** Canonical positive signed-int8 decimal persistence token; not authorizationVersion. */
export type RepositoryRevision = string & { readonly [revisionBrand]: 'RepositoryRevision' };

export function repositoryRevision(value: string): RepositoryRevision {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$(?![\s\S])/.test(value) ||
    BigInt(value) > BigInt('9223372036854775807')
  ) {
    throw new TypeError('A canonical positive signed-int8 repository revision is required.');
  }
  return value as RepositoryRevision;
}

export interface Loaded<T> {
  readonly value: T;
  readonly revision: RepositoryRevision;
}
