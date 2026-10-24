// Exact approved ordinary HBA descriptor; no HBA writes/reload or credential rotation.
const { ROLE } = require('./release-contract.cjs');
const rules = () =>
  [
    {
      type: 'local',
      database: 'postgres',
      role: 'postgres',
      address: null,
      netmask: null,
      method: 'scram-sha-256',
    },
    ...ROLE.map((role) => ({
      type: 'host',
      database: role === 'zhiban_openmaic_runtime' ? 'zhiban_m5_native' : 'zhiban_m1_dev',
      role,
      address: '127.0.0.1',
      netmask: '255.255.255.255',
      method: 'scram-sha-256',
    })),
    ...[
      { type: 'local', database: 'all', role: 'all', address: null, netmask: null },
      { type: 'local', database: 'replication', role: 'all', address: null, netmask: null },
      { type: 'host', database: 'all', role: 'all', address: '0.0.0.0', netmask: '0.0.0.0' },
      { type: 'host', database: 'all', role: 'all', address: '::', netmask: '::' },
      {
        type: 'host',
        database: 'replication',
        role: 'all',
        address: '0.0.0.0',
        netmask: '0.0.0.0',
      },
      { type: 'host', database: 'replication', role: 'all', address: '::', netmask: '::' },
    ].map((x) => ({ ...x, method: 'reject' })),
  ].map((x) => ({ ...x, options: null, error: null }));
const text = () =>
  rules()
    .map((r) =>
      r.type === 'local'
        ? `local ${r.database} ${r.role} ${r.method}`
        : `host ${r.database} ${r.role} ${r.address}/${r.netmask === '255.255.255.255' ? '32' : '0'} ${r.method}`,
    )
    .join('\n') + '\n';
module.exports = { rules, text };
