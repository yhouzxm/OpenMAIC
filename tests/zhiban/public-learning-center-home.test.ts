import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const homeSource = readFileSync(resolve(process.cwd(), 'app/page.tsx'), 'utf8');
const publicHomeSource = readFileSync(
  resolve(process.cwd(), 'components/zhiban/public-learning-center-home.tsx'),
  'utf8',
);
const accessGuardSource = readFileSync(
  resolve(process.cwd(), 'components/access-code-guard.tsx'),
  'utf8',
);
const learningCenterSource = readFileSync(
  resolve(process.cwd(), 'components/zhiban/learning-center.tsx'),
  'utf8',
);
const rootLayoutSource = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

describe('public competition learning-center home', () => {
  it('uses the public learning-center presentation as the default root page', () => {
    expect(homeSource).toContain('<PublicLearningCenterHome />');
    expect(homeSource).toContain("NEXT_PUBLIC_ZHIBAN_COMPETITION_HOME !== 'false'");
  });

  it('links the visible login actions to the existing Zhiban login route', () => {
    expect(publicHomeSource).toContain('href="/zhiban/login"');
    expect(publicHomeSource).toContain('登录');
  });

  it('uses the exact authenticated learning-center body instead of a duplicate presentation', () => {
    expect(publicHomeSource).toContain(
      '<LearningCenter courseId="mech-mechatronics-system" publicMode />',
    );
    expect(learningCenterSource).toContain('publicMode?: boolean');
  });

  it('requires login before any public station navigation', () => {
    expect(learningCenterSource).toContain(
      "const targetPath = publicMode ? '/zhiban/login' : `${basePath}/${station.id}`",
    );
    expect(learningCenterSource).toContain(
      "publicMode\n                            ? '/zhiban/login'",
    );
  });

  it('allows the public competition home through the legacy access-code guard', () => {
    expect(accessGuardSource).toContain('isPublicCompetitionHome');
    expect(accessGuardSource).toContain('!isPublicCompetitionHome');
  });

  it('uses the Zhiban brand in the browser tab', () => {
    expect(rootLayoutSource).toContain("title: '智伴·创学'");
    expect(rootLayoutSource).not.toContain("title: 'OpenMAIC'");
  });

  it('keeps a straight global bar and a consistent rounded content hierarchy', () => {
    expect(publicHomeSource).toContain('sticky top-0 z-40 flex h-[52px]');
    expect(publicHomeSource).not.toContain('header className="rounded');
    expect(learningCenterSource).toContain('max-w-[1580px] space-y-5 px-3 py-4');
    expect(learningCenterSource).toContain('overflow-hidden rounded-2xl');
    expect(learningCenterSource).toContain('relative rounded-xl border p-4');
  });
});
