export type PeerEmotion = 'neutral' | 'difficulty' | 'low_mood' | 'lonely' | 'crisis';
export interface CoursePeerConfig {
  enabled: boolean; displayName: string; welcomeMessage: string; systemPrompt: string;
  proactiveEnabled: boolean; emotionCheckEnabled: boolean; cooldownMinutes: number;
  maxTurns: number; status: 'draft' | 'published' | 'disabled'; version: number;
}
export interface CoursePeerMessage {
  id: string; role: 'user' | 'assistant'; content: string; emotion: PeerEmotion;
  riskLevel: 'none' | 'low' | 'high'; status: 'completed' | 'blocked' | 'failed';
  safetyCategory: string | null; createdAt: string;
}
