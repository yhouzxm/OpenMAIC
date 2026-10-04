import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import ts from 'typescript';

export async function browserBundle(): Promise<string> {
  const input = resolve('tests/zhiban/openmaic/browser-entry.tsx');
  const build = await rollup({
    input,
    plugins: [
      {
        name: 'diagnostic-jsx-entry',
        async load(id) {
          if (id !== input) return null;
          return ts.transpileModule(await readFile(input, 'utf8'), {
            compilerOptions: {
              jsx: ts.JsxEmit.ReactJSX,
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
          }).outputText;
        },
      },
      {
        name: 'diagnostic-browser-mode',
        transform(code) {
          return { code: code.replace(/\bprocess\.env\.NODE_ENV\b/g, '"production"'), map: null };
        },
      },
      nodeResolve({ browser: true, exportConditions: ['browser'] }),
      commonjs(),
    ],
    onwarn(warning, defaultHandler) {
      if (warning.code !== 'MODULE_LEVEL_DIRECTIVE' && warning.code !== 'CIRCULAR_DEPENDENCY')
        defaultHandler(warning);
    },
  });
  try {
    const result = await build.generate({ format: 'iife', inlineDynamicImports: true });
    const entry = result.output[0];
    if (entry.type !== 'chunk') throw new Error('DIAGNOSTIC_BROWSER_BUILD_FAILED');
    return entry.code;
  } finally {
    await build.close();
  }
}
