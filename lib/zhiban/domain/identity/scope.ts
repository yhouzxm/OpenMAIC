import { classId, courseId, type ClassId, type CourseId } from './ids';
import { invariant } from './errors';

export type SelfScope = Readonly<{ type: 'SELF'; scopeId: null }>;
export type TenantScope = Readonly<{ type: 'TENANT'; scopeId: null }>;
export type ClassScope = Readonly<{ type: 'CLASS'; scopeId: ClassId }>;
export type CourseScope = Readonly<{ type: 'COURSE'; scopeId: CourseId }>;
export type Scope = SelfScope | TenantScope | ClassScope | CourseScope;

export function selfScope(): SelfScope {
  return Object.freeze({ type: 'SELF', scopeId: null });
}

export function tenantScope(): TenantScope {
  return Object.freeze({ type: 'TENANT', scopeId: null });
}

export function classScope(id: ClassId): ClassScope {
  return Object.freeze({ type: 'CLASS', scopeId: classId(id) });
}

export function courseScope(id: CourseId): CourseScope {
  return Object.freeze({ type: 'COURSE', scopeId: courseId(id) });
}

/** Validates shape only; the application must verify resource kind, tenant, and relationship. */
export function parseScope(type: unknown, scopeId: unknown): Scope {
  if (type === 'SELF' || type === 'TENANT') {
    invariant(scopeId === null, 'INVALID_SCOPE', 'This scope requires a null identifier.');
    return type === 'SELF' ? selfScope() : tenantScope();
  }
  invariant(type === 'CLASS' || type === 'COURSE', 'INVALID_SCOPE', 'Unknown scope.');
  invariant(
    typeof scopeId === 'string' && scopeId.length > 0,
    'INVALID_SCOPE',
    'A scope identifier is required.',
  );
  return type === 'CLASS' ? classScope(classId(scopeId)) : courseScope(courseId(scopeId));
}
