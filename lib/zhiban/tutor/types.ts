export interface CourseTutorConfig {
  enabled: boolean;
  displayName: string;
  welcomeMessage: string;
  systemPrompt: string;
  retrievalTopK: number;
  citationRequired: boolean;
  answerScope: 'course_only' | 'course_first';
  maxHistoryMessages: number;
  status: 'draft' | 'published' | 'disabled';
  version: number;
  autoSync: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'succeeded' | 'failed';
  lastSyncError: string | null;
}

export interface CourseTutorCitation {
  documentId: string;
  title: string;
  sourceType: string;
  sourceId: string;
  excerpt: string;
}

export interface CourseTutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: CourseTutorCitation[];
  status: 'completed' | 'blocked' | 'failed';
  createdAt: string;
  safetyCategory?: string | null;
}
