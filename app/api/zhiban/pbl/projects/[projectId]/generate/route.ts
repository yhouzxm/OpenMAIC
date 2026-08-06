import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { generateOpenMaicPblContent, getManagedPblProject, saveGeneratedPblPackage } from '@/lib/zhiban/pbl';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const body = await request.json().catch(() => ({}));
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied');
    const { projectId } = await context.params;
    const definition = await getManagedPblProject(getZhibanPool(), principal, projectId);
    const resolved = await resolveModelFromRequest(request, body, 'scene-content');
    const content = await generateOpenMaicPblContent({ definition, context: { languageDirective: '使用简体中文，保留必要的英文技术术语。', targetLanguage: 'zh-CN' }, model: resolved.model, thinkingConfig: resolved.thinkingConfig });
    const project = await saveGeneratedPblPackage(getZhibanPool(), principal, projectId, content);
    return NextResponse.json({ project });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to generate PBL project' }, { status: 400 }); }
}
