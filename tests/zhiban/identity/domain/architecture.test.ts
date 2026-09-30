import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as identity from '@/lib/zhiban/domain/identity';
import { privilegedCapabilityViolations, projectSourceFileIdentities } from './privileged-capability-guard';

const root = resolve('lib/zhiban/domain/identity');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [relative(root, path)];
  });
}
const files = sourceFiles(root);

describe('identity dependency boundary', () => {
  it('contains only synchronous pure TypeScript with local domain imports', () => {
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts')) {
        failures.push(file + ': identity domain source must be .ts');
        continue;
      }
      const source = readFileSync(resolve(root, file), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      if (
        /\b(?:OpenMAIC|Stage|Scene|AssetStore|RuntimeStore|React|Next|Zustand)\b|@openmaic\//i.test(
          source,
        )
      ) {
        failures.push(file + ': forbidden dependency vocabulary');
      }
      if (/@ts-ignore|@ts-nocheck|eslint-disable/.test(source))
        failures.push(file + ': suppression');
      function visit(node: ts.Node): void {
        if (node.kind === ts.SyntaxKind.AnyKeyword) failures.push(file + ': unsafe type');
        if (ts.isImportTypeNode(node)) failures.push(file + ': inline module type');
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (specifier && ts.isStringLiteral(specifier)) {
            const target = resolve(dirname(resolve(root, file)), specifier.text);
            const local = relative(root, target);
            if (!specifier.text.startsWith('./') || local.startsWith('..') || isAbsolute(local)) {
              failures.push(file + ': nonlocal module ' + specifier.text);
            }
          }
        }
        if (
          ts.isImportEqualsDeclaration(node) ||
          (ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                ['require', 'eval', 'fetch', 'setTimeout'].includes(node.expression.text))))
        ) {
          failures.push(file + ': runtime module or side effect');
        }
        if (
          ts.isIdentifier(node) &&
          ['Date', 'crypto', 'process', 'window', 'document'].includes(node.text)
        ) {
          failures.push(file + ': ambient state ' + node.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(failures).toEqual([]);
  });
  it('keeps internal validation helpers out of the root public entrypoint', () => {
    for (const name of ['invariant', 'nonBlank', 'atOrAfter', 'validateValidity']) {
      expect(identity).not.toHaveProperty(name);
    }
    for (const name of [
      'IdentityDomainError',
      'User',
      'Tenant',
      'Membership',
      'Role',
      'RoleGrant',
      'SystemAdminGrant',
      'classScope',
      'courseScope',
      'parseScope',
    ]) {
      expect(identity).toHaveProperty(name);
    }
  });
});

describe('DH07 privileged rehydration boundary', () => {
  it('does not expose reconstruction through the standard barrel', () => {
    for (const name of Object.keys(identity)) expect(name).not.toMatch(/ForPersistence$/);
    const entrypoint = readFileSync(resolve('lib/zhiban/domain/identity/index.ts'), 'utf8');
    expect(entrypoint).not.toContain('persistence-rehydration');
    expect(entrypoint).not.toContain('persistence-validation');
  });
  it('guards the actual repository source graph', () => {
    const configuredFiles = projectSourceFileIdentities();
    const paths = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter((file) => {
        const absolute = resolve(file).replaceAll('\\', '/');
        const identity = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
        return /\.[cm]?[jt]sx?$/.test(file) && configuredFiles.has(identity);
      });
    const sources = new Map(paths.map((file) => [file, readFileSync(resolve(file), 'utf8')]));
    expect(privilegedCapabilityViolations(sources)).toEqual([]);
  }, 60_000);
});
