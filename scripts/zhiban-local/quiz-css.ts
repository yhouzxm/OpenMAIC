import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
/** Compile actual shared Quiz utilities; scope them to the course widget, without global preflight or fonts. */
export async function buildQuizCss() {
  const source =
    '@layer theme, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities) source(none);\n@source "./quiz-client.tsx";\n@source "../../../packages/@openmaic/renderer/src/quiz";\n@source "../../../packages/@openmaic/editor/src/quiz";';
  const result = await postcss([
    tailwindcss({ optimize: true }) as unknown as postcss.AcceptedPlugin,
  ]).process(source, { from: resolve('app/zhiban/local/quiz.utilities.css') });
  result.root.walkRules((rule) => {
    let parent: postcss.Node | undefined = rule.parent;
    while (parent) {
      if (
        parent.type === 'rule' ||
        (parent.type === 'atrule' && (parent as postcss.AtRule).name.endsWith('keyframes'))
      )
        return;
      parent = parent.parent;
    }
    rule.selector = rule.selector.includes(':root')
      ? '.quiz-product'
      : `:where(.quiz-product) :is(${rule.selector})`;
  });
  const base = await readFile('app/zhiban/local/quiz.base.css', 'utf8');
  const math = postcss.parse(
    await readFile(createRequire(import.meta.url).resolve('katex/dist/katex.min.css'), 'utf8'),
  );
  math.walkAtRules('font-face', (rule) => {
    rule.remove();
  });
  math.walkRules((rule) => {
    rule.selector = `:where(.quiz-product) :is(${rule.selector})`;
  });
  await writeFile(
    'app/zhiban/local/quiz.css',
    '@layer theme, base, utilities;\n@layer base {\n' +
      base +
      '\n}\n' +
      '\n/* Generated from the shared OpenMAIC Quiz source; no global preflight. */\n' +
      result.root.toString() +
      '\n' +
      math.toString(),
  );
}
