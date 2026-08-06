import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { createProjectFromTemplate, listPblTemplates } from '@/lib/zhiban/pbl';
async function teacher() { const principal = await requireRequestPrincipal(); if (!principal.permissions.includes('course:manage')) throw new AuthorizationError('Permission denied'); return principal; }
export async function GET() { try { const principal = await teacher(); return NextResponse.json({ templates: await listPblTemplates(getZhibanPool(), principal) }); } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load templates' }, { status: 400 }); } }
export async function POST(request: NextRequest) { try { const parsed = z.object({ templateId: z.uuid(), courseId: z.uuid(), code: z.string().min(1).max(80) }).safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: 'Invalid template request' }, { status: 400 }); const principal = await teacher(); return NextResponse.json({ project: await createProjectFromTemplate(getZhibanPool(), principal, parsed.data.templateId, parsed.data.courseId, parsed.data.code) }, { status: 201 }); } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to use template' }, { status: 400 }); } }
