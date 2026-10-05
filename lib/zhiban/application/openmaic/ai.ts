export interface DraftTextInput {
  readonly requestId: string;
  readonly purpose: 'AUTHORING_DRAFT_TEXT';
  readonly brief: string;
}
export type DraftTextResult =
  | Readonly<{ status: 'DENIED' }>
  | Readonly<{
      status: 'FAILED';
      reason: 'INVALID_INPUT' | 'BUDGET_EXCEEDED' | 'CANCELLED' | 'PROVIDER_FAILURE';
    }>
  | Readonly<{
      status: 'DRAFT';
      text: string;
      provenance: Readonly<{
        provider: 'FAKE';
        purpose: 'AUTHORING_DRAFT_TEXT';
        inputSchemaVersion: 1;
        outputSchemaVersion: 1;
        promptRevision: 'c9-draft-text-v1';
        policyRevision: 'c9-ai-foundation-v1';
      }>;
    }>;
export interface AIServicePort {
  draft(input: DraftTextInput): Promise<DraftTextResult>;
}
