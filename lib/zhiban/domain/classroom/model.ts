import { academicId, academicRevision, academicText, requireAcademic } from '../academic/model';
export type ClassroomCommand =
  | {
      type: 'DISPATCH_JOINT_TASK';
      id: string;
      revision: string;
      activityId: string;
      activityVersion: string;
      interactiveId: string;
      publicationId: string;
    }
  | {
      type: 'CREATE_CLASSROOM';
      title: string;
      description: string;
      opensAt: number | null;
      closesAt: number | null;
    }
  | {
      type: 'EDIT_CLASSROOM';
      id: string;
      revision: string;
      title: string;
      description: string;
      opensAt: number | null;
      closesAt: number | null;
    }
  | { type: 'PUBLISH_CLASSROOM' | 'END_CLASSROOM' | 'END_TASK'; id: string; revision: string }
  | {
      type: 'DISPATCH_TASK';
      id: string;
      revision: string;
      kind: 'LECTURE' | 'ACTIVITY';
      target: string;
      version: string;
    }
  | {
      type: 'RESCHEDULE_CLASSROOM';
      id: string;
      revision: string;
      opensAt: number | null;
      closesAt: number | null;
    }
  | {
      type: 'PRESENT_LECTURE_PAGE';
      id: string;
      revision: string;
      dispatchId: string;
      presentationRevision: string;
      page: number;
    }
  | { type: 'ENTER_TASK'; id: string; revision: string; dispatchId: string };
export function classroomCommand(input: unknown): ClassroomCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const x = input as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    CREATE_CLASSROOM: ['title', 'description', 'opensAt', 'closesAt'],
    EDIT_CLASSROOM: ['id', 'revision', 'title', 'description', 'opensAt', 'closesAt'],
    RESCHEDULE_CLASSROOM: ['id', 'revision', 'opensAt', 'closesAt'],
    PUBLISH_CLASSROOM: ['id', 'revision'],
    END_CLASSROOM: ['id', 'revision'],
    END_TASK: ['id', 'revision'],
    DISPATCH_TASK: ['id', 'revision', 'kind', 'target', 'version'],
    DISPATCH_JOINT_TASK: [
      'id',
      'revision',
      'activityId',
      'activityVersion',
      'interactiveId',
      'publicationId',
    ],
    ENTER_TASK: ['id', 'revision', 'dispatchId'],
    PRESENT_LECTURE_PAGE: ['id', 'revision', 'dispatchId', 'presentationRevision', 'page'],
  };
  requireAcademic(typeof x.type === 'string' && Object.hasOwn(fields, x.type));
  requireAcademic(Object.keys(x).sort().join() === ['type', ...fields[x.type]].sort().join());
  if (['CREATE_CLASSROOM', 'EDIT_CLASSROOM', 'RESCHEDULE_CLASSROOM'].includes(x.type)) {
    const time = (n: unknown) => {
      requireAcademic(
        n === null ||
          (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000),
      );
      return n as number | null;
    };
    const opensAt = time(x.opensAt),
      closesAt = time(x.closesAt);
    requireAcademic(opensAt === null || closesAt === null || opensAt < closesAt);
    if (x.type === 'RESCHEDULE_CLASSROOM')
      return {
        type: x.type,
        id: academicId(x.id),
        revision: academicRevision(x.revision),
        opensAt,
        closesAt,
      };
    if (x.type === 'CREATE_CLASSROOM')
      return {
        type: x.type,
        title: academicText(x.title),
        description: academicText(x.description, 1000, true),
        opensAt,
        closesAt,
      };
    return {
      type: 'EDIT_CLASSROOM',
      id: academicId(x.id),
      revision: academicRevision(x.revision),
      title: academicText(x.title),
      description: academicText(x.description, 1000, true),
      opensAt,
      closesAt,
    };
  }
  const id = academicId(x.id),
    revision = academicRevision(x.revision);
  if (x.type === 'DISPATCH_JOINT_TASK')
    return {
      type: x.type,
      id,
      revision,
      activityId: academicId(x.activityId),
      activityVersion: academicRevision(x.activityVersion),
      interactiveId: academicId(x.interactiveId),
      publicationId: academicId(x.publicationId),
    };
  if (x.type === 'DISPATCH_TASK') {
    requireAcademic(x.kind === 'LECTURE' || x.kind === 'ACTIVITY');
    return {
      type: x.type,
      id,
      revision,
      kind: x.kind,
      target: academicId(x.target),
      version: academicRevision(x.version),
    };
  }
  if (x.type === 'PRESENT_LECTURE_PAGE') {
    requireAcademic(
      typeof x.page === 'number' && Number.isInteger(x.page) && x.page >= 1 && x.page <= 32,
    );
    return {
      type: x.type,
      id,
      revision,
      dispatchId: academicId(x.dispatchId),
      presentationRevision: academicRevision(x.presentationRevision),
      page: x.page,
    };
  }
  if (x.type === 'ENTER_TASK')
    return { type: x.type, id, revision, dispatchId: academicId(x.dispatchId) };
  return { type: x.type as 'PUBLISH_CLASSROOM' | 'END_CLASSROOM' | 'END_TASK', id, revision };
}
export interface ClassroomLecture {
  id: string;
  title: string;
  state: string;
  quarantined?: boolean;
  interactive?: boolean;
  publication?: { id?: string; publication_no: number; page_count?: number } | null;
}
