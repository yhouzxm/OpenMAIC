import { failure, requestId } from '@/lib/zhiban/infrastructure/identity/http/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const denied = () => failure(requestId(), 404, 'NOT_FOUND');
export const GET = denied;
export const POST = denied;
export const PUT = denied;
export const PATCH = denied;
export const DELETE = denied;
export const HEAD = denied;
export const OPTIONS = denied;
