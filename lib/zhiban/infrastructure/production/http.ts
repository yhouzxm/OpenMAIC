/** HTTPS transport shared by the formal host's real pages and API adapters. */
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as routes from './request-target';
import { presentUiHtml } from './ui-presentation';
import { interactiveVendorAsset } from './interactive-assets';
import type { assembleApplication } from './application';
export async function serveApplication(input: {
  origin: string;
  address: string;
  port: number;
  key: Buffer;
  certificate: Buffer;
  proxy?: { address: string; token: string };
  health?: () => Promise<boolean>;
  admit?: () => Promise<boolean>;
  handlers: Awaited<ReturnType<typeof assembleApplication>>['handlers'];
}) {
  const { origin, key, handlers } = input,
    tls = input.certificate,
    root = process.cwd();
  const presentationEnvironment = 'production' as const;
  const trial = true,
    sharedClassroom = false,
    attachments = true,
    trustedFiles = true;
  const {
    httpPlatform,
    httpManagement,
    httpWorkspace,
    httpAcademic,
    httpLoginIdentifiers,
    httpProfile,
    httpMaterial,
    httpLearning,
    httpAssessment,
    httpAccountRequests,
    httpAccountSetup,
    httpTutor,
    httpPbl,
    httpFlow,
    httpAttainment,
    httpAutograde,
    httpEma,
    httpLearner,
    httpConcept,
    httpRisk,
    httpRemediation,
    httpReminders,
    httpAnalytics,
    httpImports,
    httpDirectory,
    httpRoster,
    httpProgress,
    httpNativeAuthoring,
    httpServices,
    httpCourseResults,
    httpClassroomAi,
    facade,
    contentHost,
  } = handlers;
  const {
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
  } = routes;
  let archiveUploads = 0,
    activeBodies = 0;
  const server = createServer(
    { key, cert: tls, maxHeaderSize: 8192 },
    async (incoming, outgoing) => {
      if (
        incoming.method === 'POST' &&
        (incoming.url?.includes('/archive/') || incoming.url?.includes('/media/upload'))
      ) {
        if (archiveUploads >= 2) {
          outgoing.writeHead(503, { 'Cache-Control': 'no-store' });
          outgoing.end();
          incoming.resume();
          return;
        }
        archiveUploads++;
        let released = false;
        outgoing.once('close', () => {
          if (!released) {
            released = true;
            archiveUploads--;
          }
        });
      }
      if (!['GET', 'HEAD'].includes(incoming.method ?? '')) {
        if (activeBodies >= 4) {
          outgoing.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '1' });
          outgoing.end();
          incoming.resume();
          return;
        }
        activeBodies++;
        outgoing.once('close', () => {
          activeBodies--;
        });
      }
      const abort = new AbortController();
      outgoing.once('close', () => abort.abort());
      const deadline = setTimeout(
        () => {
          abort.abort();
          outgoing.destroy();
        },
        incoming.url?.includes('/api/zhiban/service-center/') ||
          incoming.url?.includes('/api/zhiban/classroom-ai/') ||
          /\/native\/api\/(generate|transcription)/.test(incoming.url ?? '')
          ? 360000
          : incoming.url?.includes('/archive/')
            ? 180000
            : trustedFiles
              ? 75000
              : 10000,
      );
      outgoing.once('finish', () => clearTimeout(deadline));
      outgoing.once('close', () => clearTimeout(deadline));
      try {
        if (incoming.headers.host !== new URL(origin).host) {
          outgoing.writeHead(403);
          outgoing.end();
          return;
        }
        if (!localRequestTarget(incoming.url ?? '')) {
          outgoing.writeHead(403);
          outgoing.end();
          return;
        }
        let clientIp = incoming.socket.remoteAddress ?? 'UNKNOWN';
        if (input.proxy) {
          const supplied = incoming.headers['x-zhiban-proxy-token'];
          if (
            clientIp !== input.proxy.address ||
            typeof supplied !== 'string' ||
            supplied.length !== input.proxy.token.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(input.proxy.token)) ||
            typeof incoming.headers['x-zhiban-client-ip'] !== 'string' ||
            !isIP(incoming.headers['x-zhiban-client-ip'])
          ) {
            outgoing.writeHead(403);
            outgoing.end();
            return;
          }
          clientIp = incoming.headers['x-zhiban-client-ip'];
        }
        if (input.admit && !(await input.admit())) {
          outgoing.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '30' });
          outgoing.end();
          return;
        }
        const url = new URL(incoming.url!, origin);
        if (url.pathname === '/zhiban/health' && incoming.method === 'GET') {
          const ok = await input.health?.();
          outgoing.writeHead(ok ? 200 : 503, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          outgoing.end(JSON.stringify({ status: ok ? 'READY' : 'UNAVAILABLE' }));
          return;
        }
        if (/^\/zhiban\/native-assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
          const file = join(root, 'app/zhiban/local/native-assets', url.pathname.split('/').pop()!);
          try {
            const bytes = await readFile(file);
            outgoing.writeHead(200, {
              'Content-Type': file.endsWith('.woff2')
                ? 'font/woff2'
                : file.endsWith('.woff')
                  ? 'font/woff'
                  : file.endsWith('.svg')
                    ? 'image/svg+xml'
                    : 'application/octet-stream',
              'X-Content-Type-Options': 'nosniff',
            });
            outgoing.end(bytes);
          } catch {
            outgoing.writeHead(404);
            outgoing.end();
          }
          return;
        }
        if (
          [
            '/logo-horizontal.png',
            '/logo.png',
            '/logo-vertical.png',
            '/openmaic-mark.png',
          ].includes(url.pathname) ||
          /^\/(logos|avatars|agents|fonts)\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|gif|svg|woff2?|ttf)$/.test(
            url.pathname,
          )
        ) {
          if (incoming.method !== 'GET' || url.pathname.includes('..')) {
            outgoing.writeHead(404);
            outgoing.end();
            return;
          }
          try {
            const { realpath } = await import('node:fs/promises');
            const file = join(root, 'public', url.pathname);
            if ((await realpath(file)) !== file) throw Error('Not a regular public asset');
            const bytes = await readFile(file);
            const ext = file.split('.').pop()!;
            outgoing.writeHead(200, {
              'Content-Type': (
                {
                  png: 'image/png',
                  jpg: 'image/jpeg',
                  jpeg: 'image/jpeg',
                  webp: 'image/webp',
                  gif: 'image/gif',
                  svg: 'image/svg+xml',
                  woff: 'font/woff',
                  woff2: 'font/woff2',
                  ttf: 'font/ttf',
                } as Record<string, string>
              )[ext],
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; sandbox",
            });
            outgoing.end(bytes);
          } catch {
            outgoing.writeHead(404);
            outgoing.end();
          }
          return;
        }
        const assets: Record<string, [string, string]> = {
          '/zhiban/platform': ['platform.html', 'text/html'],
          '/zhiban/platform.js': ['platform.js', 'text/javascript'],
          '/zhiban/ui-environment.css': ['ui-environment.css', 'text/css'],
          '/zhiban/course-results': ['course-results.html', 'text/html'],
          '/zhiban/course-results.js': ['course-results.bundle.js', 'text/javascript'],
          '/zhiban/course-results.css': ['course-results.css', 'text/css'],
          '/zhiban/admin/services': ['admin-services.html', 'text/html'],
          '/zhiban/admin-services.js': ['admin-services.bundle.js', 'text/javascript'],
          '/zhiban/admin-services.css': ['admin-services.css', 'text/css'],
          '/zhiban/native-services': ['native-services.html', 'text/html'],
          '/zhiban/native-services.js': ['native-services.bundle.js', 'text/javascript'],
          '/zhiban/native-services.css': ['native-services.css', 'text/css'],
          '/zhiban/native-archive': ['native-archive.html', 'text/html'],
          '/zhiban/native-archive.js': ['native-archive.bundle.js', 'text/javascript'],
          '/zhiban/native-archive.css': ['native-archive.css', 'text/css'],
          '/zhiban/native-classroom': ['native-classroom.html', 'text/html'],
          '/zhiban/native-classroom.css': ['native-classroom.css', 'text/css'],
          '/zhiban/native-classroom.bundle.js': ['native-classroom.bundle.js', 'text/javascript'],
          '/zhiban/native-classroom.bundle.css': ['native-classroom.bundle.css', 'text/css'],
          '/zhiban/native-workbench': ['native-workbench.html', 'text/html'],
          '/zhiban/native-workbench.bundle.js': ['native-workbench.bundle.js', 'text/javascript'],
          '/zhiban/native-workbench.bundle.css': ['native-workbench.bundle.css', 'text/css'],
          '/zhiban/native-workbench.css': ['native-workbench.css', 'text/css'],
          '/zhiban/native-theme.css': ['native-theme.css', 'text/css'],
          '/zhiban/native-review': ['native-review.html', 'text/html'],
          '/zhiban/native-review.css': ['native-review.css', 'text/css'],
          '/zhiban/native-review.js': ['native-review.js', 'text/javascript'],
          '/zhiban/native-published': ['native-published.html', 'text/html'],
          '/zhiban/native-published.js': ['native-published.js', 'text/javascript'],

          '/zhiban': ['index.html', 'text/html'],
          ...(trial
            ? ({
                '/zhiban/grading': ['grading.html', 'text/html'],
                '/zhiban/final-grades.js': ['final-grades.js', 'text/javascript'],
                '/zhiban/gradebook.js': ['gradebook.js', 'text/javascript'],
                '/zhiban/grading.js': ['grading.js', 'text/javascript'],
                '/zhiban/content': [
                  contentHost ? 'content.html' : 'trial-content-closed.html',
                  'text/html',
                ],
                ...(contentHost
                  ? {
                      '/zhiban/content-client.js': ['@content-bundle', 'text/javascript'],
                      '/zhiban/content.css': ['content.css', 'text/css'],
                    }
                  : {}),
              } as Record<string, [string, string]>)
            : {}),
          '/zhiban/course-administration': ['course-administration.html', 'text/html'],
          '/zhiban/course-administration.js': ['course-administration.js', 'text/javascript'],
          '/zhiban/global-tools': ['global-tools.html', 'text/html'],
          '/zhiban/global-tools.js': ['global-tools.js', 'text/javascript'],
          '/zhiban/global-authoring': ['global-authoring.html', 'text/html'],
          '/zhiban/global-authoring.js': ['global-authoring.js', 'text/javascript'],
          '/zhiban/global-support': ['global-support.html', 'text/html'],
          '/zhiban/global-support.js': ['global-support.js', 'text/javascript'],
          '/zhiban/support-hub': ['support-hub.html', 'text/html'],
          '/zhiban/support-hub.js': ['support-hub.js', 'text/javascript'],
          '/zhiban/admin-entry': ['admin-entry.html', 'text/html'],
          '/zhiban/admin-entry.js': ['admin-entry.js', 'text/javascript'],
          '/zhiban/global-grades': ['global-grades.html', 'text/html'],
          '/zhiban/global-grades.js': ['global-grades.js', 'text/javascript'],
          '/zhiban/profile': ['profile.html', 'text/html'],
          ...(true
            ? {
                '/zhiban/export-player/player.min.js': ['@export/player.min.js', 'text/javascript'],
                '/zhiban/export-player/player-charts.min.js': [
                  '@export/player-charts.min.js',
                  'text/javascript',
                ],
                '/zhiban/export-player/katex-fonts.min.css': [
                  '@export/katex-fonts.min.css',
                  'text/css',
                ],
                '/zhiban/export-player/player.min.css': ['@export/player.min.css', 'text/css'],
              }
            : {}),
          ...(true
            ? {
                '/zhiban/admin/members': ['membership.html', 'text/html'],
                '/zhiban/join': ['membership.html', 'text/html'],
                '/zhiban/membership.js': ['membership.js', 'text/javascript'],
              }
            : {}),
          '/zhiban/attempt-runtime-page.js': ['attempt-runtime-page.js', 'text/javascript'],
          '/zhiban/published-player.js': ['published-player.js', 'text/javascript'],
          '/zhiban/published-player.css': ['published-player.css', 'text/css'],
          '/zhiban/profile.js': ['profile.js', 'text/javascript'],
          '/zhiban/client.js': ['client.js', 'text/javascript'],
          '/zhiban/academic.js': ['academic.js', 'text/javascript'],
          '/zhiban/learning.js': ['learning.js', 'text/javascript'],
          '/zhiban/discussion.js': ['discussion.js', 'text/javascript'],
          '/zhiban/quiz-client.js': ['quiz-client.js', 'text/javascript'],
          '/zhiban/quiz.css': ['quiz.css', 'text/css'],
          '/zhiban/classrooms.js': ['classrooms.js', 'text/javascript'],
          '/zhiban/curriculum.js': ['curriculum.js', 'text/javascript'],
          '/zhiban/assessment.js': ['assessment.js', 'text/javascript'],
          '/zhiban/style.css': ['style.css', 'text/css'],
          '/zhiban/management': ['management.html', 'text/html'],
          '/zhiban/management-catalog.js': ['management-catalog.js', 'text/javascript'],
          '/zhiban/management.js': ['management.js', 'text/javascript'],
          '/zhiban/management-page.js': ['management-page.js', 'text/javascript'],
          '/zhiban/admin-shell.js': ['admin-shell.js', 'text/javascript'],
          '/zhiban/lesson.js': ['lesson.js', 'text/javascript'],
          '/zhiban/lesson.css': ['lesson.css', 'text/css'],
          '/zhiban/course-page.js': ['course-page.js', 'text/javascript'],
          '/zhiban/workspace.js': ['workspace.js', 'text/javascript'],
          '/zhiban/workspace.css': ['workspace.css', 'text/css'],
          '/zhiban/relationships': ['relationships.html', 'text/html'],
          '/zhiban/relationships.js': ['relationships.js', 'text/javascript'],
          '/zhiban/relationships.css': ['relationships.css', 'text/css'],
          '/zhiban/management.css': ['management.css', 'text/css'],
          '/zhiban/directory': ['directory.html', 'text/html'],
          '/zhiban/directory.js': ['directory.js', 'text/javascript'],
          '/zhiban/directory-page.js': ['directory-page.js', 'text/javascript'],
          '/zhiban/directory.css': ['directory.css', 'text/css'],
          '/zhiban/admin/import': ['imports.html', 'text/html'],
          '/zhiban/admin/import/classes': ['imports.html', 'text/html'],
          '/zhiban/admin/import/students': ['imports.html', 'text/html'],
          '/zhiban/admin/import/registrations': ['imports.html', 'text/html'],
          '/zhiban/imports.js': ['imports.js', 'text/javascript'],
          '/zhiban/roster': ['roster.html', 'text/html'],
          '/zhiban/roster.js': ['roster.js', 'text/javascript'],
          '/zhiban/roster.css': ['roster.css', 'text/css'],
          '/zhiban/roster-template.csv': ['roster-template.csv', 'text/csv'],
          '/zhiban/login-identifiers': ['login-identifiers.html', 'text/html'],
          '/zhiban/login-identifiers.js': ['login-identifiers.js', 'text/javascript'],
          '/zhiban/admin/onboarding': ['onboarding.html', 'text/html'],
          '/zhiban/onboarding.js': ['onboarding.js', 'text/javascript'],
          '/zhiban/onboarding.css': ['onboarding.css', 'text/css'],
          '/zhiban/activate-account': ['account-setup.html', 'text/html'],
          '/zhiban/account-setup.js': ['account-setup.js', 'text/javascript'],
          '/zhiban/attainment': ['attainment.html', 'text/html'],
          '/zhiban/attainment.js': ['attainment.js', 'text/javascript'],
          '/zhiban/attainment.css': ['attainment.css', 'text/css'],
          '/zhiban/auto-grading': ['auto-grading.html', 'text/html'],
          '/zhiban/auto-grading.js': ['auto-grading.js', 'text/javascript'],
          '/zhiban/ema': ['ema.html', 'text/html'],
          '/zhiban/ema.js': ['ema.js', 'text/javascript'],
          '/zhiban/ema.css': ['ema.css', 'text/css'],
          '/zhiban/pbl-entry': ['pbl-entry.html', 'text/html'],
          '/zhiban/pbl': ['pbl.html', 'text/html'],
          '/zhiban/pbl.js': ['pbl.js', 'text/javascript'],
          '/zhiban/pbl.css': ['pbl.css', 'text/css'],
          '/zhiban/flow': ['flow.html', 'text/html'],
          '/zhiban/flow.js': ['flow.js', 'text/javascript'],
          '/zhiban/flow.css': ['flow.css', 'text/css'],
          '/zhiban/tutor': ['tutor.html', 'text/html'],
          '/zhiban/tutor.js': ['tutor.js', 'text/javascript'],
          '/zhiban/tutor.css': ['tutor.css', 'text/css'],
          '/zhiban/learning-profile': ['learning-profile.html', 'text/html'],
          '/zhiban/learning-profile.js': ['learning-profile.js', 'text/javascript'],
          '/zhiban/learning-profile.css': ['learning-profile.css', 'text/css'],
          '/zhiban/concepts': ['concepts.html', 'text/html'],
          '/zhiban/concepts.js': ['concepts.js', 'text/javascript'],
          '/zhiban/concepts.css': ['concepts.css', 'text/css'],
          '/zhiban/risk': ['risk.html', 'text/html'],
          '/zhiban/risk.js': ['risk.js', 'text/javascript'],
          '/zhiban/risk.css': ['risk.css', 'text/css'],
          '/zhiban/remediation': ['remediation.html', 'text/html'],
          '/zhiban/remediation.js': ['remediation.js', 'text/javascript'],
          '/zhiban/remediation.css': ['remediation.css', 'text/css'],
          '/zhiban/reminders': ['reminders.html', 'text/html'],
          '/zhiban/reminders.js': ['reminders.js', 'text/javascript'],
          '/zhiban/reminders.css': ['reminders.css', 'text/css'],
          '/zhiban/progress': ['progress.html', 'text/html'],
          '/zhiban/progress.js': ['progress.js', 'text/javascript'],
          '/zhiban/progress.css': ['progress.css', 'text/css'],
          '/zhiban/analytics': ['analytics.html', 'text/html'],
          '/zhiban/analytics.js': ['analytics.js', 'text/javascript'],
          '/zhiban/analytics.css': ['analytics.css', 'text/css'],
        };
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
        const videoVendor =
          /^\/vendor\/(?:gsap\.min\.js|video-export\/fonts\/[a-zA-Z0-9_.-]+\.woff2)$/.test(
            assetKey,
          );
        const interactiveVendor = interactiveVendorAsset(assetKey);
        const pageAsset =
          assets[assetKey] ??
          (interactiveVendor
            ? ['@interactive-vendor/' + interactiveVendor.path, interactiveVendor.type]
            : undefined) ??
          (videoVendor
            ? [
                '@video-vendor/' + assetKey.slice(8),
                assetKey.endsWith('.js') ? 'text/javascript' : 'font/woff2',
              ]
            : undefined);
        if (pageAsset) {
          const [file, type] = pageAsset;
          if (incoming.method !== 'GET') {
            outgoing.writeHead(405);
            outgoing.end();
            return;
          }
          let bytes = await readFile(
            file === '@content-bundle'
              ? contentHost!.bundlePath
              : file.startsWith('@interactive-vendor/')
                ? join(root, 'public/vendor/interactive', file.slice(20))
                : file.startsWith('@video-vendor/')
                  ? join(root, 'public/vendor', file.slice(14))
                  : file.startsWith('@export/')
                    ? join(root, 'public/vendor/standalone-player', file.slice(8))
                    : join(root, 'app/zhiban/local', file),
          );
          outgoing.writeHead(200, {
            'Content-Type': type + '; charset=utf-8',
            ...(interactiveVendor ? { 'Access-Control-Allow-Origin': '*' } : {}),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
              assetKey === '/zhiban/native-archive'
                ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
                : [
                      '/zhiban/course-results',
                      '/zhiban/admin/services',
                      '/zhiban/native-services',
                      '/zhiban/native-workbench',
                      '/zhiban/native-archive',
                      '/zhiban/native-classroom',
                      '/zhiban/native-published',
                    ].includes(assetKey)
                  ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
                  : assetKey === '/zhiban/content' && contentHost
                    ? contentHost.csp
                    : [
                          'index.html',
                          'profile.html',
                          'global-grades.html',
                          'global-support.html',
                          'global-authoring.html',
                          'global-tools.html',
                          'attainment.html',
                        ].includes(file)
                      ? "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
                      : "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            'Referrer-Policy': [
              '/zhiban/course-results',
              '/zhiban/admin/services',
              '/zhiban/native-services',
              '/zhiban/native-workbench',
              '/zhiban/native-archive',
              '/zhiban/native-published',
              '/zhiban/native-classroom',
            ].includes(assetKey)
              ? 'same-origin'
              : 'no-referrer',
          });
          if (sharedClassroom && type === 'text/html')
            bytes = Buffer.from(
              bytes
                .toString()
                .replace('</head>', '<script src="/zhiban/classrooms.js"></script></head>'),
            );
          if (type === 'text/html')
            bytes = Buffer.from(presentUiHtml(bytes.toString(), presentationEnvironment));
          outgoing.end(bytes);
          return;
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(incoming.headers))
          if (
            v &&
            ![
              'host',
              'connection',
              'content-length',
              'transfer-encoding',
              'x-zhiban-proxy-token',
            ].includes(k)
          )
            headers.set(k, Array.isArray(v) ? v.join(',') : v);
        headers.set('x-zhiban-client-ip', clientIp);
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of incoming) {
          size += part.length;
          if (
            size >
            (url.pathname.startsWith('/api/zhiban/classroom-ai/')
              ? 5242880
              : url.pathname.startsWith('/api/zhiban/authoring/')
                ? url.pathname.includes('/archive/')
                  ? 67108864
                  : 33554432
                : contentHost && /\/assets$/.test(url.pathname) && incoming.method === 'POST'
                  ? 4194304
                  : contentHost && url.pathname.startsWith('/api/zhiban/content/')
                    ? 262144
                    : url.pathname.startsWith('/api/zhiban/flow/') ||
                        url.pathname.startsWith('/api/zhiban/pbl/')
                      ? 65536
                      : url.pathname.startsWith('/api/zhiban/imports/')
                        ? 131072
                        : attachments &&
                            /^\/api\/zhiban\/learning\/[0-9a-f-]{36}\/offerings\/[0-9a-f-]{36}$/.test(
                              url.pathname,
                            )
                          ? 1750000
                          : 32768)
          ) {
            outgoing.writeHead(413);
            outgoing.end();
            return;
          }
          parts.push(Buffer.from(part));
        }
        if (['GET', 'HEAD'].includes(incoming.method ?? '') && size) {
          outgoing.writeHead(400);
          outgoing.end();
          return;
        }
        const request = new Request(url, {
          method: incoming.method,
          headers,
          signal: abort.signal,
          ...(!['GET', 'HEAD'].includes(incoming.method ?? '')
            ? { body: Buffer.concat(parts) }
            : {}),
        });
        const r = url.pathname.startsWith('/api/zhiban/platform')
          ? await httpPlatform(request)
          : httpClassroomAi && url.pathname.startsWith('/api/zhiban/classroom-ai/')
            ? await httpClassroomAi(request)
            : httpNativeAuthoring && url.pathname.startsWith('/api/zhiban/authoring/')
              ? await httpNativeAuthoring(request)
              : url.pathname.startsWith('/api/zhiban/attainment/')
                ? await httpAttainment(request)
                : httpAutograde && url.pathname.startsWith('/api/zhiban/autograde/')
                  ? await httpAutograde(request)
                  : url.pathname.startsWith('/api/zhiban/ema/')
                    ? await httpEma(request)
                    : url.pathname.startsWith('/api/zhiban/pbl/')
                      ? await httpPbl(request)
                      : url.pathname.startsWith('/api/zhiban/flow/')
                        ? await httpFlow(request)
                        : contentHost && url.pathname.startsWith('/api/zhiban/content/')
                          ? await contentHost.http(request)
                          : url.pathname.startsWith('/api/zhiban/imports/')
                            ? await httpImports(request)
                            : url.pathname.startsWith('/api/zhiban/login-identifiers/')
                              ? await httpLoginIdentifiers(
                                  request,
                                  incoming.socket.remoteAddress ?? 'UNKNOWN',
                                )
                              : url.pathname.startsWith('/api/zhiban/materials/')
                                ? await httpMaterial(request)
                                : url.pathname.startsWith('/api/zhiban/profile/')
                                  ? await httpProfile(request)
                                  : url.pathname.startsWith('/api/zhiban/workspace/')
                                    ? await httpWorkspace(request)
                                    : url.pathname.startsWith('/api/zhiban/course-results/') &&
                                        httpCourseResults
                                      ? await httpCourseResults(request)
                                      : url.pathname.startsWith('/api/zhiban/service-center/') &&
                                          httpServices
                                        ? await httpServices(request)
                                        : url.pathname.startsWith('/api/zhiban/management/')
                                          ? await httpManagement(request)
                                          : url.pathname.startsWith('/api/zhiban/directory/')
                                            ? await httpDirectory(request)
                                            : url.pathname.startsWith('/api/zhiban/roster/')
                                              ? await httpRoster(request)
                                              : url.pathname === '/api/zhiban/onboarding/claim'
                                                ? await httpAccountSetup(
                                                    request,
                                                    incoming.socket.remoteAddress ?? 'UNKNOWN',
                                                  )
                                                : url.pathname.startsWith('/api/zhiban/onboarding/')
                                                  ? await httpAccountRequests(request)
                                                  : url.pathname.startsWith('/api/zhiban/tutor/') &&
                                                      httpTutor
                                                    ? await httpTutor(request)
                                                    : url.pathname.startsWith(
                                                          '/api/zhiban/learner/',
                                                        )
                                                      ? await httpLearner(request)
                                                      : url.pathname.startsWith(
                                                            '/api/zhiban/concept/',
                                                          )
                                                        ? await httpConcept(request)
                                                        : url.pathname.startsWith(
                                                              '/api/zhiban/risk/',
                                                            )
                                                          ? await httpRisk(request)
                                                          : url.pathname.startsWith(
                                                                '/api/zhiban/remediation/',
                                                              )
                                                            ? await httpRemediation(request)
                                                            : url.pathname.startsWith(
                                                                  '/api/zhiban/reminders/',
                                                                )
                                                              ? await httpReminders(request)
                                                              : url.pathname.startsWith(
                                                                    '/api/zhiban/progress/',
                                                                  )
                                                                ? await httpProgress(request)
                                                                : url.pathname.startsWith(
                                                                      '/api/zhiban/analytics/',
                                                                    )
                                                                  ? await httpAnalytics(request)
                                                                  : url.pathname.startsWith(
                                                                        '/api/zhiban/academic/',
                                                                      )
                                                                    ? await httpAcademic(request)
                                                                    : url.pathname.startsWith(
                                                                          '/api/zhiban/learning/',
                                                                        )
                                                                      ? await httpLearning(request)
                                                                      : url.pathname.startsWith(
                                                                            '/api/zhiban/assessment/',
                                                                          )
                                                                        ? await httpAssessment(
                                                                            request,
                                                                          )
                                                                        : url.pathname.startsWith(
                                                                              '/api/zhiban/identity/',
                                                                            )
                                                                          ? await facade.handle(
                                                                              request,
                                                                            )
                                                                          : new Response(null, {
                                                                              status: 404,
                                                                            });
        outgoing.writeHead(r.status, Object.fromEntries(r.headers));
        if (r.body) {
          const reader = r.body.getReader();
          const cancel = () => {
            void reader.cancel().catch(() => {});
          };
          outgoing.once('close', cancel);
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              await new Promise<void>((yes, no) =>
                outgoing.write(Buffer.from(part.value), (e) => (e ? no(e) : yes())),
              );
            }
          } finally {
            outgoing.removeListener('close', cancel);
            await reader.cancel().catch(() => {});
          }
        }
        outgoing.end();
      } catch {
        if (outgoing.headersSent) outgoing.destroy();
        else {
          outgoing.writeHead(503);
          outgoing.end();
        }
      }
    },
  );
  server.requestTimeout = 180000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  await new Promise<void>((done, reject) => {
    server!.once('error', reject);
    server!.listen(input.port, input.address, done);
  });
  return {
    server,
    close: async () => {
      server.closeIdleConnections();
      await new Promise<void>((done) => {
        server.close(() => done());
        setTimeout(() => server.closeAllConnections(), 5000).unref();
      });
    },
  };
}
