/** ASCII perimeter whitespace only. Password is NEVER passed to this resolver. */
export function canonicalLoginIdentifier(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 128) return null;
  const id = input.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(id)
    ? id
    : null;
}
