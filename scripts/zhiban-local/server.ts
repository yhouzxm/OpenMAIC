import {
  localAdminPageAsset,
  localCoursePageAsset,
  localPersonalPageAsset,
  localGradePageAsset,
  localLegacyEntryAsset,
  localSupportPageAsset,
  localAuthoringPageAsset,
  localStudentToolsPageAsset,
  localCourseAdministrationPageAsset,
  localOrdinaryEntryAsset,
  localRequestTarget,
} from './request-target';
import { createServer } from 'node:https';
import { readFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '@/lib/zhiban/infrastructure/identity/http/adapter';
import { loadAcademic } from './academic';
import { loadContent } from './content';
import { directory, database, pgPort, origin, digest, loadRuntime, privateFile } from './config';

async function main() {
  const runtime = await loadRuntime();
  const certificate = await privateFile('localhost.crt');
  const receipt = JSON.parse((await privateFile('receipt.json')).toString());
  if (digest(certificate.toString()) !== receipt.certificateHash)
    throw new Error('Certificate checksum rejected.');
  // Read-only preflight. Web startup never creates roles, runs DDL or seeds identities.
  const preflight = new Pool({ connectionString: runtime.secrets.LOCAL_M1_CONTROL, max: 1 });
  try {
    const result = await preflight.query(
      `SELECT current_database() AS database,current_setting('server_version_num')::integer AS pg_version`,
    );
    if (
      result.rows.length !== 1 ||
      result.rows.some(
        (row) => row.database !== database || row.pg_version < 160000 || row.pg_version > 169999,
      )
    )
      throw new Error('PG16 migration preflight rejected.');
  } finally {
    await preflight.end();
  }
  const pools = {} as Record<'auth' | 'tenant' | 'control', Pool>;
  for (const [key, role] of [
    ['auth', 'zhiban_auth_runtime'],
    ['tenant', 'zhiban_runtime'],
    ['control', 'zhiban_control_runtime'],
  ] as const) {
    const dsn = runtime.secrets[runtime.manifest.runtimeSecrets[key]],
      url = new URL(dsn);
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== '127.0.0.1' ||
      Number(url.port) !== pgPort ||
      url.pathname !== `/${database}` ||
      url.username !== role ||
      url.search
    )
      throw new Error('Local Identity runtime endpoint rejected.');
    pools[key] = new Pool({
      connectionString: dsn,
      max: 6,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
    });
  }
  const root = await createIdentityComposition(pools, runtime.composition);
  const { IdentitySafeQueries } =
    await import('@/lib/zhiban/application/identity/use-cases/safe-queries');
  const identityFacade = createIdentityHttp(
    async () => ({
      security: root.security,
      application: root.application,
      members: root.members,
      queries:
        root.queries ??
        new IdentitySafeQueries({
          passwordState: (h) => root.security.passwordState(h),
          member: async () => {
            throw new Error('Closed');
          },
          consentContext: async () => {
            throw new Error('Closed');
          },
        }),
    }),
    runtime.manifest.policy,
    (record) => {
      void appendFile(join(directory, 'operations.jsonl'), JSON.stringify(record) + '\n', {
        mode: 0o600,
      }).catch(() => {});
    },
  );
  const identityHttp = (request: Request) => identityFacade.handle(request);
  const contentHttp = await loadContent(root.security, origin);
  const academicHttp = await loadAcademic(
    root.security,
    pools.tenant,
    origin,
    !!contentHttp,
    contentHttp ?? undefined,
  );
  const ready = await identityHttp(
    new Request(`${origin}/api/zhiban/identity/me`, {
      headers: { 'x-zhiban-request': 'identity-v1', 'x-zhiban-client-ip': '127.0.0.1' },
    }),
  );
  if (ready.status !== 401) throw new Error('Identity composition preflight rejected.');
  const assets = new Map<string, { type: string; content: Buffer }>();
  for (const [path, name, type] of [
    ['/zhiban/workspace.css', 'workspace.css', 'text/css; charset=utf-8'],
    ['/zhiban/admin-shell.js', 'admin-shell.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/course-page.js', 'course-page.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/workspace.js', 'workspace.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/course-administration', 'course-administration.html', 'text/html; charset=utf-8'],
    [
      '/zhiban/course-administration.js',
      'course-administration.js',
      'text/javascript; charset=utf-8',
    ],
    ['/zhiban/global-tools', 'global-tools.html', 'text/html; charset=utf-8'],
    ['/zhiban/global-tools.js', 'global-tools.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/global-authoring', 'global-authoring.html', 'text/html; charset=utf-8'],
    ['/zhiban/global-authoring.js', 'global-authoring.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/global-support', 'global-support.html', 'text/html; charset=utf-8'],
    ['/zhiban/global-support.js', 'global-support.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/support-hub', 'support-hub.html', 'text/html; charset=utf-8'],
    ['/zhiban/support-hub.js', 'support-hub.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/admin-entry', 'admin-entry.html', 'text/html; charset=utf-8'],
    ['/zhiban/admin-entry.js', 'admin-entry.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/global-grades', 'global-grades.html', 'text/html; charset=utf-8'],
    ['/zhiban/global-grades.js', 'global-grades.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/grading', 'grading.html', 'text/html; charset=utf-8'],
    ['/zhiban/final-grades.js', 'final-grades.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/gradebook.js', 'gradebook.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/grading.js', 'grading.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/relationships', 'relationships.html', 'text/html; charset=utf-8'],
    ['/zhiban/relationships.js', 'relationships.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/management', 'management.html', 'text/html; charset=utf-8'],
    ['/zhiban/management-catalog.js', 'management-catalog.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/management.js', 'management.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/management-page.js', 'management-page.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/management.css', 'management.css', 'text/css; charset=utf-8'],
    ['/zhiban/directory', 'directory.html', 'text/html; charset=utf-8'],
    ['/zhiban/directory.js', 'directory.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/directory-page.js', 'directory-page.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/directory.css', 'directory.css', 'text/css; charset=utf-8'],
    ['/zhiban/roster', 'roster.html', 'text/html; charset=utf-8'],
    ['/zhiban/roster.js', 'roster.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/roster.css', 'roster.css', 'text/css; charset=utf-8'],
    ['/zhiban/roster-template.csv', 'roster-template.csv', 'text/csv; charset=utf-8'],
    ['/zhiban/progress', 'progress.html', 'text/html; charset=utf-8'],
    ['/zhiban/progress.js', 'progress.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/progress.css', 'progress.css', 'text/css; charset=utf-8'],
    ['/zhiban/analytics', 'analytics.html', 'text/html; charset=utf-8'],
    ['/zhiban/analytics.js', 'analytics.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/analytics.css', 'analytics.css', 'text/css; charset=utf-8'],
    ['/zhiban/content', 'content.html', 'text/html; charset=utf-8'],
    ['/zhiban/content-client.js', 'content-client.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/content.css', 'content.css', 'text/css; charset=utf-8'],
    ['/zhiban', 'index.html', 'text/html; charset=utf-8'],
    ['/zhiban/client.js', 'client.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/zhiban/academic.js', 'academic.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/assessment.js', 'assessment.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/learning.js', 'learning.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/quiz-client.js', 'quiz-client.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/quiz.css', 'quiz.css', 'text/css; charset=utf-8'],
    ['/zhiban/classrooms.js', 'classrooms.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/curriculum.js', 'curriculum.js', 'text/javascript; charset=utf-8'],
  ]) {
    assets.set(path, { type, content: await readFile(resolve('app/zhiban/local', name)) });
  }
  const cspEvidence = JSON.parse(
    await readFile(
      resolve(
        contentHttp?.pngEnabled
          ? 'docs/v2/evidence/m5-png-csp-profile.json'
          : 'docs/v2/evidence/m5-content-csp-profile.json',
      ),
      'utf8',
    ),
  );
  const contentCsp = cspEvidence.policy;
  if (typeof contentCsp !== 'string' || contentCsp.includes('unsafe-inline'))
    throw new Error('Content CSP binding rejected');
  const server = createServer(
    { cert: certificate, key: await privateFile('localhost.key'), maxHeaderSize: 8192 },
    async (incoming, outgoing) => {
      const security = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      };
      const finish = (status: number, body = '') => {
        outgoing.writeHead(status, security);
        outgoing.end(body);
      };
      try {
        // Direct TLS is the single ingress. Reject duplicate security headers before Headers coalesces them.
        const counts = new Map<string, number>();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
          const key = incoming.rawHeaders[i].toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        if (
          [...counts].some(
            ([key, count]) =>
              count > 1 &&
              [
                'host',
                'cookie',
                'origin',
                'content-type',
                'content-length',
                'authorization',
                'x-zhiban-request',
                'x-zhiban-csrf',
                'x-zhiban-command',
              ].includes(key),
          )
        )
          return finish(400);
        if (
          incoming.headers.host !== '127.0.0.1:3443' ||
          incoming.socket.remoteAddress !== '127.0.0.1'
        )
          return finish(403);
        const raw = incoming.url ?? '';
        if (!localRequestTarget(raw)) return finish(403);
        const url = new URL(raw, origin);
        if (url.pathname === '/' && incoming.method === 'GET') {
          outgoing.writeHead(302, { ...security, Location: '/zhiban' });
          return outgoing.end();
        }
        const assetKey =
          localOrdinaryEntryAsset(url.pathname) ??
          localCourseAdministrationPageAsset(url.pathname) ??
          localStudentToolsPageAsset(url.pathname) ??
          localAuthoringPageAsset(url.pathname) ??
          localSupportPageAsset(url.pathname) ??
          localLegacyEntryAsset(url.pathname) ??
          localGradePageAsset(url.pathname) ??
          localPersonalPageAsset(url.pathname) ??
          localCoursePageAsset(url.pathname) ??
          localAdminPageAsset(url.pathname) ??
          url.pathname;
        const asset = assets.get(assetKey);
        if (asset) {
          if (!['GET', 'HEAD'].includes(incoming.method ?? '')) return finish(405);
          const policy =
            assetKey === '/zhiban/content'
              ? { ...security, 'Content-Security-Policy': contentCsp }
              : security;
          outgoing.writeHead(200, { ...policy, 'Content-Type': asset.type });
          const content =
            academicHttp?.classroomEnabled && asset.type.startsWith('text/html')
              ? Buffer.from(
                  asset.content
                    .toString()
                    .replace('</head>', '<script src="/zhiban/classrooms.js"></script></head>'),
                )
              : asset.content;
          return outgoing.end(incoming.method === 'HEAD' ? undefined : content);
        }
        const contentRoute =
          /^\/api\/zhiban\/content\/[^/]+\/offerings\/[^/]+(?:\/resources\/[^/]+\/(?:preview|assets(?:\/[^/]+)?))?$/.test(
            url.pathname,
          );
        const learningRoute =
          /^\/api\/zhiban\/learning\/[^/]+\/offerings\/[^/]+(?:\/(activities|attempts|submissions|outline|classrooms|attachments))?$/.test(
            url.pathname,
          );
        const assessmentRoute =
          /^\/api\/zhiban\/assessment\/[^/]+\/offerings\/[^/]+(?:\/(publications|queue|gradebook(?:\.csv)?))?$/.test(
            url.pathname,
          );
        const workspaceRoute = /^\/api\/zhiban\/workspace\/[^/]+\/(courses|roster|teachers)$/.test(
          url.pathname,
        );
        const managementRoute =
          /^\/api\/zhiban\/management\/[^/]+\/(offerings|enrollments|courses|terms|classes|assignments|class-members|teachers|owner-candidates|history|commands)$/.test(
            url.pathname,
          );
        const directoryRoute = /^\/api\/zhiban\/directory\/[^/]+$/.test(url.pathname);
        const rosterRoute = /^\/api\/zhiban\/roster\/[^/]+\/offerings\/[^/]+$/.test(url.pathname);
        const progressRoute = /^\/api\/zhiban\/progress\/[^/]+\/offerings\/[^/]+$/.test(
          url.pathname,
        );
        const analyticsRoute = /^\/api\/zhiban\/analytics\/[^/]+\/offerings\/[^/]+$/.test(
          url.pathname,
        );
        const academicRoute = /^\/api\/zhiban\/academic\/[^/]+$/.test(url.pathname);
        if (
          !contentRoute &&
          !academicRoute &&
          !learningRoute &&
          !assessmentRoute &&
          !analyticsRoute &&
          !progressRoute &&
          !rosterRoute &&
          !directoryRoute &&
          !managementRoute &&
          !workspaceRoute &&
          !/^\/api\/zhiban\/identity\/(login|logout|me|csrf|spaces)$/.test(url.pathname)
        )
          return finish(404);
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (
            value !== undefined &&
            !['host', 'connection', 'transfer-encoding', 'content-length', 'forwarded'].includes(
              key,
            ) &&
            !key.startsWith('x-forwarded-') &&
            key !== 'x-zhiban-client-ip'
          )
            headers.set(key, Array.isArray(value) ? value.join(',') : value);
        }
        headers.set('x-zhiban-client-ip', incoming.socket.remoteAddress);
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timeout = setTimeout(() => incoming.destroy(), 3000);
        try {
          for await (const chunk of incoming) {
            bytes += chunk.length;
            if (
              bytes >
              (contentRoute && /\/assets$/.test(url.pathname) && incoming.method === 'POST'
                ? 4194304
                : contentRoute
                  ? 262144
                  : rosterRoute
                    ? 16384
                    : learningRoute &&
                        academicHttp?.submissionAttachments &&
                        /^\/api\/zhiban\/learning\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}$/.test(
                          url.pathname,
                        )
                      ? 1450000
                      : learningRoute || assessmentRoute
                        ? 32768
                        : 4096)
            ) {
              finish(413);
              incoming.destroy();
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
        } finally {
          clearTimeout(timeout);
        }
        const body = Buffer.concat(chunks);
        if (['GET', 'HEAD'].includes(incoming.method ?? '') && bytes > 0) return finish(400);
        const abort = new AbortController();
        outgoing.once('close', () => abort.abort());
        if (contentRoute && /\/assets\/[^/]+$/.test(url.pathname)) {
          const deadline = setTimeout(() => {
            abort.abort();
            outgoing.destroy();
          }, 10000);
          outgoing.once('finish', () => clearTimeout(deadline));
          outgoing.once('close', () => clearTimeout(deadline));
        }
        const forwarded = new Request(url, {
          signal: abort.signal,
          method: incoming.method,
          headers,
          ...(!['GET', 'HEAD'].includes(incoming.method ?? '') ? { body } : {}),
        });
        const businessHttp = contentRoute
          ? contentHttp
          : workspaceRoute
            ? academicHttp?.workspace
            : managementRoute
              ? academicHttp?.management
              : directoryRoute
                ? academicHttp?.directory
                : rosterRoute
                  ? academicHttp?.roster
                  : progressRoute
                    ? academicHttp?.progress
                    : analyticsRoute
                      ? academicHttp?.analytics
                      : assessmentRoute
                        ? academicHttp?.assessment
                        : learningRoute
                          ? academicHttp?.learning
                          : academicHttp;
        const response =
          contentRoute ||
          academicRoute ||
          learningRoute ||
          assessmentRoute ||
          analyticsRoute ||
          progressRoute ||
          rosterRoute ||
          directoryRoute ||
          managementRoute ||
          workspaceRoute
            ? businessHttp
              ? await businessHttp(forwarded)
              : new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' },
                })
            : await identityHttp(forwarded);
        outgoing.writeHead(response.status, {
          ...security,
          ...Object.fromEntries(response.headers),
        });
        if (response.body) {
          const reader = response.body.getReader();
          const cancel = () => {
            void reader.cancel().catch(() => {});
          };
          outgoing.once('close', cancel);
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              if (outgoing.destroyed) break;
              await new Promise<void>((resolve, reject) => {
                outgoing.write(Buffer.from(chunk.value), (error) =>
                  error ? reject(error) : resolve(),
                );
              });
            }
          } finally {
            outgoing.removeListener('close', cancel);
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        outgoing.end();
      } catch {
        if (!outgoing.headersSent) finish(503);
        else outgoing.destroy();
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  server.listen(3443, '127.0.0.1', () =>
    console.log(
      `LOCAL ${contentHttp ? 'M5' : academicHttp?.assessment ? 'M4' : academicHttp?.learning ? 'M3' : academicHttp ? 'M2' : 'M1'} ready: ${origin}/zhiban (PG16 ${pgPort}/${database})`,
    ),
  );
  server.on('error', () => {
    console.error('Local HTTPS listener failed.');
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => server.close(() => process.exit(0)));
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Local M1 startup rejected.');
  process.exit(1);
});
