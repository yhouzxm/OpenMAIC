import { identityHttp } from '@/lib/zhiban/infrastructure/identity/http/root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = identityHttp;
export const POST = identityHttp;
export const PUT = identityHttp;
export const PATCH = identityHttp;
export const DELETE = identityHttp;
export const HEAD = identityHttp;
export const OPTIONS = identityHttp;
