import { readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve('lib/zhiban/application/identity/ports');
function allFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [relative(root, path)];
  });
}

describe('Application Identity Port dependency boundary', () => {
  it('contains only TypeScript contracts importing the Identity Domain or sibling contracts', () => {
    const files = allFiles(root);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts')) {
        violations.push(`${file}: non-TypeScript source`);
        continue;
      }
      const source = readFileSync(resolve(root, file), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      if (/@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable/.test(source)) {
        violations.push(`${file}: suppression directive`);
      }
      function checkSpecifier(specifier: string): void {
        if (specifier === '@/lib/zhiban/domain/identity') return;
        if (specifier.startsWith('./')) {
          const target = resolve(dirname(resolve(root, file)), specifier);
          const local = relative(root, target);
          if (!local.startsWith('..') && !isAbsolute(local)) return;
        }
        violations.push(`${file}: forbidden dependency ${specifier}`);
      }
      function visit(node: ts.Node): void {
        if (node.kind === ts.SyntaxKind.AnyKeyword) violations.push(`${file}: any`);
        if (ts.isImportTypeNode(node)) violations.push(`${file}: inline import type`);
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (specifier && ts.isStringLiteral(specifier)) checkSpecifier(specifier.text);
        }
        if (
          ts.isImportEqualsDeclaration(node) ||
          (ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
        ) {
          violations.push(`${file}: runtime import`);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
