import { readProfileReference } from './pg-version';
/** v1.3.0 expected combined profile is constructed in an independent fresh cluster. */
export const autoContentReference =
  'docs/v2/evidence/zhiban-autograde-content-reference-local.json';
export const autoContentBase = 'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json';
export async function expectedAutoContent() {
  return (await readProfileReference(autoContentReference)).fingerprint;
}
