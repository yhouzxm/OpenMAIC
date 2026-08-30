import { createZhibanHealthHandler } from '@/lib/zhiban/health/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = createZhibanHealthHandler();
