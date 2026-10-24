/* LOCAL package/isolated browser diagnostic. Never imports private OpenMAIC surfaces. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import ts from 'typescript';
import { chromium, expect } from '@playwright/test';
const source = process.cwd(),
  root = await mkdtemp(join(tmpdir(), 'zhiban-d08-')),
  names = ['dsl', 'renderer', 'editor'];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const passed: string[] = [],
  record = (s: string) => {
    passed.push(s);
    console.log('PASS ' + s);
  };
const sourceHashes: Record<string, string> = {},
  artifactHashes: Record<string, string> = {};
let server: ReturnType<typeof createServer> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const run = (cwd: string) =>
  new Promise<void>((done, reject) => {
    const child = spawn('pnpm', ['build'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (b) => (output = (output + b).slice(-12000)));
    child.stderr.on('data', (b) => (output = (output + b).slice(-12000)));
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) done();
      else reject(new Error(output));
    });
  });
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(p)));
    else if (entry.isFile()) result.push(p);
  }
  return result;
}
try {
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    'refactor/zhiban-v2',
  );
  assert.match(process.versions.node, /^22\./);
  assert.equal(execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(), '10.28.0');
  const tracked = execFileSync(
    'git',
    ['ls-files', ...names.map((n) => `packages/@openmaic/${n}`)],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const file of tracked) {
    const bytes = await readFile(file);
    assert.deepEqual(
      bytes,
      execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 20 * 1024 * 1024 }),
    );
    sourceHashes[file] = hash(bytes);
    const target = join(root, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await symlink(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const name of names) {
    const dir = join(root, 'packages/@openmaic', name),
      installed = join(source, 'packages/@openmaic', name, 'node_modules');
    await mkdir(join(dir, 'node_modules/@openmaic'), { recursive: true });
    for (const dep of await readdir(installed)) {
      if (dep === '@openmaic') continue;
      await symlink(join(installed, dep), join(dir, 'node_modules', dep), 'dir');
    }
    for (const dep of names)
      await symlink(
        join(root, 'packages/@openmaic', dep),
        join(dir, 'node_modules/@openmaic', dep),
        'dir',
      );
    console.log('BUILD fresh isolated ' + name);
    await run(dir);
    for (const p of await files(join(dir, 'dist')))
      artifactHashes[p.slice(root.length + 1)] = hash(await readFile(p));
  }
  record('tracked package source equals HEAD; three isolated fresh dist builds');
  const editor = await import(
    pathToFileURL(join(root, 'packages/@openmaic/editor/dist/core/index.js')).href
  );
  const fixture = {
    canvas: {
      id: 's',
      viewportSize: 960,
      viewportRatio: 0.5625,
      theme: {
        backgroundColor: '#fff',
        themeColors: ['#111'],
        fontColor: '#111',
        fontName: 'sans-serif',
      },
      elements: [
        {
          id: 't',
          type: 'text',
          left: 0,
          top: 0,
          width: 300,
          height: 100,
          rotate: 0,
          content: 'before',
          defaultFontName: 'sans-serif',
          defaultColor: '#111',
        },
      ],
    },
  };
  const history = editor.createEditorHistory(fixture),
    tx = editor.createEditorTransaction({
      origin: 'toolbar',
      operations: [{ type: 'text.updateContent', elementId: 't', content: 'after' }],
    });
  const updated = editor.applyEditorTransaction(history, tx);
  assert.equal(updated.present.canvas.elements[0].content, 'after');
  assert.equal(history.present.canvas.elements[0].content, 'before');
  assert.equal(editor.undoEditorTransaction(updated).present.canvas.elements[0].content, 'before');
  assert.equal(
    editor.redoEditorTransaction(editor.undoEditorTransaction(updated)).present.canvas.elements[0]
      .content,
    'after',
  );
  record('public core controlled transaction, immutable input, undo/redo');
  assert.throws(() =>
    editor.applyEditorTransaction(
      history,
      editor.createEditorTransaction({
        origin: 'toolbar',
        operations: [{ type: 'text.updateContent', elementId: 'foreign', content: 'x' }],
      }),
    ),
  );
  record('unknown element transaction rejected');
  const unsafe = editor.applyEditorTransaction(
    history,
    editor.createEditorTransaction({
      origin: 'toolbar',
      operations: [
        {
          type: 'text.updateContent',
          elementId: 't',
          content: '<img src="https://invalid.example/x">',
        },
      ],
    }),
  );
  assert.match(unsafe.present.canvas.elements[0].content, /<img/);
  record('core accepts HTML: confirmed need for independent closed validation (not sanitizer)');
  const entry = join(root, 'browser-entry.tsx');
  await writeFile(entry, await readFile('scripts/zhiban-local/d08-browser-entry.tsx'));
  const bundle = await rollup({
    input: entry,
    plugins: [
      {
        name: 'exact-public-exports',
        resolveId(id) {
          if (!id.startsWith('@openmaic/')) return null;
          const [, name, ...sub] = id.split('/');
          if (!names.includes(name)) throw new Error('Unaccepted OpenMAIC import');
          const relative = sub.length ? './' + sub.join('/') : '.';
          const pkg = JSON.parse(
            execFileSync('cat', [join(root, 'packages/@openmaic', name, 'package.json')], {
              encoding: 'utf8',
            }),
          );
          const target = pkg.exports[relative];
          if (!target) throw new Error('Non-public package import');
          return join(
            root,
            'packages/@openmaic',
            name,
            typeof target === 'string' ? target : target.import,
          );
        },
        async load(id) {
          if (id !== entry) return null;
          return ts.transpileModule(await readFile(entry, 'utf8'), {
            compilerOptions: {
              jsx: ts.JsxEmit.ReactJSX,
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
          }).outputText;
        },
        transform(code) {
          return { code: code.replace(/\bprocess\.env\.NODE_ENV\b/g, '"production"'), map: null };
        },
      },
      nodeResolve({ browser: true, exportConditions: ['browser'] }),
      commonjs(),
    ],
    onwarn(w, handler) {
      if (!['CIRCULAR_DEPENDENCY', 'MODULE_LEVEL_DIRECTIVE'].includes(w.code ?? '')) handler(w);
    },
  });
  let js: string;
  try {
    const result = await bundle.generate({ format: 'iife', inlineDynamicImports: true });
    assert.equal(result.output[0].type, 'chunk');
    js = (result.output[0] as { code: string }).code;
  } finally {
    await bundle.close();
  }
  artifactHashes['diagnostic-browser.js'] = hash(js);
  let csp =
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  let cspEvidence: unknown = null;
  server = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(js);
    } else if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', csp);
      res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port,
    origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [],
    egress: string[] = [],
    cspConsole: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspConsole.push(message.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      egress.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin);
  await page.getByLabel('Plain text').fill('LOCAL D08 changed');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Canonical text')).toHaveText('LOCAL D08 changed');
  await expect(page.getByText('LOCAL D08 changed', { exact: true }).last()).toBeVisible();
  record('browser public core plus renderer displays edited plain text');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Canonical text')).toHaveText('D08 plain text');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Canonical text')).toHaveText('LOCAL D08 changed');
  record('browser undo/redo');
  for (const text of [
    '<img src="https://invalid.example/x">',
    '<script>alert(1)</script>',
    'x'.repeat(2001),
  ]) {
    await page.getByLabel('Plain text').fill(text);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('output')).toHaveText('REJECTED_TEXT');
    await expect(page.getByLabel('Canonical text')).toHaveText('LOCAL D08 changed');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(egress, []);
  record(
    'host rejects HTML/external asset/oversized text before state adoption; no external requests',
  );
  if (process.argv.includes('--csp-review')) {
    const styles = await page.locator('style').allTextContents();
    assert.ok(styles.length > 0 && styles.every((s) => s.length > 0));
    const styleHashes = [
      ...new Set(
        [...styles, ''].map((s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`),
      ),
    ];
    csp = `default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' ${styleHashes.join(' ')}; style-src-elem 'self' ${styleHashes.join(' ')}; style-src-attr 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    await page.addInitScript(() => {
      const observer = globalThis as unknown as { __csp: string[] };
      observer.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        observer.__csp.push(e.effectiveDirective),
      );
    });
    const response = await page.reload();
    assert.equal(response!.headers()['content-security-policy'], csp);
    await expect(page.getByText('D08 plain text', { exact: true }).last()).toBeVisible();
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll('style')].every(
          (s) => s.sheet !== null && s.sheet.cssRules.length > 0,
        ),
      ),
    );
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[style]')].some(
          (n) => n.style.left === '30px' && getComputedStyle(n).left === '30px',
        ),
      ),
    );
    assert.deepEqual(
      await page.evaluate(() => (globalThis as unknown as { __csp: string[] }).__csp),
      [],
    );
    await page.getByLabel('Plain text').fill('Strict CSP edited');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('Strict CSP edited', { exact: true }).last()).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll('style')].every(
          (s) => s.sheet !== null && s.sheet.cssRules.length > 0,
        ),
      ),
    );
    const beforeProbe = await page.evaluate(
      () => (globalThis as unknown as { __csp: string[] }).__csp,
    );
    assert.deepEqual(
      beforeProbe,
      [],
      'Unexpected CSP violations before hostile probes: ' + cspConsole.join('\n'),
    );
    record(
      'strict hash stylesheet policy: renderer geometry and edit work with style attributes forbidden',
    );
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__cspPayloadRan=true';
      document.body.append(script);
      const style = document.createElement('style');
      style.textContent = 'body{background:rgb(255,0,1)}';
      style.id = 'untrusted-style';
      document.body.append(style);
      const div = document.createElement('div');
      div.id = 'untrusted-attribute';
      div.setAttribute('style', 'color:rgb(255,0,1)');
      document.body.append(div);
      const image = document.createElement('img');
      image.src = 'https://invalid.example/blocked.png';
      document.body.append(image);
    });
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { __csp: string[] }).__csp.length))
      .toBeGreaterThanOrEqual(4);
    assert.equal(
      await page.evaluate(
        () => (globalThis as unknown as { __cspPayloadRan?: boolean }).__cspPayloadRan,
      ),
      undefined,
    );
    assert.equal(
      await page.locator('#untrusted-style').evaluate((n) => (n as HTMLStyleElement).sheet),
      null,
    );
    assert.notEqual(
      await page.locator('#untrusted-attribute').evaluate((n) => getComputedStyle(n).color),
      'rgb(255, 0, 1)',
    );
    const directives = await page.evaluate(
      () => (globalThis as unknown as { __csp: string[] }).__csp,
    );
    for (const d of ['script-src-elem', 'style-src-elem', 'style-src-attr', 'img-src'])
      assert.ok(directives.includes(d), d);
    assert.deepEqual(egress, []);
    record(
      'strict CSP blocks inline script, unapproved style, raw style attribute and remote image',
    );
    cspEvidence = {
      policy: csp,
      styleHashes,
      directives,
      method: 'Hashes measured from public renderer output; no private stylesheet import',
      scope: 'Isolated Chromium HTTP document, not production HTTPS integration',
    };
  }
  await mkdir(join(source, 'docs/v2/evidence'), { recursive: true });
  for (const file of [
    'scripts/zhiban-local/diagnose-d08.mts',
    'scripts/zhiban-local/d08-browser-entry.tsx',
  ])
    sourceHashes[file] = hash(await readFile(file));
  const report = {
    mode: 'LOCAL',
    scope: process.argv.includes('--csp-review')
      ? 'D08 package/host plus isolated CSP review'
      : 'D08 package feasibility and isolated plaintext host only',
    cspEvidence,
    at: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.versions.node,
    pnpm: '10.28.0',
    lockHash: hash(await readFile('pnpm-lock.yaml')),
    dependencies: 'Reuse installed workspace dependencies; no fresh frozen install claimed',
    passed,
    sourceHashes,
    artifactHashes,
    notVerified: [
      'actual Session/role/assignment revocation on content save',
      'real tenant RLS/content CAS',
      'Bridge publication/unknown outcome',
      'D08 integrated acceptance',
      'full EditableSlideCanvas rich-text/clipboard host',
      'production host/build/network',
    ],
    cleanup: 'Exact mkdtemp root removed after diagnostic; no DB/schema/role/credentials created',
  };
  await writeFile(
    process.argv.includes('--csp-review')
      ? 'docs/v2/evidence/m5-csp-local.json'
      : 'docs/v2/evidence/m5-d08-local.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `LOCAL D08 ${passed.length}/${passed.length} package/browser checks PASS; integrated acceptance pending`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
