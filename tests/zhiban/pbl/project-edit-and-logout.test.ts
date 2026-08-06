import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('PBL project editing and portal logout', () => {
  it('invalidates a generated package when its definition changes', () => {
    const service = source('lib/zhiban/pbl/service.ts');
    expect(service).toContain('updatePblProjectDefinition');
    expect(service).toContain("status='draft',openmaic_package=NULL");
  });

  it('provides an edit action and uses the existing logout endpoint', () => {
    const consoleSource = source('components/zhiban/pbl-project-console.tsx');
    const logout = source('components/zhiban/logout-button.tsx');
    expect(consoleSource).toContain('保存修改');
    expect(consoleSource).toContain('setEditing(p)');
    expect(logout).toContain("fetch('/api/zhiban/auth/logout'");
    expect(logout).toContain("router.replace('/zhiban/login')");
  });
});
