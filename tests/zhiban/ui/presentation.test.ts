import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { presentUiHtml, uiEnvironment } from '../../../scripts/zhiban-local/ui-presentation';

describe('deployment UI presentation', () => {
  it('uses explicit modes, defaults to formal copy and rejects invalid configuration', () => {
    expect(uiEnvironment(undefined)).toBe('production');
    expect(uiEnvironment(undefined, 'local')).toBe('local');
    for (const value of ['local', 'test', 'production'] as const)
      expect(uiEnvironment(value)).toBe(value);
    for (const value of ['', 'prod', 'LOCAL', 'production" onload="alert(1)'])
      expect(() => uiEnvironment(value)).toThrow('ZHIBAN_UI_ENVIRONMENT');
  });

  it('presents every shipped HTML page consistently without changing links, scripts or page titles', async () => {
    const base = 'app/zhiban/local';
    const files = (await readdir(base)).filter((file) => file.endsWith('.html'));
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const html = await readFile(`${base}/${file}`, 'utf8');
      const title = html.match(/<title>.*?<\/title>/)?.[0];
      const links = html.match(/<(?:a|script)\b[^>]*>/g);
      for (const environment of ['local', 'test', 'production'] as const) {
        const page = presentUiHtml(html, environment);
        expect(page).toContain(`data-zhiban-environment="${environment}"`);
        expect(page.match(/<title>.*?<\/title>/)?.[0]).toBe(title);
        expect(page.match(/<(?:a|script)\b[^>]*>/g)).toEqual(links);
        expect(page).not.toContain('本地开发环境');
        if (environment === 'production') {
          expect(page).not.toMatch(
            /本地体验环境|测试环境|zhiban-environment-notice|ui-environment.css/,
          );
          expect(page).not.toContain('<span>LOCAL</span>');
        } else {
          expect(page).toContain('role="status"');
          expect(page).toContain(environment === 'local' ? '本地体验环境' : '测试环境');
          expect(page).toContain('/zhiban/ui-environment.css');
        }
      }
    }
  });
});
