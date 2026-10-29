import { expect, it } from 'vitest';
import { interactiveVendorAsset } from '../../../scripts/zhiban-local/interactive-assets';

it('serves only the pinned upstream public libraries and their font/module files', () => {
  expect(interactiveVendorAsset('/vendor/interactive/katex@0.16.38/dist/katex.min.js')?.type).toBe(
    'text/javascript',
  );
  expect(
    interactiveVendorAsset('/vendor/interactive/katex@0.16.38/dist/fonts/KaTeX_Main-Regular.woff2')
      ?.type,
  ).toBe('font/woff2');
  expect(
    interactiveVendorAsset('/vendor/interactive/@tailwindcss/browser@4.1.18/dist/index.global.js')
      ?.type,
  ).toBe('text/javascript');
  for (const value of [
    '/vendor/interactive/katex@0.16.37/dist/katex.min.js',
    '/vendor/interactive/katex@0.16.38/package.json',
    '/vendor/interactive/katex@0.16.38/dist/../package.json',
    '/vendor/interactive/katex@0.16.38/dist/%2e%2e/.env.local',
    '/vendor/interactive/katex@0.16.38/dist//katex.min.js',
    '/vendor/interactive/katex@0.16.38/dist\\katex.min.js',
    '/vendor/interactive/other@1.0.0/index.js',
  ])
    expect(interactiveVendorAsset(value)).toBeNull();
});
