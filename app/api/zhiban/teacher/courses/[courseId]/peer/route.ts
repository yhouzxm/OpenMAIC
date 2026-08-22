import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getTeacherPeerDashboard, savePeerConfig } from '@/lib/zhiban/peer';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

const inputSchema = z.object({ enabled: z.boolean(), displayName: z.string().trim().min(1).max(120), welcomeMessage: z.string().max(4000), systemPrompt: z.string().max(10000), proactiveEnabled: z.boolean(), emotionCheckEnabled: z.boolean(), cooldownMinutes: z.number().int().min(10).max(10080), maxTurns: z.number().int().min(2).max(30), status: z.enum(['draft', 'published', 'disabled']) });
export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) { try { const p=await requireRequestPrincipal(),courseId=z.uuid().parse((await params).courseId);return NextResponse.json(await getTeacherPeerDashboard(getZhibanPool(),p,courseId)); } catch(error){return authorizationErrorResponse(error)??NextResponse.json({error:error instanceof Error?error.message:'Unable to load Peer'},{status:400});} }
export async function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) { try { const p=await requireRequestPrincipal(),courseId=z.uuid().parse((await params).courseId),body=inputSchema.parse(await request.json());return NextResponse.json(await savePeerConfig(getZhibanPool(),p,courseId,body)); } catch(error){return authorizationErrorResponse(error)??NextResponse.json({error:error instanceof Error?error.message:'Unable to save Peer'},{status:400});} }
