/** Generate reviewable Ubuntu files only; never executes systemctl, creates users, or edits /etc. */
import { writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import {
  privateJson,
  privateBytes,
  check,
  digest,
} from '@/lib/zhiban/infrastructure/production/files';
import { loadRuntime } from '@/lib/zhiban/infrastructure/production/deployment';
export interface UbuntuSpec {
  kind: 'ZHIBAN_UBUNTU_HOST_V1';
  runtimeFile: string;
  operationsFile: string;
  releaseDirectory: string;
  nodeBinary: string;
  serviceUser: string;
  serviceGroup: string;
  serviceUid: number;
  serviceGid: number;
  temporaryDirectory: string;
  publicCertificateFile?: string;
  publicPrivateKeyFile?: string;
  upstreamCaFile: string;
  expectedExistingFiles?: Readonly<Record<string, string>>;
}
const safePath = (p: string) =>
  check(
    isAbsolute(p) && /^\/[A-Za-z0-9_./-]+$/.test(p) && !p.split('/').includes('..'),
    'UBUNTU_CANONICAL_SIMPLE_PATH_REQUIRED',
  );
export async function renderUbuntu(specFile: string, output: string) {
  const s = await privateJson<UbuntuSpec>(specFile);
  check(s.kind === 'ZHIBAN_UBUNTU_HOST_V1', 'UBUNTU_SPEC_REJECTED');
  for (const p of [
    s.runtimeFile,
    s.operationsFile,
    s.releaseDirectory,
    s.nodeBinary,
    s.temporaryDirectory,
    s.upstreamCaFile,
    output,
  ])
    safePath(p);
  check(
    ![s.nodeBinary, s.releaseDirectory, s.runtimeFile].some(
      (p) => p.startsWith('/home/') || p.startsWith('/root/'),
    ),
    'UBUNTU_SERVICE_PATH_HIDDEN_BY_PROTECT_HOME',
  );
  for (const n of [s.serviceUser, s.serviceGroup])
    check(/^[a-z][a-z0-9_-]{0,30}$/.test(n), 'UBUNTU_SERVICE_NAME_REJECTED');
  check(
    s.serviceUid > 0 &&
      Number.isInteger(s.serviceUid) &&
      s.serviceGid > 0 &&
      Number.isInteger(s.serviceGid),
    'UBUNTU_NON_ROOT_ID_REQUIRED',
  );
  const x = await loadRuntime(s.runtimeFile),
    c = x.config,
    u = new URL(c.origin);
  safePath(c.stateDirectory);
  check(
    c.address === '127.0.0.1' && c.trustedProxy && c.tls.serverName && !isIP(c.tls.serverName),
    'UBUNTU_EXPLICIT_INTERNAL_TLS_PROXY_REQUIRED',
  );
  check(isIP(u.hostname) === 4 || /^[a-z0-9.-]+$/.test(u.hostname), 'UBUNTU_PUBLIC_HOST_REJECTED');
  const publicHttps = u.protocol === 'https:';
  if (publicHttps) {
    check(s.publicCertificateFile && s.publicPrivateKeyFile, 'UBUNTU_PUBLIC_TLS_FILES_REQUIRED');
    safePath(s.publicCertificateFile);
    safePath(s.publicPrivateKeyFile);
    const cert = new X509Certificate(await privateBytes(s.publicCertificateFile));
    check(
      isIP(u.hostname)
        ? cert.checkIP(u.hostname) !== undefined
        : cert.checkHost(u.hostname) !== undefined,
      'UBUNTU_PUBLIC_CERTIFICATE_NAME_REJECTED',
    );
    check(
      cert.checkPrivateKey(
        (await import('node:crypto')).createPrivateKey(await privateBytes(s.publicPrivateKeyFile)),
      ),
      'UBUNTU_PUBLIC_CERTIFICATE_KEY_REJECTED',
    );
    check(
      Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(),
      'UBUNTU_PUBLIC_CERTIFICATE_EXPIRED',
    );
  }
  const o = await privateJson<{ runtimeFile: string; serviceUid: number; serviceGid: number }>(
    s.operationsFile,
  );
  check(
    o.runtimeFile === s.runtimeFile &&
      o.serviceUid === s.serviceUid &&
      o.serviceGid === s.serviceGid,
    'UBUNTU_OPERATIONS_USER_MISMATCH',
  );

  check(/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(c.tls.serverName), 'UBUNTU_INTERNAL_TLS_NAME_REJECTED');
  const token = (await privateBytes(c.trustedProxy.tokenFile)).toString().trim();
  await privateBytes(s.upstreamCaFile);
  await (
    await import('@/lib/zhiban/infrastructure/production/files')
  ).privateDirectory(output, true);
  const command = `${s.nodeBinary} ${s.releaseDirectory}/.zhiban-host/host.mjs`;
  const unit = `[Unit]
Description=Zhiban teaching service
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${s.serviceUser}
Group=${s.serviceGroup}
WorkingDirectory=${s.releaseDirectory}
Environment=NODE_ENV=production
Environment=TMPDIR=${s.temporaryDirectory}
ExecStart=${command} ${s.runtimeFile}
ExecStartPost=${command} --ready ${s.runtimeFile}
ExecStop=${command} --stop ${s.runtimeFile}
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=78
TimeoutStartSec=180
TimeoutStopSec=90
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${c.stateDirectory} ${s.temporaryDirectory}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
  const nginx = `# Private file: contains the loopback proxy credential. Include only this server block.
server {
 listen ${u.port || (publicHttps ? 443 : 80)}${publicHttps ? ' ssl' : ''};
 server_name ${u.hostname};
 ${publicHttps ? `ssl_certificate ${s.publicCertificateFile};\n ssl_certificate_key ${s.publicPrivateKeyFile};\n ssl_protocols TLSv1.2 TLSv1.3;` : ''}
 access_log off;
 client_max_body_size 64m;
 location /zhiban { proxy_pass https://127.0.0.1:${c.port}; include /etc/nginx/zhiban-proxy.inc; }
 location /api/zhiban/ { proxy_pass https://127.0.0.1:${c.port}; include /etc/nginx/zhiban-proxy.inc; }
 location ~ ^/(logo[^/]*\\.png|openmaic-mark\\.png|logos/|avatars/|agents/|fonts/) { proxy_pass https://127.0.0.1:${c.port}; include /etc/nginx/zhiban-proxy.inc; }
 location / { return 404; }
}
`;
  const inc = `proxy_http_version 1.1;
proxy_set_header Host ${u.host};
proxy_set_header Connection "";
proxy_set_header X-Zhiban-Proxy-Token "${token}";
proxy_set_header X-Zhiban-Client-IP $realip_remote_addr;
proxy_set_header X-Forwarded-For "";
proxy_set_header X-Forwarded-Proto ${publicHttps ? 'https' : 'http'};
proxy_ssl_server_name on;
proxy_ssl_name ${c.tls.serverName};
proxy_ssl_verify on;
proxy_ssl_verify_depth 3;
proxy_ssl_trusted_certificate ${s.upstreamCaFile};
proxy_buffering off;
proxy_request_buffering off;
proxy_read_timeout 370s;
proxy_send_timeout 180s;
`;
  const plannedFiles = {
    '/etc/systemd/system/zhiban.service': unit,
    '/etc/nginx/conf.d/zhiban.conf': nginx,
    '/etc/nginx/zhiban-proxy.inc': inc,
  };
  const filePreflight = Object.entries(plannedFiles)
    .map(([path, body]) => {
      const pin = s.expectedExistingFiles?.[path] ?? digest(body);
      check(/^[a-f0-9]{64}$/.test(pin), 'UBUNTU_EXISTING_FILE_PIN_REJECTED');
      return `if [ -e ${path} ] || [ -L ${path} ]; then [ -f ${path} ] && [ ! -L ${path} ] && [ "$(sha256sum ${path} | cut -d' ' -f1)" = ${pin} ] || { echo 'Existing deployment file differs: ${path}'; exit 1; }; fi`;
    })
    .join('\n');
  const install = `#!/bin/bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run this reviewed installer as root'; exit 1; }
cd -- "$(dirname -- "$0")"
${filePreflight}
[ "$(realpath ${s.releaseDirectory})" = ${s.releaseDirectory} ]
[ -f ${s.releaseDirectory}/.zhiban-host/host.mjs ]
[ ! -e ${s.releaseDirectory}/.env.local ] && [ ! -e ${s.releaseDirectory}/.env ]
getent group ${s.serviceGroup} >/dev/null || groupadd --system --gid ${s.serviceGid} ${s.serviceGroup}
[ "$(getent group ${s.serviceGroup} | cut -d: -f3)" = ${s.serviceGid} ]
id ${s.serviceUser} >/dev/null 2>&1 || useradd --system --uid ${s.serviceUid} --gid ${s.serviceGid} --home-dir /var/lib/zhiban --shell /usr/sbin/nologin ${s.serviceUser}
[ "$(id -u ${s.serviceUser})" = ${s.serviceUid} ] && [ "$(id -g ${s.serviceUser})" = ${s.serviceGid} ]
install -d -o root -g ${s.serviceGroup} -m 0750 $(dirname ${c.stateDirectory})
install -d -o ${s.serviceUser} -g ${s.serviceGroup} -m 0700 ${s.temporaryDirectory}
cd ${s.releaseDirectory}
${s.nodeBinary} .zhiban-host/ops.mjs handoff ${s.operationsFile}
chown -Rh root:root ${s.releaseDirectory}
chmod -R a-w ${s.releaseDirectory}
install -o root -g root -m 0644 "$OLDPWD/zhiban.service" /etc/systemd/system/zhiban.service
install -o root -g root -m 0600 "$OLDPWD/zhiban-proxy.inc" /etc/nginx/zhiban-proxy.inc
install -o root -g root -m 0600 "$OLDPWD/zhiban.nginx.conf" /etc/nginx/conf.d/zhiban.conf
${s.nodeBinary} .zhiban-host/ops.mjs bind-systemd ${s.operationsFile} "$OLDPWD/systemd-binding.json"
nginx -t
systemctl daemon-reload
systemctl enable --now zhiban.service
systemctl reload nginx
`;
  await (
    await import('@/lib/zhiban/infrastructure/production/files')
  ).saveJson(
    join(output, 'systemd-binding.json'),
    {
      unit: 'zhiban.service',
      unitFile: '/etc/systemd/system/zhiban.service',
      unitSha256: digest(unit),
    },
    true,
  );
  for (const [name, bytes] of Object.entries({
    'zhiban.service': unit,
    'zhiban.nginx.conf': nginx,
    'zhiban-proxy.inc': inc,
    'install-reviewed.sh': install,
  }))
    await writeFile(join(output, name), bytes, { mode: 0o600, flag: 'wx' });
  return {
    status: 'TEMPLATES_READY_NOT_APPLIED',
    output,
    service: 'zhiban.service',
    origin: c.origin,
  };
}
