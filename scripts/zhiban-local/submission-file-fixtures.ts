/** Pinned synthetic fixtures only. This is NOT a malware scanner or production clearance. */
import { createHash } from 'node:crypto';
import type { SubmissionFileClearance } from '../../lib/zhiban/application/learning/attachment-assets';
export const fixtureReport = Buffer.from('本地附件巡检记录\n先断电挂牌，再验电并检查接地。\n');
const digests = new Set(
  [
    fixtureReport,
    Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
    Buffer.alloc(1048576, 65),
  ].map((bytes) => createHash('sha256').update(bytes).digest('hex')),
);
export const syntheticSubmissionFileClearance: SubmissionFileClearance = {
  mode: 'LOCAL_SYNTHETIC_PINNED',
  async check(file) {
    const digest = createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex');
    return digests.has(digest)
      ? { mode: 'LOCAL_SYNTHETIC_PINNED', digest, reference: 'local-synthetic-sha256:' + digest }
      : null;
  },
};
