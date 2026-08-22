import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { createScopedAccessToken } from '@/lib/server/access-token';
import { requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  readOpenMaicActivityDocument,
  saveOpenMaicActivityDocument,
} from '@/lib/zhiban/openmaic-activity';

const log = createLogger('Classroom API');

function canPersistClassroom(principal: Awaited<ReturnType<typeof requireRequestPrincipal>>) {
  return (
    principal.permissions.includes('course:manage') ||
    principal.grants.some(
      (grant) =>
        grant.permission === 'course:manage' &&
        (grant.scopeType === 'course' || grant.scopeType === 'tenant' || grant.scopeType === 'system'),
    )
  );
}
function canReadClassroom(principal: Awaited<ReturnType<typeof requireRequestPrincipal>>) {
  return principal.permissions.includes('course:read') || principal.grants.some((grant) => grant.permission === 'course:read' || grant.permission === 'course:manage');
}

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes, documentState } = body;
    const principal = await requireRequestPrincipal();
    if (!canPersistClassroom(principal)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Permission denied');
    }
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const activitySaved = await saveOpenMaicActivityDocument(
      getZhibanPool(),
      principal,
      id,
      { ...stage, id },
      scenes,
      documentState ?? {},
    );
    if (activitySaved) {
      return apiSuccess({ id, url: `/classroom/${id}`, revision: activitySaved.revision }, 201);
    }

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes, documentState, tenantId: principal.tenantId, actorId: principal.id }, baseUrl);

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const principal = await requireRequestPrincipal();
    if (!canReadClassroom(principal)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Permission denied');
    }
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const activityDocument = await readOpenMaicActivityDocument(getZhibanPool(), principal, id);
    const classroom = activityDocument
      ? {
          id: String(activityDocument.document_id),
          stage: activityDocument.stage,
          scenes: activityDocument.scenes,
          documentState: activityDocument.document_state,
          revision: Number(activityDocument.revision),
          createdAt: new Date(String(activityDocument.created_at)).toISOString(),
        }
      : await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    const response = apiSuccess({ classroom });
    const accessCode = process.env.ACCESS_CODE;
    if (activityDocument && accessCode) {
      response.cookies.set('zhiban_openmaic_access', createScopedAccessToken(accessCode, 'activity-agent'), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 2,
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return response;
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
