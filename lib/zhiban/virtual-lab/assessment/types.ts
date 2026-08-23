import type { TrainingContext } from '../ai/types';

export type AssessmentDimensionKey =
  | 'diagnosisAccuracy'
  | 'procedureQuality'
  | 'evidenceReasoning'
  | 'independence'
  | 'verification';

export interface AssessmentDimension {
  score: number;
  maxScore: number;
  reason: string;
}

export type ErrorPattern =
  | 'BLIND_GUESS'
  | 'SKIP_PLC_INSPECTION'
  | 'SKIP_POWER_MEASUREMENT'
  | 'SKIP_OUTPUT_MEASUREMENT'
  | 'REPEATED_RESTART'
  | 'OVER_RELIANCE_ON_HINTS'
  | 'INSUFFICIENT_VERIFICATION'
  | 'REPEATED_IRRELEVANT_INSPECTION';

export type StrengthPattern =
  | 'SYSTEMATIC_DIAGNOSIS'
  | 'EVIDENCE_BASED_REASONING'
  | 'INDEPENDENT_COMPLETION'
  | 'EFFICIENT_TROUBLESHOOTING'
  | 'COMPLETE_VERIFICATION';

export interface WeakPoint {
  code: string;
  knowledgePoint: string;
  chapter: string;
  capability: string;
  reason: string;
}

export interface RecommendedContent {
  knowledgePoint: string;
  chapter: string;
  reason: string;
  recommendationType: 'review' | 'practice' | 'retry';
  title: string;
  priority: 'high' | 'medium' | 'low';
  chapterId?: string;
}

export interface AttemptSummary {
  attemptNumber: number;
  overallScore: number;
  durationSeconds: number;
  wrongActions: number;
  hintsUsed: number;
}

export interface VirtualLabAssessment {
  overallScore: number;
  dimensions: Record<AssessmentDimensionKey, AssessmentDimension>;
  durationSeconds: number;
  actionsCount: number;
  wrongActions: string[];
  hintsUsed: number;
  diagnosisAttempts: string[];
  keyEvidenceCollected: string[];
  errorPatterns: ErrorPattern[];
  strengthPatterns: StrengthPattern[];
  weakPoints: WeakPoint[];
  recommendedContent: RecommendedContent[];
  aiFeedback?: AssessmentFeedback;
  attemptNumber: number;
  previousAttemptSummary?: AttemptSummary;
}

export interface AssessmentFeedback {
  summary: string;
  strengths: string[];
  improvements: string[];
  nextStep: string;
  fallback: boolean;
  notice?: string;
}

export interface AssessmentInput {
  trainingContext: TrainingContext;
  attemptNumber: number;
  durationSeconds?: number;
  previousAttemptSummary?: AttemptSummary;
}
