export interface ZhibanPblDefinitionInput {
  id: string;
  courseId: string;
  code: string;
  title: string;
  description: string;
  learningObjective: string;
  targetSkills: string[];
  deliverable: string;
  scenarioRoleplay: boolean;
  scenarioBrief: string;
}

export interface ZhibanPblGenerationContext {
  languageDirective?: string;
  targetLanguage?: string;
  learner?: { nickname?: string; bio?: string; requirement?: string };
}

export interface ZhibanPblProject extends ZhibanPblDefinitionInput {
  opensAt: string | null;
  closesAt: string | null;
  status: 'draft' | 'published' | 'archived';
  packageVersion: number;
  openmaicPackage: import('@/lib/types/generation').GeneratedPBLContent | null;
  templateId?: string | null;
  rubricId?: string | null;
  gradeItemId?: string | null;
}

export interface ZhibanPblProjectInput extends Omit<ZhibanPblDefinitionInput, 'id'> {
  opensAt: string | null;
  closesAt: string | null;
  status: 'draft' | 'published';
}

export interface ZhibanPblInstance {
  id: string;
  projectId: string;
  projectTitle: string;
  courseId: string;
  courseName: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'withdrawn';
  progressPercent: number;
  packageVersion: number;
  projectState: import('@/lib/pbl/v2/types').PBLProjectV2;
  lastActivityAt: string | null;
  group?: { id: string; name: string; role: 'leader' | 'member' | 'recorder' | 'presenter'; members: Array<{ name: string; role: string }> } | null;
  submissionReviews?: Array<{ id: string; microtaskId: string; version: number; status: string; feedback: string; submittedAt: string }>;
}

export interface StudentPblProjectSummary {
  id: string; title: string; description: string; deliverable: string; packageVersion: number;
  courseId: string; courseName: string; instanceId: string | null;
  instanceStatus: string | null; progressPercent: number; lastActivityAt: string | null;
}
