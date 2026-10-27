/** Offline operator diagnostic: parses config/credential presence, never probes providers or prints secrets. */
import { lstat, readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { providerEnvironment } from '../../lib/zhiban/infrastructure/authoring/media/environment';
import { loadModelConfigFile } from '../../lib/server/model-config/openmaic-yml';
import { resolveSlot } from '../../lib/server/model-config/resolve-slot';
async function privateFile(path: string) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.mode & 0o077)
    throw Error('Private configuration required');
  return readFile(path);
}
async function main() {
  const env = await lstat('.env.local').catch(() => null);
  if (env) {
    const values = providerEnvironment(parseEnv((await privateFile('.env.local')).toString()));
    for (const [key, value] of Object.entries(values))
      if (!process.env[key]) process.env[key] = value;
  }
  const option = process.argv.slice(2);
  if (option.length) {
    if (option.length !== 2 || option[0] !== '--config' || !isAbsolute(option[1]))
      throw Error('Absolute --config required');
    process.env.OPENMAIC_CONFIG = option[1];
  }
  const path = resolve(process.env.OPENMAIC_CONFIG ?? 'openmaic.yml'),
    raw = await privateFile(path),
    services: Record<string, unknown> = {};
  const config = loadModelConfigFile();
  if (!config) throw Error('Configuration required');
  for (const k of ['image', 'video', 'tts', 'asr', 'document'] as const) {
    const c = resolveSlot(k, [{ source: 'deployment', config }]);
    services[k] = {
      state:
        c.status === 'disabled'
          ? 'DISABLED'
          : c.status === 'unassigned'
            ? 'UNCONFIGURED'
            : 'CONFIGURED_NOT_VERIFIED',
      ...(c.status === 'assigned' ? { provider: c.registryId } : {}),
      realCallVerified: false,
    };
  }
  console.log(
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        scope: 'OFFLINE_CONFIGURATION_ONLY_NO_PROVIDER_CALLS',
        configSha256: createHash('sha256').update(raw).digest('hex'),
        services,

        localExtractors: ['plain-text', 'unpdf'],
        realExternalServicesVerified: false,
      },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    '配置检查未通过：请在本机核对私有文件权限、原生配置字段和环境变量引用；未调用外部服务。',
  );
  process.exitCode = 1;
});
