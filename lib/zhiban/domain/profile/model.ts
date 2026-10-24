import { academicId, academicRevision, requireAcademic } from '../academic/model';
export type ProfileCommand =
  | { type: 'SAVE_AVATAR'; revision: string | null; png: string | null }
  | {
      type: 'SAVE_PROFILE';
      revision: string | null;
      displayName: string;
      email: string;
      qq: string;
      wechat: string;
      bio: string;
    }
  | {
      type: 'SAVE_DIRECTORY';
      membershipId: string;
      revision: string | null;
      formalName: string;
      studentNo: string;
      employeeNo: string;
    };
function text(value: unknown, max: number, empty = true, multiline = false): string {
  requireAcademic(typeof value === 'string');
  const v = value.trim();
  requireAcademic(v.isWellFormed() && v.length <= max && (empty || v.length > 0));
  requireAcademic(
    !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(
      v,
    ),
  );
  return v;
}
export function profileCommand(input: unknown): ProfileCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  requireAcademic(
    v.type === 'SAVE_PROFILE' || v.type === 'SAVE_DIRECTORY' || v.type === 'SAVE_AVATAR',
  );
  if (v.type === 'SAVE_AVATAR') {
    requireAcademic(
      Object.keys(v).length === 3 && Object.hasOwn(v, 'revision') && Object.hasOwn(v, 'png'),
    );
    requireAcademic(
      v.png === null ||
        (typeof v.png === 'string' &&
          v.png.length <= 16384 &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(v.png)),
    );
    return {
      type: 'SAVE_AVATAR',
      revision: v.revision === null ? null : academicRevision(v.revision),
      png: v.png as string | null,
    };
  }
  const fields =
    v.type === 'SAVE_PROFILE'
      ? ['type', 'revision', 'displayName', 'email', 'qq', 'wechat', 'bio']
      : ['type', 'revision', 'membershipId', 'formalName', 'studentNo', 'employeeNo'];
  requireAcademic(
    Object.keys(v).length === fields.length && fields.every((k) => Object.hasOwn(v, k)),
  );
  const revision = v.revision === null ? null : academicRevision(v.revision);
  if (v.type === 'SAVE_PROFILE') {
    const email = text(v.email, 254);
    requireAcademic(email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    return {
      type: v.type,
      revision,
      displayName: text(v.displayName, 120, false),
      email,
      qq: text(v.qq, 32),
      wechat: text(v.wechat, 100),
      bio: text(v.bio, 2000, true, true),
    };
  }
  const number = (n: unknown) => {
    const s = text(n, 64);
    requireAcademic(s === '' || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s));
    return s;
  };
  return {
    type: v.type,
    revision,
    membershipId: academicId(v.membershipId),
    formalName: text(v.formalName, 120, false),
    studentNo: number(v.studentNo),
    employeeNo: number(v.employeeNo),
  };
}
