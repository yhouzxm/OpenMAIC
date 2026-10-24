// Ordinary composition only. No listener, setup, installer, fixture, worker or migrations.
import { Client, Pool } from 'pg';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '@/lib/zhiban/infrastructure/identity/http/adapter';
import { IdentitySafeQueries } from '@/lib/zhiban/application/identity/use-cases/safe-queries';
import { PostgresAcademicStore } from '@/lib/zhiban/infrastructure/academic/postgres/store';
import { AcademicService } from '@/lib/zhiban/application/academic/service';
import { createAcademicHttp } from '@/lib/zhiban/infrastructure/academic/http';
import { LearningService } from '@/lib/zhiban/application/learning/service';
import { createLearningHttp } from '@/lib/zhiban/infrastructure/learning/http';
import { AssessmentService } from '@/lib/zhiban/application/assessment/service';
import { createAssessmentHttp } from '@/lib/zhiban/infrastructure/assessment/http';
import { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { contentHttp } from '@/lib/zhiban/infrastructure/content/http';
import {
  Argon2PasswordHasher,
  PASSWORD_HASH_POLICY,
} from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import { academicPolicy } from '@/lib/zhiban/domain/academic/model';
import { learningPolicy } from '@/lib/zhiban/domain/learning/model';
import { assessmentPolicy } from '@/lib/zhiban/domain/assessment/model';
export { Client, Pool };
export const policies = {
  academic: academicPolicy,
  learning: learningPolicy,
  assessment: assessmentPolicy,
  password: PASSWORD_HASH_POLICY,
};
export async function nativeSelfCheck() {
  // Local synthetic KDF input only: never an application account/session operation.
  const hashing = new Argon2PasswordHasher(
    new LocalCompromisedPasswordScreening(['passwordpassword']),
  );
  const verifier = await hashing.hash('Local-release-native-self-check-2026');
  if (
    !(await hashing.verify('Local-release-native-self-check-2026', verifier)) ||
    (await hashing.verify('Local-release-native-wrong-input-2026', verifier))
  )
    throw Error('Native KDF self-check rejected');
  return { policy: PASSWORD_HASH_POLICY, verified: true };
}
export async function createProduct(pools: any, identity: any, deploymentId: string) {
  const root = await createIdentityComposition(
    {
      auth: pools.zhiban_auth_runtime,
      tenant: pools.zhiban_runtime,
      control: pools.zhiban_control_runtime,
    },
    identity.composition,
  );
  const identityHttp = createIdentityHttp(
    async () => ({
      security: root.security,
      application: root.application,
      members: root.members,
      queries:
        root.queries ??
        new IdentitySafeQueries({
          passwordState: (h) => root.security.passwordState(h),
          member: async () => {
            throw Error('Closed');
          },
          consentContext: async () => {
            throw Error('Closed');
          },
        }),
    }),
    identity.manifest.policy,
  );
  const store = new PostgresAcademicStore(
    pools.zhiban_academic_runtime,
    pools.zhiban_bridge_runtime,
    pools.zhiban_runtime,
    root.security.bridgeSecurity(),
  );
  return {
    identity: identityHttp,
    academic: createAcademicHttp(
      new AcademicService(store),
      root.security,
      identity.composition.origin,
    ),
    learning: createLearningHttp(
      new LearningService(store),
      root.security,
      identity.composition.origin,
    ),
    assessment: createAssessmentHttp(
      new AssessmentService(store),
      root.security,
      identity.composition.origin,
    ),
    content: contentHttp(
      new ContentService(
        pools.zhiban_bridge_runtime,
        pools.zhiban_openmaic_runtime,
        root.security,
        deploymentId,
      ),
      root.security,
      identity.composition.origin,
    ),
  };
}
