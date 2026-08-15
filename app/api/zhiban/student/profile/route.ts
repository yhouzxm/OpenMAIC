import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.union([z.literal(''), z.email().max(320)]).default(''),
  qq: optionalText(32),
  wechat: optionalText(100),
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
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const profile = await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT a.display_name,a.login_name,a.mobile_last4,
                COALESCE(learning_center.name,primary_org.name,p.learning_center,t.name) AS tenant_name,
                p.student_no,p.real_name,p.enrollment_year,p.education_level,p.major_code,
                p.major_name,p.learning_center,p.study_status,p.extension
         FROM zhiban.accounts a
         JOIN zhiban.tenants t ON t.id=a.tenant_id
         JOIN zhiban.student_profiles p ON p.account_id=a.id AND p.tenant_id=a.tenant_id
         LEFT JOIN zhiban.organization_units learning_center ON learning_center.id=p.learning_center_organization_id
         LEFT JOIN zhiban.organization_units primary_org ON primary_org.id=a.primary_organization_id
         WHERE a.id=$1`,
        [principal.id],
      );
      return result.rows[0];
    });
    if (!profile) return NextResponse.json({ error: 'Student profile not found' }, { status: 404 });
    const extension = (profile.extension ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      profile: {
        displayName: profile.display_name,
        loginName: profile.login_name,
        studentNo: profile.student_no,
        enrollmentYear: profile.enrollment_year ?? '',
        educationLevel: profile.education_level ?? '',
        majorCode: profile.major_code ?? '',
        majorName: profile.major_name ?? '',
        learningCenter: profile.learning_center ?? '',
        studyStatus: profile.study_status,
        tenantName: profile.tenant_name,
        mobileMasked: profile.mobile_last4 ? `********${profile.mobile_last4}` : '',
        email: extension.email ?? '',
        qq: extension.qq ?? '',
        wechat: extension.wechat ?? '',
        bio: extension.bio ?? '',
        avatarDataUrl: extension.avatarDataUrl ?? '',
      },
    });
  } catch (error) {
    console.error('[ZhibanStudentProfile] Load failed', error);
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load student profile' }, { status: 500 })
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await requireRequestPrincipal();
    if (principal.accountType !== 'student')
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const parsed = profileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '个人信息无效' },
        { status: 400 },
      );
    await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) => {
      await client.query(
        `UPDATE zhiban.accounts SET display_name=$2,updated_at=now() WHERE id=$1`,
        [principal.id, parsed.data.displayName],
      );
      await client.query(
        `UPDATE zhiban.student_profiles
         SET real_name=$2,extension=COALESCE(extension,'{}'::jsonb)||$3::jsonb,updated_at=now()
         WHERE account_id=$1`,
        [
          principal.id,
          parsed.data.displayName,
          JSON.stringify({
            email: parsed.data.email,
            qq: parsed.data.qq,
            wechat: parsed.data.wechat,
            bio: parsed.data.bio,
            avatarDataUrl: parsed.data.avatarDataUrl,
          }),
        ],
      );
      await client.query(
        `INSERT INTO zhiban.audit_log
         (tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata)
         VALUES($1::uuid,'account',$2::uuid,'student.profile_updated','student_profile',$2::text,'{}'::jsonb)`,
        [principal.tenantId, principal.id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ZhibanStudentProfile] Update failed', error);
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to update student profile' }, { status: 500 })
    );
  }
}
