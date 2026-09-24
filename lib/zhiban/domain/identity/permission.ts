import { invariant } from './errors';

declare const permissionBrand: unique symbol;
export type Permission = string & { readonly [permissionBrand]: true };

/** Syntax only: approved vocabulary and resource relationships belong to the caller. */
export function permission(value: unknown): Permission {
  invariant(
    typeof value === 'string' && /^[a-z]+(?:_[a-z]+)*:[a-z]+(?:_[a-z]+)*$/.test(value),
    'INVALID_PERMISSION',
    'Expected a stable lowercase resource:action code.',
  );
  return value as Permission;
}
