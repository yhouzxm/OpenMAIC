import { v7 } from 'uuid';
import { check, newPrincipal, uuid } from './validation';
export interface CandidateIntention {
  readonly generationId: string;
  readonly stageRef: string;
  readonly ownerHandle: string;
}
const issued = new WeakSet<object>();
/** Server-only intention allocated before content hashing/locks; copies cannot reserve it. */
export function planCandidate(): CandidateIntention {
  const value = Object.freeze({
    generationId: uuid(v7()),
    stageRef: uuid(v7()),
    ownerHandle: newPrincipal(),
  });
  issued.add(value);
  return value;
}
export function consumeCandidate(value: CandidateIntention) {
  check(issued.has(value));
  issued.delete(value);
  return value;
}
