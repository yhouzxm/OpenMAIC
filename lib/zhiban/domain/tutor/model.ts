import { createHash } from 'node:crypto';
import { academicId, requireAcademic } from '../academic/model';
export type TutorMode = 'TEACHER' | 'STUDENT';
export interface TutorSource {
  resourceId: string;
  publicationId: string;
  publicationNo: number;
  title: string;
  text: string;
  digest: string;
}
export type TutorCommand =
  | {
      type: 'SET_POLICY';
      mode: 'TEACHER';
      revision: string;
      enabled: boolean;
      guidance: string;
      peerEnabled?: boolean;
    }
  | {
      type: 'CREATE_SESSION';
      mode: TutorMode;
      title: string;
      resourceId: string | null;
      style?: 'TUTOR' | 'PEER';
    }
  | { type: 'ASK'; mode: TutorMode; id: string; revision: string; message: string }
  | { type: 'CANCEL'; mode: TutorMode; id: string; turnId: string }
  | { type: 'CLOSE_SESSION'; mode: TutorMode; id: string; revision: string };
export const digest = (x: unknown): string =>
  createHash('sha256')
    .update(
      JSON.stringify(x, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((k) => [k, value[k]]),
            )
          : value,
      ),
    )
    .digest('hex');
export function tutorText(value: unknown, max: number, empty = false): string {
  requireAcademic(
    typeof value === 'string' &&
      value.isWellFormed() &&
      value.length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  );
  requireAcademic(empty || value.trim().length > 0);
  return value.trim();
}
export function tutorCommand(input: unknown): TutorCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const c = input as Record<string, unknown>;
  requireAcademic(c.mode === 'TEACHER' || c.mode === 'STUDENT');
  const fields: Record<string, string[]> = {
    SET_POLICY: ['type', 'mode', 'revision', 'enabled', 'guidance'],
    CREATE_SESSION: ['type', 'mode', 'title', 'resourceId'],
    ASK: ['type', 'mode', 'id', 'revision', 'message'],
    CANCEL: ['type', 'mode', 'id', 'turnId'],
    CLOSE_SESSION: ['type', 'mode', 'id', 'revision'],
  };
  requireAcademic(typeof c.type === 'string' && !!fields[c.type]);
  const optional =
    c.type === 'SET_POLICY' ? 'peerEnabled' : c.type === 'CREATE_SESSION' ? 'style' : '';
  requireAcademic(
    Object.keys(c)
      .filter((k) => !optional || k !== optional)
      .sort()
      .join() === fields[c.type].sort().join(),
  );
  if (c.type === 'SET_POLICY') {
    requireAcademic(c.peerEnabled === undefined || typeof c.peerEnabled === 'boolean');
  }
  if (c.type === 'CREATE_SESSION') {
    requireAcademic(c.style === undefined || c.style === 'TUTOR' || c.style === 'PEER');
  }
  if ('id' in c) academicId(c.id);
  if ('turnId' in c) academicId(c.turnId);
  if ('revision' in c)
    requireAcademic(typeof c.revision === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(c.revision));
  if (c.type === 'SET_POLICY') {
    requireAcademic(c.mode === 'TEACHER' && typeof c.enabled === 'boolean');
    c.guidance = tutorText(c.guidance, 2000, true);
  }
  if (c.type === 'CREATE_SESSION') {
    c.title = tutorText(c.title, 120);
    if (c.resourceId !== null) academicId(c.resourceId);
  }
  if (c.type === 'ASK') c.message = tutorText(c.message, 2000);
  return c as unknown as TutorCommand;
}
