import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  department: optionalText(200),
  professionalTitle: optionalText(100),
  email: z.union([z.literal(''), z.email().max(320)]).default(''),
  qq: optionalText(32),
  wechat: optionalText(100),
  weibo: optionalText(200),
  bio: optionalText(2000),
  avatarDataUrl: z
    .string()
    .max(1_500_000)
    .refine(
      (value) => !value || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value),
      '头像必须是 PNG、JPEG、WebP 或 GIF 图片',
    )
    .default(''),
});

export async function GET() {
  try {
    const principal = await requireRequestPrincipal();
    if (principal.accountType !== 'teacher') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const profile = await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT a.display_name,a.login_name,a.mobile_last4,t.name AS tenant_name,
                p.employee_no,p.real_name,p.department,p.professional_title,p.employment_status,p.extension
         FROM zhiban.accounts a
         JOIN zhiban.tenants t ON t.id=a.tenant_id
         JOIN zhiban.teacher_profiles p ON p.account_id=a.id AND p.tenant_id=a.tenant_id
         WHERE a.id=$1`,
        [principal.id],
      );
      return result.rows[0];
    });
    if (!profile) return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 });
    const extension = (profile.extension ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      profile: {
        displayName: profile.display_name,
        loginName: profile.login_name,
        employeeNo: profile.employee_no,
        department: profile.department ?? '',
        professionalTitle: profile.professional_title ?? '',
        employmentStatus: profile.employment_status,
        tenantName: profile.tenant_name,
        mobileMasked: profile.mobile_last4 ? `********${profile.mobile_last4}` : '',
        email: extension.email ?? '',
        qq: extension.qq ?? '',
        wechat: extension.wechat ?? '',
        weibo: extension.weibo ?? '',
        bio: extension.bio ?? '',
        avatarDataUrl: extension.avatarDataUrl ?? '',
      },
    });
  } catch (error) {
    console.error('[ZhibanTeacherProfile] Load failed', error);
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load teacher profile' }, { status: 500 })
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireRequestPrincipal();
    if (principal.accountType !== 'teacher') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const parsed = profileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '个人信息无效' },
        { status: 400 },
      );
    }
    await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) => {
      await client.query(
        `UPDATE zhiban.accounts SET display_name=$2,updated_at=now() WHERE id=$1`,
        [principal.id, parsed.data.displayName],
      );
      const extension = {
        email: parsed.data.email,
        qq: parsed.data.qq,
        wechat: parsed.data.wechat,
        weibo: parsed.data.weibo,
        bio: parsed.data.bio,
        avatarDataUrl: parsed.data.avatarDataUrl,
      };
      await client.query(
        `UPDATE zhiban.teacher_profiles
           SET real_name=$2,department=NULLIF($3,''),professional_title=NULLIF($4,''),
               extension=COALESCE(extension,'{}'::jsonb)||$5::jsonb,updated_at=now()
           WHERE account_id=$1`,
        [
          principal.id,
          parsed.data.displayName,
          parsed.data.department,
          parsed.data.professionalTitle,
          JSON.stringify(extension),
        ],
      );
      await client.query(
        `INSERT INTO zhiban.audit_log
           (tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata)
           VALUES($1::uuid,'account',$2::uuid,'teacher.profile_updated','teacher_profile',$2::text,'{}'::jsonb)`,
        [principal.tenantId, principal.id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ZhibanTeacherProfile] Update failed', error);
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to update teacher profile' }, { status: 500 })
    );
  }
}
