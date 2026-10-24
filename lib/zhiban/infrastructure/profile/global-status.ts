import type { Pool } from 'pg';
import type { MemberGlobalStatusReader } from '../../application/profile/service';
import { academicId, requireAcademic } from '../../domain/academic/model';
/** Existing auth-role SELECT only. No ACL extension, credentials, reasons or global search. */
export function memberGlobalStatusReader(auth: Pool): MemberGlobalStatusReader {
  return async (ids) => {
    requireAcademic(ids.length <= 50 && new Set(ids).size === ids.length, 'UNAVAILABLE');
    ids.forEach(academicId);
    const states = new Map<string, 'ACTIVE' | 'DISABLED'>();
    if (!ids.length) return { states, asOf: Date.now() };
    const result = await auth.query<{ user_id: string; status: 'ACTIVE' | 'DISABLED'; at: string }>(
      `SELECT user_id,status,floor(extract(epoch FROM statement_timestamp())*1000)::bigint::text AS at
       FROM zhiban_identity.users WHERE user_id=ANY($1::uuid[])`,
      [ids],
    );
    requireAcademic(result.rows.length === ids.length, 'UNAVAILABLE');
    for (const r of result.rows) {
      requireAcademic(
        ids.includes(r.user_id) && ['ACTIVE', 'DISABLED'].includes(r.status),
        'UNAVAILABLE',
      );
      states.set(r.user_id, r.status);
    }
    return { states, asOf: Number(result.rows[0].at) };
  };
}
