import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listStudentGrades } from '@/lib/zhiban/grades';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime='nodejs';
export async function GET(){try{const principal=await requireRequestPermission('grade:read');return NextResponse.json(await listStudentGrades(getZhibanPool(),principal));}catch(error){return authorizationErrorResponse(error)??NextResponse.json({error:error instanceof Error?error.message:'Unable to load grades'},{status:400});}}
