import type { LanguageModel } from 'ai';
import { generatePBLV2Project, type PlannerV2Callbacks } from '@/lib/pbl/v2/agents/planner';
import { generatePBLV2ProjectSingleCall } from '@/lib/pbl/v2/agents/planner-single-call';
import { projectV2ToLegacyProjectConfig } from '@/lib/pbl/v2/compat';
import type { PBLPlannerV2Input, PBLProjectV2 } from '@/lib/pbl/v2/types';
import type { GeneratedPBLContent, SceneOutline } from '@/lib/types/generation';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { ZhibanPblDefinitionInput, ZhibanPblGenerationContext } from './types';

/**
 * Anti-corruption layer between PostgreSQL course configuration and OpenMAIC's
 * existing PBL v2 planner. Zhiban owns identity/lifecycle; OpenMAIC owns the
 * project package, learning state machine, Instructor, submissions and evals.
 */
export function buildOpenMaicPblPlannerInput(
  definition: ZhibanPblDefinitionInput,
  context: ZhibanPblGenerationContext = {},
): PBLPlannerV2Input {
  const outline: SceneOutline = {
    id: definition.id,
    type: 'pbl',
    title: definition.title,
    description: definition.description,
    teachingObjective: definition.learningObjective,
    keyPoints: definition.targetSkills,
    order: 0,
    pblConfig: {
      projectTopic: definition.title,
      projectDescription: [definition.description, definition.deliverable ? `成果要求：${definition.deliverable}` : '']
        .filter(Boolean).join('\n'),
      targetSkills: definition.targetSkills,
      issueCount: Math.max(2, Math.min(8, definition.targetSkills.length || 3)),
      scenarioRoleplay: definition.scenarioRoleplay,
      scenarioBrief: definition.scenarioRoleplay ? definition.scenarioBrief : undefined,
    },
  };
  return {
    outline,
    courseContext: {
      allOutlines: [outline],
      languageDirective: context.languageDirective?.trim() || '使用简体中文，保留必要的英文技术术语。',
    },
    user: context.learner,
    targetLanguage: context.targetLanguage ?? 'zh-CN',
  };
}

export async function generateOpenMaicPblContent(args: {
  definition: ZhibanPblDefinitionInput;
  context?: ZhibanPblGenerationContext;
  model: LanguageModel;
  thinkingConfig?: ThinkingConfig;
  callbacks?: PlannerV2Callbacks;
}): Promise<GeneratedPBLContent> {
  const input = buildOpenMaicPblPlannerInput(args.definition, args.context);
  let project: PBLProjectV2;
  try {
    project = await generatePBLV2ProjectSingleCall(input, args.model, args.callbacks, args.thinkingConfig);
  } catch {
    project = await generatePBLV2Project(input, args.model, args.callbacks, args.thinkingConfig);
  }
  return { projectConfig: projectV2ToLegacyProjectConfig(project), projectV2: project };
}
