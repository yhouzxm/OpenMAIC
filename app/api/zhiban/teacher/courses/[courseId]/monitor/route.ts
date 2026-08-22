import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getMonitorDashboard,saveMonitorPolicy } from '@/lib/zhiban/monitor';
import { authorizationErrorResponse,requireRequestScopedPermission } from '@/lib/zhiban/rbac';
const schema=z.object({enabled:z.boolean(),mode:z.enum(['shadow','active','paused']),tutorThreshold:z.number().min(0).max(100),peerThreshold:z.number().min(0).max(100),teacherThreshold:z.number().min(0).max(100),cooldownMinutes:z.number().int().min(1).max(10080),dailyLimit:z.number().int().min(1).max(20),followupHours:z.number().int().min(1).max(720),policyVersion:z.string().trim().min(1).max(80)});
async function context(courseId:string){const id=z.uuid().parse(courseId);return {id,principal:await requireRequestScopedPermission('course:manage',{courseIds:[id]})};}
export async function GET(_:NextRequest,{params}:{params:Promise<{courseId:string}>}){try{const {id,principal}=await context((await params).courseId);return NextResponse.json(await getMonitorDashboard(getZhibanPool(),principal,id));}catch(error){return authorizationErrorResponse(error)??NextResponse.json({error:error instanceof Error?error.message:'Unable to load Monitor'},{status:400});}}
export async function PUT(request:NextRequest,{params}:{params:Promise<{courseId:string}>}){try{const {id,principal}=await context((await params).courseId);return NextResponse.json(await saveMonitorPolicy(getZhibanPool(),principal,id,schema.parse(await request.json())));}catch(error){return authorizationErrorResponse(error)??NextResponse.json({error:error instanceof Error?error.message:'Unable to save Monitor'},{status:400});}}
