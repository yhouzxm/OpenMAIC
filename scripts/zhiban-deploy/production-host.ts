import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
/** Prebuilt runtime entry. No bundler, installer, fixture, or schema apply at service startup. */
import { parseEnv } from 'node:util';
import {
  privateBytes,
  privateJson,
  check,
  digest,
} from '@/lib/zhiban/infrastructure/production/files';
import type { RuntimeInput } from '@/lib/zhiban/infrastructure/production/deployment';
import {
  hostControl,
  noMaintenance,
  hostRequest,
  waitHostReady,
} from '@/lib/zhiban/infrastructure/production/maintenance';
export async function runHost(runtimeFile: string) {
  check(process.getuid?.() !== 0, 'HOST_REQUIRES_NON_ROOT_USER');
  const config = await privateJson<RuntimeInput>(runtimeFile);
  await noMaintenance(config.stateDirectory);
  check(config.serviceEnvironment, 'FORMAL_HOST_EXPLICIT_SERVICE_ENVIRONMENT_REQUIRED');
  if (config.serviceEnvironment) {
    const bytes = await privateBytes(config.serviceEnvironment.file);
    check(digest(bytes) === config.serviceEnvironment.pin, 'SERVICE_ENVIRONMENT_PIN_REJECTED');
    const vars = parseEnv(bytes.toString());
    for (const [name, value] of Object.entries(vars)) {
      check(
        /^[A-Z][A-Z0-9_]*$/.test(name) &&
          !/^(NODE_|LD_|PG|DATABASE_|ZHIBAN_|PERSISTENCE_|OWNER_|TRUST_)/.test(name) &&
          ![
            'NODE_OPTIONS',
            'NODE_PATH',
            'PATH',
            'HOME',
            'LD_PRELOAD',
            'LD_LIBRARY_PATH',
            'DATABASE_URL',
            'OPENMAIC_SECRET_KEY',
          ].includes(name),
        'UNSAFE_SERVICE_ENVIRONMENT',
      );
      process.env[name] = value;
    }
  }
  check(
    process.env.OPENMAIC_CONFIG &&
      Object.hasOwn(config.serviceEnvironment.files, process.env.OPENMAIC_CONFIG),
    'FORMAL_HOST_CONFIG_FILE_MUST_BE_IN_PRIVATE_CLOSURE',
  );
  const media =
    process.env.OPENMAIC_CLASSROOMS_DIR ??
    join(config.stateDirectory, 'data/native-classroom-media');
  check(
    resolve(media).startsWith(config.stateDirectory + '/data/'),
    'FORMAL_HOST_MEDIA_OUTSIDE_BACKUP_ROOT',
  );
  await mkdir(media, { recursive: true, mode: 0o700 });
  process.env.OPENMAIC_CLASSROOMS_DIR = media;
  check(!process.env.OPENMAIC_SECRET_KEY, 'FORMAL_HOST_REQUIRES_RECOVERABLE_INSTANCE_KEY_FILE');
  const { startInstalled } = await import('@/lib/zhiban/infrastructure/production/runtime');
  const app = await startInstalled(runtimeFile);
  let resolveStop!: () => void;
  const stopped = new Promise<void>((r) => (resolveStop = r));
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= (async () => {
      try {
        await app.close();
      } finally {
        resolveStop();
      }
    })());
  let control: Awaited<ReturnType<typeof hostControl>> | undefined;
  const signal = () =>
    void stop().catch(() => {
      process.exitCode = 1;
    });
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    await noMaintenance(config.stateDirectory);
    control = await hostControl(config.stateDirectory, config.instanceId, stop, app.health);
    console.log(JSON.stringify({ status: 'READY', origin: app.origin }));
    await Promise.race([
      stopped,
      app.failure.then(async () => {
        process.exitCode = 1;
        await stop();
      }),
    ]);
    await closing;
  } finally {
    process.removeListener('SIGTERM', signal);
    process.removeListener('SIGINT', signal);
    await control?.close();
    await stop();
  }
}
// The build defines this flag only for the standalone service artifact.
if (process.env.ZHIBAN_BUILT_HOST_ENTRY === 'true')
  void (async () => {
    const op = process.argv[2];
    if (op === '--ready' || op === '--stop') {
      const config = await privateJson<RuntimeInput>(process.argv[3]);
      if (op === '--ready') await waitHostReady(config.stateDirectory, config.instanceId);
      else await hostRequest(config.stateDirectory, 'stop', process.getuid?.(), config.instanceId);
    } else await runHost(op);
  })().catch((error) => {
    console.error('HOST_START_OR_DRAIN_REFUSED');
    process.exitCode = error?.message === 'INSTANCE_IN_MAINTENANCE' ? 78 : 1;
  });
