import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { verifyAccessToken, verifyScopedAccessToken } from '@/lib/server/access-token';

export async function GET() {
  const accessCode = process.env.ACCESS_CODE;
  const enabled = !!accessCode;

  let authenticated = false;
  if (enabled) {
    const cookieStore = await cookies();
    const token = cookieStore.get('openmaic_access')?.value;
    const scopedToken = cookieStore.get('zhiban_openmaic_access')?.value;
    authenticated =
      (!!token && verifyAccessToken(token, accessCode)) ||
      (!!scopedToken && verifyScopedAccessToken(scopedToken, accessCode, 'activity-agent'));
  }

  return apiSuccess({ enabled, authenticated });
}
