declare const revisionBrand: unique symbol;

/** Opaque persistence concurrency token; never use as authorizationVersion. */
export type RepositoryRevision = string & { readonly [revisionBrand]: 'RepositoryRevision' };

export function repositoryRevision(value: string): RepositoryRevision {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('A nonempty repository revision is required.');
  }
  return value as RepositoryRevision;
}

export interface Loaded<T> {
  readonly value: T;
  readonly revision: RepositoryRevision;
}
