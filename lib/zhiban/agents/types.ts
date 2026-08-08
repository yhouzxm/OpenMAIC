import type { GeneratedAgentConfig } from '@/lib/types/stage';

export type ZhibanAgentRole = 'tutor' | 'peer' | 'monitor';
export type InterventionTarget = Exclude<ZhibanAgentRole, 'monitor'> | 'teacher';

export interface CourseAgentRuntime {
  courseId: string;
  promptVersion: string;
  agents: GeneratedAgentConfig[];
}

export interface InterventionBrief {
  id: string;
  courseId: string;
  targetRole: InterventionTarget;
  level: InterventionTarget;
  objective: string;
  tone: string;
  evidenceSummary: Record<string, unknown>;
  prohibitedContent: string[];
  maxTurns: number;
  policyVersion: string;
  promptVersion: string;
  status: 'pending' | 'accepted' | 'running' | 'dismissed' | 'delivered' | 'failed' | 'escalated' | 'resolved' | 'expired';
  createdAt: string;
  expiresAt: string;
}
