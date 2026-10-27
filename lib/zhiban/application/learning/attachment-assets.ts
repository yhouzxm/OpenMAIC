import type { SubmissionAttachment } from '../../domain/learning/attachment';
export interface FileClearanceEvidence {
  mode: 'LOCAL_SYNTHETIC_PINNED' | 'TRUSTED_SCANNER';
  digest: string;
  reference: string;
}
export interface SubmissionFileClearance {
  readonly mode: 'LOCAL_SYNTHETIC_PINNED' | 'TRUSTED_SCANNER';
  check(attachment: SubmissionAttachment): Promise<FileClearanceEvidence | null>;
  /** Separate teacher archive profile; does not enlarge formal submission limits. */
  checkArchive?(attachment: SubmissionAttachment): Promise<FileClearanceEvidence | null>;
}
export interface SubmissionFileAssetPort {
  read(tenant: string, submission: string, file?: string): Promise<Record<string, unknown>[]>;
  append(
    scope: {
      tenant: string;
      offering: string;
      member: string;
      attempt: string;
      submission: string;
      now: number;
      status: string;
      allowResubmit: boolean;
      deadline: number | null;
    },
    file: SubmissionAttachment,
    clearance?: FileClearanceEvidence,
  ): Promise<void>;
}
