/** Keep legacy gateway restrictions; only the new read-only directory/management queries accepts percent encoding. */
export function localRequestTarget(raw: string): boolean {
  const path = raw.split('?')[0];
  // Scoped native storage encodes the derived owner colon in learner paths.
  // Keep the exception inside this host; encoded separators/traversal remain rejected.
  if (/^\/api\/zhiban\/authoring\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}(?:\/|$)/.test(path))
    return (
      raw.length <= 16384 &&
      !/[\\\x00-\x20]/.test(raw) &&
      !raw.includes('//') &&
      !path.split('/').includes('..') &&
      !/%(?!3[aA])/.test(path) &&
      /^\/[a-zA-Z0-9_/:.%-]+$/.test(path)
    );

  return (
    raw.startsWith('/') &&
    !raw.includes('\\') &&
    !raw.includes('//') &&
    !path.includes('%') &&
    !path.split('/').includes('..') &&
    (!raw.includes('%') ||
      /^\/api\/zhiban\/(attainment\/[0-9a-f-]{36}|autograde\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|ema\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|pbl\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|flow\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|onboarding\/[0-9a-f-]{36}\/requests|tutor\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|learner\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|concept\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|risk\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|remediation\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|reminders\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}|analytics\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}\/(?:followups|followup-cases(?:\/[0-9a-f-]{36})?)|profile\/[0-9a-f-]{36}\/members|learning\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}\/(activities|attempts|submissions|quizzes|quiz-submissions|discussions(?:\/[0-9a-f-]{36}\/(?:posts|events))?)|assessment\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}\/(publications|queue|gradebook(?:\.csv|-export\.csv)?)|workspace\/[0-9a-f-]{36}\/(courses|roster|teachers)|directory\/[0-9a-f-]{36}|management\/[0-9a-f-]{36}\/(offerings|enrollments|courses|terms|classes|assignments|class-members|teachers|owner-candidates|history))$/.test(
        path,
      ))
  );
}

/** Explicit local HTML routes; query parameters never grant course access. */
export function localCoursePageTarget(path: string): boolean {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (
    new RegExp(`^/zhiban/(teacher|student)/courses/${uuid}/learning-center(?:/${uuid})?$`).test(
      path,
    )
  )
    return true;
  return /^\/zhiban\/(?:teacher\/courses\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:classrooms|resources|students|grades|analytics|discussions|remediation|risk|concepts|learning-profile|attainment|auto-grading|evidence-profile|tutor|classroom-plan|pbl))?|student\/courses\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:introduction|coursework|resources|grades|discussions|reminders|remediation|concepts|learning-profile|attainment|auto-grading|evidence-profile|tutor|classroom-plan|pbl))?)$/.test(
    path,
  );
}

/** Business pages render inside the same course chrome; content keeps its own CSP. */
export function localCoursePageAsset(path: string): string | null {
  if (
    ['/zhiban/classroom', '/zhiban/teacher/classrooms', '/zhiban/student/classrooms'].includes(path)
  )
    return '/zhiban';
  if (!localCoursePageTarget(path)) return null;
  if (/\/learning-center(?:\/[0-9a-f-]{36})?$/.test(path)) return '/zhiban/content';
  if (path.endsWith('/resources')) return '/zhiban/content';
  if (path.endsWith('/attainment')) return '/zhiban/attainment';
  if (path.endsWith('/auto-grading')) return '/zhiban/auto-grading';
  if (path.endsWith('/evidence-profile')) return '/zhiban/ema';
  if (path.endsWith('/pbl')) return '/zhiban/pbl';
  if (path.endsWith('/classroom-plan')) return '/zhiban/flow';
  if (path.endsWith('/tutor')) return '/zhiban/tutor';
  if (path.endsWith('/learning-profile')) return '/zhiban/learning-profile';
  if (path.endsWith('/concepts')) return '/zhiban/concepts';
  if (path.endsWith('/risk')) return '/zhiban/risk';
  if (path.endsWith('/remediation')) return '/zhiban/remediation';
  if (path.endsWith('/reminders')) return '/zhiban/reminders';
  if (path.endsWith('/analytics')) return '/zhiban/analytics';
  if (path.endsWith('/grades'))
    return path.startsWith('/zhiban/teacher/') ? '/zhiban/grading' : '/zhiban/progress';
  return '/zhiban';
}

/** Existing evidence/profile/support navigation, never new scoring or diagnosis. */
export function localSupportPageAsset(path: string): string | null {
  if (
    [
      '/zhiban/teacher/profiles',
      '/zhiban/teacher/risks',
      '/zhiban/student/profile',
      '/zhiban/student/risks',
    ].includes(path)
  )
    return '/zhiban/global-support';
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  return new RegExp(
    `^/zhiban/(?:teacher/courses/${id}/(?:profiles|risks)|student/courses/${id}/(?:analysis|support))$`,
  ).test(path)
    ? '/zhiban/support-hub'
    : null;
}

/** Global grade selectors reuse server-authorized per-course surfaces. */
export function localGradePageAsset(path: string): string | null {
  return ['/zhiban/teacher/grades', '/zhiban/student/grades'].includes(path)
    ? '/zhiban/global-grades'
    : null;
}

/** Only legacy personal settings, never learning profiles. */
export function localPersonalPageAsset(path: string): string | null {
  return ['/zhiban/student/settings', '/zhiban/teacher/profile'].includes(path)
    ? '/zhiban/profile'
    : null;
}

/** Fixed legacy entry surfaces; all data access is checked by existing APIs. */
export function localLegacyEntryAsset(path: string): string | null {
  if (path === '/zhiban/login') return '/zhiban';
  return ['/zhiban/admin', '/zhiban/admin/users'].includes(path) ? '/zhiban/admin-entry' : null;
}

/** Only implemented administrator pages receive compatibility aliases. */
export function localAdminPageAsset(path: string): string | null {
  return (
    (
      {
        '/zhiban/admin/accounts': '/zhiban/profile',
        '/zhiban/admin/academic': '/zhiban/management',
        '/zhiban/admin/students': '/zhiban/directory',
        '/zhiban/admin/import/registrations': '/zhiban/admin/import',
        '/zhiban/admin/import/users': '/zhiban/admin/onboarding',
      } as Record<string, string>
    )[path] ?? null
  );
}

/** Legacy teacher Agent URLs now reuse the existing course authoring surface, not the intervention console. */
export function localAuthoringPageAsset(path: string): string | null {
  if (path === '/zhiban/teacher/agents') return '/zhiban/global-authoring';
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  return new RegExp(`^/zhiban/teacher/courses/${id}/agents$`).test(path) ? '/zhiban/content' : null;
}

/** Old student tools page reuses governed course Tutor; AI Peer remains gated. */
export function localStudentToolsPageAsset(path: string): string | null {
  if (
    /^\/zhiban\/(teacher|student)\/pbl$/.test(path) ||
    /^\/zhiban\/student\/pbl\/[A-Za-z0-9_-]{1,128}$/.test(path)
  )
    return '/zhiban/pbl-entry';
  if (path === '/zhiban/student/tools') return '/zhiban/global-tools';
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  return new RegExp(`^/zhiban/student/courses/${id}/tools$`).test(path) ? '/zhiban/tutor' : null;
}

/** Teacher configuration is read-only; administrator mutation authority remains separate. */
export function localCourseAdministrationPageAsset(path: string): string | null {
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  return new RegExp(`^/zhiban/teacher/courses/${id}/(?:settings|teachers)$`).test(path)
    ? '/zhiban/course-administration'
    : null;
}

/** Remaining ordinary entry adapters; target IDs are resolved by existing authorized APIs. */
export function localOrdinaryEntryAsset(path: string): string | null {
  if (path === '/zhiban/teacher/courses') return '/zhiban/global-authoring';
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  return new RegExp(`^/zhiban/student/(?:classroom/${id}|courses/${id}/activities/${id})$`).test(
    path,
  )
    ? '/zhiban/global-tools'
    : null;
}
