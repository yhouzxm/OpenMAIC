import { Pool } from 'pg';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { contentHttp } from '@/lib/zhiban/infrastructure/content/http';
import { privateFile, directory } from './config';
import { readContentConfiguration, validateContentInstallation } from './content-receipt';
import { pngMode } from './png-receipt';
export async function loadContent(security: IdentityAuthentication, origin: string) {
  try {
    await privateFile('content.json');
  } catch (e) {
    if ((e as any).code === 'ENOENT') return null;
    throw e;
  }
  const { config, receipt } = await readContentConfiguration();
  const options = {
    max: 3,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
  };
  const bridge = new Pool({ connectionString: config.bridge, ...options }),
    native = new Pool({ connectionString: config.native, ...options });
  try {
    await validateContentInstallation(bridge, native, receipt, config);
    return Object.assign(
      contentHttp(
        new ContentService(
          bridge,
          native,
          security,
          config.deploymentId,
          (record) => {
            void appendFile(
              join(directory, 'content-operations.jsonl'),
              JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n',
              { mode: 0o600 },
            ).catch(() => {}); // Durable audit is in PG; diagnostic I/O must not crash the host.
          },
          config.mode === pngMode,
        ),
        security,
        origin,
      ),
      { pngEnabled: config.mode === pngMode },
    );
  } catch (e) {
    await Promise.all([bridge.end(), native.end()]);
    throw e;
  }
}
