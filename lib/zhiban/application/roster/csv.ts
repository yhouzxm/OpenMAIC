import { academicId, requireAcademic } from '../../domain/academic/model';
export const rosterLimits = Object.freeze({ rows: 50, bytes: 8192, previewMs: 300000, plans: 64 });
export interface CsvRow {
  line: number;
  membershipId: string;
  error: string | null;
}
/** Deliberately one column: no role, password, name overwrite or account creation commands. */
export function rosterCsv(input: unknown): CsvRow[] {
  requireAcademic(
    typeof input === 'string' &&
      Buffer.byteLength(input, 'utf8') <= rosterLimits.bytes &&
      input.isWellFormed(),
  );
  const text = input.replace(/^\uFEFF/, '');
  requireAcademic(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text));
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const field = (s: string) => {
    if (s.startsWith('"') && s.endsWith('"') && !s.slice(1, -1).includes('"'))
      return s.slice(1, -1);
    return s;
  };
  requireAcademic(
    field(lines[0] ?? '') === 'membershipId' &&
      lines.length >= 2 &&
      lines.length <= rosterLimits.rows + 1,
  );
  const seen = new Set<string>();
  return lines.slice(1).map((value, i) => {
    const membershipId = field(value);
    let error: string | null = null;
    try {
      academicId(membershipId);
    } catch {
      error = 'INVALID_ID';
    }
    if (!error && seen.has(membershipId)) error = 'DUPLICATE';
    seen.add(membershipId);
    return { line: i + 2, membershipId, error };
  });
}
