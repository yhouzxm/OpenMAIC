import { createHash } from 'node:crypto';
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
import { exact, canonical } from '../quiz/model';
export type ConceptText = { concept: string; explanation: string; guidance: string };
export type ConceptCommand =
  | ({
      type: 'CREATE_CORRECTION';
      publicationId: string;
      questionId: string;
      expectedDigest: string;
      privateNote: string;
    } & ConceptText)
  | ({
      type: 'EDIT_DRAFT' | 'REVISE_FEEDBACK';
      id: string;
      revision: string;
      expectedDigest: string;
      privateNote: string;
      reason: string;
    } & ConceptText)
  | { type: 'PUBLISH_CORRECTION'; id: string; revision: string; expectedDigest: string }
  | { type: 'RESPOND'; id: string; revision: string; body: string }
  | {
      type: 'ASSESS';
      id: string;
      revision: string;
      expectedDigest: string;
      responseRevision: string;
      outcome: 'RESOLVED' | 'NEEDS_MORE';
      body: string;
      privateNote: string;
    }
  | { type: 'RETRACT'; id: string; revision: string; body: string; privateNote: string };
export const evidenceDigest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function conceptCommand(input: unknown): ConceptCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    CREATE_CORRECTION: [
      'publicationId',
      'questionId',
      'expectedDigest',
      'concept',
      'explanation',
      'guidance',
      'privateNote',
    ],
    EDIT_DRAFT: [
      'id',
      'revision',
      'expectedDigest',
      'concept',
      'explanation',
      'guidance',
      'privateNote',
      'reason',
    ],
    REVISE_FEEDBACK: [
      'id',
      'revision',
      'expectedDigest',
      'concept',
      'explanation',
      'guidance',
      'privateNote',
      'reason',
    ],
    PUBLISH_CORRECTION: ['id', 'revision', 'expectedDigest'],
    RESPOND: ['id', 'revision', 'body'],
    ASSESS: [
      'id',
      'revision',
      'expectedDigest',
      'responseRevision',
      'outcome',
      'body',
      'privateNote',
    ],
    RETRACT: ['id', 'revision', 'body', 'privateNote'],
  };
  requireAcademic(Object.hasOwn(shapes, String(v.type)));
  exact(v, ['type', ...shapes[String(v.type)]]);
  if ('id' in v) {
    academicId(v.id);
    academicRevision(v.revision);
  }
  if ('publicationId' in v) {
    academicId(v.publicationId);
    requireAcademic(
      typeof v.questionId === 'string' &&
        v.questionId.length <= 100 &&
        v.questionId.isWellFormed() &&
        !/[\u0000-\u001f\u007f]/.test(v.questionId),
    );
  }
  if ('expectedDigest' in v)
    requireAcademic(
      typeof v.expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(v.expectedDigest),
    );
  for (const [k, max] of Object.entries({
    concept: 120,
    explanation: 2000,
    guidance: 2000,
    privateNote: 2000,
    reason: 1000,
    body: 2000,
  }))
    if (k in v) v[k] = discussionText(v[k], max);
  if ('outcome' in v) {
    requireAcademic(v.outcome === 'RESOLVED' || v.outcome === 'NEEDS_MORE');
    academicRevision(v.responseRevision);
  }
  return v as unknown as ConceptCommand;
}
