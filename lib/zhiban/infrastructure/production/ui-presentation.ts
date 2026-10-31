/** Presentation only. Does not change LOCAL evidence, authority, services or deployment gates. */
export type UiEnvironment = 'local' | 'test' | 'production';

export function uiEnvironment(
  value: string | undefined,
  fallback: UiEnvironment = 'production',
): UiEnvironment {
  if (value === undefined) return fallback;
  if (value === 'local' || value === 'test' || value === 'production') return value;
  throw new Error('ZHIBAN_UI_ENVIRONMENT must be local, test or production');
}

export function presentUiHtml(html: string, environment: UiEnvironment): string {
  const page = html.replace(
    /<html\b([^>]*)>/i,
    (_, attributes: string) => `<html${attributes} data-zhiban-environment="${environment}">`,
  );
  if (environment === 'production') return page;
  const label = environment === 'local' ? '本地体验环境' : '测试环境';
  return page
    .replace('</head>', '<link rel="stylesheet" href="/zhiban/ui-environment.css" /></head>')
    .replace(
      /<body\b[^>]*>/i,
      (body) =>
        `${body}<div class="zhiban-environment-notice" role="status">${label} · 仅供体验与验证</div>`,
    );
}
