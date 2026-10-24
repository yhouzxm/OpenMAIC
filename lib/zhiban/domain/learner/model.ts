import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { discussionText } from '../discussion/model';
import { exact } from '../quiz/model';
export { evidenceDigest } from '../concept/model';
export type EvidenceKind = 'GRADE' | 'CONCEPT' | 'REMEDIATION';
export type EvidenceRef = { kind: EvidenceKind; id: string; digest: string };
export type ObservationText = {
  title: string;
  body: string;
  confidence: 'LIMITED' | 'SUPPORTED';
  evidence: EvidenceRef[];
};
type NoteRef = { id: string; revision: string };
export type LearnerCommand =
  | ({ type: 'CREATE_OBSERVATION'; enrollmentId: string } & ObservationText)
  | ({ type: 'EDIT_DRAFT' | 'REVISE_PUBLIC'; reason: string } & NoteRef & ObservationText)
  | ({ type: 'PUBLISH_OBSERVATION'; expectedDigest: string } & NoteRef)
  | ({ type: 'WITHDRAW_OBSERVATION'; body: string } & NoteRef)
  | ({ type: 'OPEN_DISPUTE'; body: string; desired: string } & NoteRef)
  | ({ type: 'APPEND_DISPUTE'; body: string; desired: string } & NoteRef)
  | ({
      type: 'RESOLVE_DISPUTE';
      noteRevision: string;
      outcome: 'KEEP';
      expectedDigest: string;
      response: string;
    } & NoteRef)
  | ({
      type: 'RESOLVE_DISPUTE';
      noteRevision: string;
      outcome: 'WITHDRAW';
      response: string;
    } & NoteRef)
  | ({
      type: 'RESOLVE_DISPUTE';
      noteRevision: string;
      outcome: 'REVISE';
      response: string;
      replacement: ObservationText;
    } & NoteRef);
export function observationText(v: unknown): ObservationText {
  exact(v, ['title', 'body', 'confidence', 'evidence']);
  requireAcademic(v.confidence === 'LIMITED' || v.confidence === 'SUPPORTED');
  requireAcademic(Array.isArray(v.evidence) && v.evidence.length >= 1 && v.evidence.length <= 5);
  const refs = v.evidence.map((r) => {
    exact(r, ['kind', 'id', 'digest']);
    requireAcademic(['GRADE', 'CONCEPT', 'REMEDIATION'].includes(String(r.kind)));
    requireAcademic(typeof r.digest === 'string' && /^[a-f0-9]{64}$/.test(r.digest));
    return { kind: r.kind as EvidenceKind, id: academicId(r.id), digest: r.digest };
  });
  requireAcademic(new Set(refs.map((r) => r.kind + ':' + r.id)).size === refs.length);
  return {
    title: discussionText(v.title, 120),
    body: discussionText(v.body, 2000),
    confidence: v.confidence,
    evidence: refs,
  };
}
export function learnerCommand(input: unknown): LearnerCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  const shapes: Record<string, string[]> = {
    CREATE_OBSERVATION: ['enrollmentId', 'title', 'body', 'confidence', 'evidence'],
    EDIT_DRAFT: ['id', 'revision', 'reason', 'title', 'body', 'confidence', 'evidence'],
    REVISE_PUBLIC: ['id', 'revision', 'reason', 'title', 'body', 'confidence', 'evidence'],
    PUBLISH_OBSERVATION: ['id', 'revision', 'expectedDigest'],
    WITHDRAW_OBSERVATION: ['id', 'revision', 'body'],
    OPEN_DISPUTE: ['id', 'revision', 'body', 'desired'],
    APPEND_DISPUTE: ['id', 'revision', 'body', 'desired'],
    RESOLVE_DISPUTE: [
      'id',
      'revision',
      'noteRevision',
      'outcome',
      'response',
      ...(v.outcome === 'KEEP'
        ? ['expectedDigest']
        : v.outcome === 'REVISE'
          ? ['replacement']
          : []),
    ],
  };
  requireAcademic(Object.hasOwn(shapes, String(v.type)));
  exact(v, ['type', ...shapes[String(v.type)]]);
  if ('id' in v) {
    academicId(v.id);
    academicRevision(v.revision);
  }
  if ('enrollmentId' in v) academicId(v.enrollmentId);
  if ('noteRevision' in v) academicRevision(v.noteRevision);
  if ('expectedDigest' in v)
    requireAcademic(
      typeof v.expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(v.expectedDigest),
    );
  if (v.type === 'RESOLVE_DISPUTE')
    requireAcademic(['KEEP', 'REVISE', 'WITHDRAW'].includes(String(v.outcome)));
  if ('confidence' in v)
    Object.assign(
      v,
      observationText({
        title: v.title,
        body: v.body,
        confidence: v.confidence,
        evidence: v.evidence,
      }),
    );
  else if ('body' in v) v.body = discussionText(v.body, 2000);
  for (const k of ['reason', 'desired', 'response'])
    if (k in v) v[k] = discussionText(v[k], k === 'reason' ? 1000 : 2000);
  if ('replacement' in v) v.replacement = observationText(v.replacement);
  return v as unknown as LearnerCommand;
}
