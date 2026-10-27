import { localPgMajor, pg18Origin, validInstallationEvidence } from './pg-version';
const unifiedTrial = process.argv.includes('--unified-trial');
/** Local trial status/stop only. Never prints passwords or signals an unbound process. */
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const trustedFiles = process.argv.includes('--trusted-files');
const attachments = trustedFiles || process.argv.includes('--submission-files');
const gradebookCsv = process.argv.includes('--gradebook-csv');
const gradebook = gradebookCsv || process.argv.includes('--gradebook');
const classroomEdit = process.argv.includes('--classroom-edit');
const classroom = classroomEdit || process.argv.includes('--classroom');
const content = unifiedTrial || process.argv.includes('--content');
const prefix = unifiedTrial
  ? 'trial:zhiban'
  : trustedFiles
    ? 'trial:zhiban:trusted-files'
    : attachments
      ? 'trial:zhiban:submission-files'
      : gradebookCsv
        ? 'trial:zhiban:gradebook-csv'
        : gradebook
          ? 'trial:zhiban:gradebook'
          : classroomEdit
            ? 'trial:zhiban:classroom-edit'
            : classroom
              ? 'trial:zhiban:classroom'
              : content
                ? 'trial:zhiban:content'
                : 'trial:zhiban:legacy';
const metadata =
  localPgMajor === 18
    ? resolve('docs/v2/evidence/zhiban-pg18-demo-local.json')
    : resolve(
        `docs/v2/evidence/${trustedFiles ? 'zhiban-trusted-files' : attachments ? 'zhiban-submission-files' : gradebookCsv ? 'zhiban-gradebook-csv' : gradebook ? 'zhiban-gradebook' : classroomEdit ? 'zhiban-classroom-edit' : classroom ? 'zhiban-shared-classroom' : content ? 'zhiban-trial-content' : 'zhiban-trial'}-demo-local.json`,
      );
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
async function privatePath(path: string, directory = false) {
  const s = await lstat(path);
  check(
    !s.isSymbolicLink() &&
      s.uid === process.getuid?.() &&
      (s.mode & 0o077) === 0 &&
      (directory ? s.isDirectory() : s.isFile()),
    'Trial file ownership or permissions rejected.',
  );
}
async function main() {
  const action = process.argv[2];
  check(
    ['info', 'stop'].includes(action) &&
      (process.argv.length === 3 ||
        (process.argv.length === 4 &&
          [
            '--content',
            '--legacy',
            '--classroom',
            '--classroom-edit',
            '--gradebook',
            '--gradebook-csv',
            '--submission-files',
            '--trusted-files',
            '--unified-trial',
          ].includes(process.argv[3]))),
    'Use trial:zhiban:content:info / trial:zhiban:content:stop, or trial:zhiban:legacy:info / trial:zhiban:legacy:stop.',
  );
  const m = JSON.parse(await readFile(metadata, 'utf8')) as {
    evidenceOrigin: string;
    githubActions: boolean;
    pid: number;
    processStart: string;
    root: string;
    origin: string;
    port: number;
    database: string;
    accountsPath: string;
    baselineHead: string;
    sourceHashes: Record<string, string>;
    trial: { urls: Record<string, string> };
  };
  check(
    validInstallationEvidence(m) &&
      m.origin ===
        (localPgMajor === 18
          ? pg18Origin
          : trustedFiles
            ? 'https://127.0.0.1:3467'
            : attachments
              ? 'https://127.0.0.1:3466'
              : gradebookCsv
                ? 'https://127.0.0.1:3465'
                : gradebook
                  ? 'https://127.0.0.1:3464'
                  : classroomEdit
                    ? 'https://127.0.0.1:3463'
                    : classroom
                      ? 'https://127.0.0.1:3462'
                      : content
                        ? 'https://127.0.0.1:3461'
                        : 'https://127.0.0.1:3459') &&
      m.port ===
        (trustedFiles
          ? 56523
          : attachments
            ? 56522
            : gradebookCsv
              ? 56521
              : gradebook
                ? 56520
                : classroomEdit
                  ? 56519
                  : classroom
                    ? 56518
                    : content
                      ? 56517
                      : 56515) &&
      m.database ===
        (trustedFiles
          ? 'zhiban_trusted_files_disposable'
          : attachments
            ? 'zhiban_submission_files_disposable'
            : gradebookCsv
              ? 'zhiban_gradebook_csv_disposable'
              : gradebook
                ? 'zhiban_gradebook_disposable'
                : classroomEdit
                  ? 'zhiban_classroom_edit_disposable'
                  : classroom
                    ? 'zhiban_shared_classroom_disposable'
                    : content
                      ? 'zhiban_trial_content_disposable'
                      : 'zhiban_trial_disposable'),
    'Trial endpoint identity rejected.',
  );
  check(
    Number.isInteger(m.pid) && m.pid > 1 && /^\d+$/.test(m.processStart),
    'Trial process identity rejected.',
  );
  check(
    dirname(m.root) === tmpdir() &&
      m.root.startsWith(
        join(
          tmpdir(),
          trustedFiles
            ? 'zhiban-trusted-files-'
            : attachments
              ? 'zhiban-submission-files-'
              : gradebookCsv
                ? 'zhiban-gradebook-csv-'
                : gradebook
                  ? 'zhiban-gradebook-'
                  : classroomEdit
                    ? 'zhiban-classroom-edit-'
                    : classroom
                      ? 'zhiban-shared-classroom-'
                      : 'zhiban-trial-',
        ),
      ) &&
      m.accountsPath === join(m.root, 'accounts.json'),
    'Trial root rejected.',
  );
  let args: string[], start: string;
  try {
    args = (await readFile(`/proc/${m.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    start = (await readFile(`/proc/${m.pid}/stat`, 'utf8')).split(') ')[1].trim().split(/\s+/)[19];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`STOPPED — trial process is no longer running. Start with pnpm ${prefix}.`);
      return;
    }
    throw e;
  }
  check(
    start === m.processStart &&
      args[1]?.startsWith(resolve('.zhiban-catalog-run-')) &&
      args[1].endsWith('/verify.mjs') &&
      JSON.stringify(
        args
          .slice(2)
          .filter(
            (v) =>
              !['--persistent', '--resume', '--upgrade-resources', '--upgrade-local'].includes(v),
          )
          .sort(),
      ) ===
        JSON.stringify(
          unifiedTrial
            ? args.includes('--teacher-scope')
              ? ['--serve', '--teacher-scope', '--unified-trial']
              : ['--serve', '--unified-trial']
            : trustedFiles
              ? ['--serve', '--trusted-files']
              : attachments
                ? ['--serve', '--submission-files']
                : gradebookCsv
                  ? ['--gradebook-csv', '--serve']
                  : gradebook
                    ? ['--gradebook', '--serve']
                    : classroomEdit
                      ? ['--classroom-edit', '--serve']
                      : classroom
                        ? ['--serve', '--shared-classroom']
                        : content
                          ? ['--serve', '--trial-content']
                          : ['--serve', '--trial'],
        ),
    'Refused: PID is not the recorded trial process.',
  );
  check(
    createHash('sha256')
      .update(await readFile(args[1]))
      .digest('hex') === m.sourceHashes[args[1]],
    'Trial build binding rejected.',
  );
  await privatePath(m.root, true);
  await privatePath(m.accountsPath);
  if (action === 'stop') {
    process.kill(m.pid, 'SIGTERM');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        process.kill(m.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
          console.log(
            `STOPPED — HTTPS exited; see ${trustedFiles ? 'zhiban-trusted-files' : attachments ? 'zhiban-submission-files' : gradebookCsv ? 'zhiban-gradebook-csv' : gradebook ? 'zhiban-gradebook' : classroomEdit ? 'zhiban-classroom-edit' : classroom ? 'zhiban-shared-classroom' : content ? 'zhiban-trial-content' : 'zhiban-trial'}-demo-close-local.json for owned PG/root cleanup.`,
          );
          return;
        }
        throw e;
      }
    }
    throw new Error(
      'Shutdown requested; process has not exited yet. Inspect the launcher terminal.',
    );
  }
  const a = JSON.parse(await readFile(m.accountsPath, 'utf8')) as {
    accounts: { label: string; role: string; userId: string }[];
  };
  const drift: string[] = [];
  for (const [p, h] of Object.entries(m.sourceHashes)) {
    try {
      if (
        createHash('sha256')
          .update(await readFile(p))
          .digest('hex') !== h
      )
        drift.push(p);
    } catch {
      drift.push(p);
    }
  }
  console.log(
    JSON.stringify(
      {
        status: args.includes('--persistent')
          ? 'RUNNING_LOCAL_PERSISTENT'
          : 'RUNNING_LOCAL_DISPOSABLE',
        baselineHead: m.baselineHead,
        sourceMatches: drift.length === 0,
        sourceDriftCount: drift.length,
        urls: m.trial.urls,
        accounts: a.accounts.map(({ label, role, userId }) => ({ label, role, userId })),
        privateAccountsFile: m.accountsPath,
        rosterExample: join(m.root, 'roster-example.csv'),
        stop: `pnpm ${prefix}:stop`,
        dataLifetime: args.includes('--persistent')
          ? 'Stop saves an owner-only PG16 snapshot; next persistent start retains data and accounts.'
          : 'Stop removes this owned cluster; restart creates new synthetic data and passwords.',
      },
      null,
      2,
    ),
  );
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Trial control failed.');
  process.exitCode = 1;
});
