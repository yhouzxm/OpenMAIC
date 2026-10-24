import {
  academicCommand,
  requireAcademic,
  type AcademicCommand,
} from '../../domain/academic/model';
import { profileCommand, type ProfileCommand } from '../../domain/profile/model';
export const importColumns = {
  TERMS: ['code', 'name', 'startsOn', 'endsOn'],
  COURSES: ['code', 'name', 'description'],
  CLASSES: ['code', 'name'],
  OFFERINGS: ['courseId', 'termId', 'classId', 'code', 'name', 'capacity'],
  DIRECTORY: ['membershipId', 'formalName', 'studentNo', 'employeeNo'],
  CLASS_MEMBERS: ['classId', 'membershipId'],
  ENROLLMENTS: ['offeringId', 'membershipId'],
} as const;
export type ImportKind = keyof typeof importColumns;
export type ImportCommand = AcademicCommand | ProfileCommand;
export interface ParsedImportRow {
  line: number;
  label: string;
  command: ImportCommand | null;
  code: string | null;
}
export function importKind(v: unknown): ImportKind {
  requireAcademic(typeof v === 'string' && Object.hasOwn(importColumns, v));
  return v as ImportKind;
}
/** Strict CSV, fixed columns, no multiline fields. Physical line numbers remain actionable. */
export function importCsv(kind: ImportKind, value: unknown): ParsedImportRow[] {
  requireAcademic(
    typeof value === 'string' && value.isWellFormed() && Buffer.byteLength(value) <= 65536,
  );
  const text = value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  requireAcademic(!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text));
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  requireAcademic(lines.length >= 2 && lines.length <= 51);
  function fields(s: string): string[] {
    requireAcademic(/^(?:[^",\r\n]*|"(?:[^"]|"")*")(?:,(?:[^",\r\n]*|"(?:[^"]|"")*"))*$/.test(s));
    const result: string[] = [];
    let field = '',
      quoted = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '"') {
        if (quoted && s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (s[i] === ',' && !quoted) {
        result.push(field);
        field = '';
      } else field += s[i];
    }
    result.push(field);
    return result;
  }
  requireAcademic(JSON.stringify(fields(lines[0])) === JSON.stringify(importColumns[kind]));
  const seen = new Set<string>();
  const numbers = new Set<string>();
  return lines.slice(1).map((line, i) => {
    let label = '';
    try {
      const values = fields(line);
      requireAcademic(values.length === importColumns[kind].length);
      const v = Object.fromEntries(importColumns[kind].map((k, n) => [k, values[n]]));
      label = (v.name || v.formalName || v.membershipId || '').slice(0, 120);
      let c: ImportCommand;
      switch (kind) {
        case 'DIRECTORY':
          c = profileCommand({ type: 'SAVE_DIRECTORY', ...v, revision: null });
          break;
        case 'COURSES':
          c = academicCommand({ type: 'CREATE_COURSE', ...v, ownerMembershipId: null });
          break;
        case 'OFFERINGS':
          requireAcademic(/^[1-9][0-9]{0,3}$/.test(v.capacity));
          c = academicCommand({
            type: 'CREATE_OFFERING',
            ...v,
            classId: v.classId || null,
            capacity: Number(v.capacity),
          });
          break;
        case 'CLASS_MEMBERS':
          c = academicCommand({ type: 'CLASS_MEMBER', ...v, active: true, revision: null });
          break;
        case 'ENROLLMENTS':
          c = academicCommand({ type: 'ENROLL', ...v, revision: null });
          break;
        default:
          c = academicCommand({ type: kind === 'TERMS' ? 'CREATE_TERM' : 'CREATE_CLASS', ...v });
      }
      const identity =
        kind === 'DIRECTORY'
          ? v.membershipId
          : kind === 'CLASS_MEMBERS'
            ? v.membershipId
            : kind === 'ENROLLMENTS'
              ? `${v.offeringId}:${v.membershipId}`
              : kind === 'OFFERINGS'
                ? `${v.termId}:${v.code}`
                : v.code;
      requireAcademic(!seen.has(identity), 'CONFLICT');
      if (kind === 'DIRECTORY') {
        const keys = ['studentNo', 'employeeNo'].filter((k) => v[k]).map((k) => k + ':' + v[k]);
        requireAcademic(
          keys.every((k) => !numbers.has(k)),
          'CONFLICT',
        );
        keys.forEach((k) => numbers.add(k));
      }
      seen.add(identity);
      return { line: i + 2, label, command: c, code: null };
    } catch (e) {
      return {
        line: i + 2,
        label,
        command: null,
        code: (e as { code?: string }).code === 'CONFLICT' ? 'DUPLICATE' : 'INVALID_INPUT',
      };
    }
  });
}
