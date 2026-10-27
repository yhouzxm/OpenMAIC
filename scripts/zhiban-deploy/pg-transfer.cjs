/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node bootstrap runs before workspace dependency installation. */
'use strict';
/** Isolated, owner-only PG16 -> PG18 rehearsal. Never activates a production provider. */
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const { comparable } = require('./compatibility.cjs');
const { privatePath, ancestors, tree, validateSnapshot } = require('../zhiban-portable.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const check = (v, why) => {
  if (!v) throw Error(why);
};
const dbs = [
  'zhiban_trial_content_disposable',
  'zhiban_trial_content_native',
  'zhiban_trial_lesson_native',
];
const ident = (s) => '"' + s.replaceAll('"', '""') + '"';
function run(bin, args, options = {}) {
  return cp.execFileSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180000,
    ...options,
  });
}
function json(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function write(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function absent(p) {
  check(/^[A-Za-z0-9_./-]+$/.test(p), 'Simple absolute filesystem path required');
  ancestors(p);
  check(
    path.isAbsolute(p) && path.resolve(p) === p && p !== '/',
    'Canonical absolute target required',
  );
  check(!fs.existsSync(p), 'Target exists; no overwrite permitted');
  privatePath(path.dirname(p), true);
}
function marker(root) {
  privatePath(root, true);
  const p = path.join(root, 'INSTANCE.json');
  privatePath(p);
  const m = json(p);
  privatePath(path.join(root, 'data'), true);
  privatePath(path.join(root, 'socket'), true);
  check(
    /^[A-Za-z0-9_./-]+$/.test(root) &&
      Buffer.byteLength(root + '/socket/.s.PGSQL.' + m.port) < 104 &&
      Number.isInteger(m.port) &&
      m.port >= 56540 &&
      m.port <= 56559,
    'Isolated path/port rejected',
  );
  check(
    m.kind === 'LOCAL_ISOLATED_PG_TRANSFER_V1' &&
      [16, 18].includes(m.major) &&
      m.root === root &&
      m.tcp === false,
    'Instance binding rejected',
  );
  check(
    fs.readFileSync(path.join(root, 'data/PG_VERSION'), 'utf8').trim() === String(m.major),
    'PG_VERSION mismatch',
  );
  check(
    new RegExp('^postgres \\(PostgreSQL\\) ' + m.major + '\\.').test(
      run(path.join(m.bin, 'postgres'), ['--version']),
    ),
    'Binary version rejected',
  );
  return m;
}
function args(m, db = 'postgres') {
  return ['-h', path.join(m.root, 'socket'), '-p', String(m.port), '-U', m.admin, '-d', db];
}
function sql(m, q, db = 'postgres') {
  return run(path.join(m.bin, 'psql'), [
    '-XqAt',
    '-v',
    'ON_ERROR_STOP=1',
    ...args(m, db),
    '-c',
    "SET timezone='UTC'; " + q,
  ]).trim();
}
function endpoint(m) {
  const v = JSON.parse(
    sql(
      m,
      `SELECT json_build_object('major',current_setting('server_version_num')::int/10000,'directory',current_setting('data_directory'),'tcp',current_setting('listen_addresses'),'recovery',pg_is_in_recovery())`,
    ),
  );
  check(
    v.major === m.major && v.directory === path.join(m.root, 'data') && v.tcp === '' && !v.recovery,
    'Live endpoint mismatch',
  );
  return v;
}
function create(root, bin, major, port, snapshot, pin) {
  check(
    [16, 18].includes(major) && Number.isInteger(port) && port >= 56540 && port <= 56559,
    'Only isolated major/port range admitted',
  );
  check(
    new RegExp('PostgreSQL\\) ' + major + '\\.').test(
      run(path.join(bin, 'postgres'), ['--version']),
    ),
    'Wrong PostgreSQL binary',
  );
  absent(root);
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'socket'), { mode: 0o700 });
  const m = {
    kind: 'LOCAL_ISOLATED_PG_TRANSFER_V1',
    root,
    bin,
    major,
    port,
    admin: 'postgres',
    tcp: false,
    snapshot: undefined,
  };
  if (snapshot) {
    check(major === 16, 'Physical PG16 source clone only');
    const source = validateSnapshot(snapshot, pin);
    m.snapshot = { manifestSha256: pin, sourceRoot: source.originalRoot };
    fs.cpSync(path.join(snapshot, 'root/data'), path.join(root, 'data'), {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });
    check(!fs.existsSync(path.join(root, 'data/postmaster.pid')), 'Source snapshot is live');
    fs.chmodSync(path.join(root, 'data'), 0o700);
  } else
    run(path.join(bin, 'initdb'), [
      '-D',
      path.join(root, 'data'),
      '-U',
      m.admin,
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--no-locale',
    ]);
  write(path.join(root, 'INSTANCE.json'), m);
  return m;
}
function start(root, readOnly) {
  const m = marker(root);
  check(readOnly === undefined || typeof readOnly === 'boolean', 'Boolean read-only mode required');
  run(path.join(m.bin, 'pg_ctl'), [
    '-D',
    path.join(root, 'data'),
    '-l',
    path.join(root, 'postgres.log'),
    '-o',
    `-p ${m.port} -k ${root}/socket -c listen_addresses='' -c default_transaction_read_only=${(readOnly ?? !!m.snapshot) ? 'on' : 'off'}`,
    '-w',
    'start',
  ]);
  return endpoint(m);
}
function stop(root) {
  const m = marker(root);
  endpoint(m);
  const pid = Number(
    fs.readFileSync(path.join(root, 'data/postmaster.pid'), 'utf8').split('\n')[0],
  );
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  check(
    command.includes('-D') && command[command.indexOf('-D') + 1] === path.join(root, 'data'),
    'Postmaster process binding rejected',
  );
  run(path.join(m.bin, 'pg_ctl'), ['-D', path.join(root, 'data'), '-m', 'fast', '-w', 'stop']);
}
const catalogSql = `SELECT jsonb_build_object(
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY n.nspname,c.relname,a.attnum),'[]') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred) ORDER BY n.nspname,c.relname,k.conname),'[]') FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND k.contype<>'n'),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.prosrc,p.probin,p.prosecdef,p.provolatile,p.proconfig) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_indexdef(c.oid)) ORDER BY n.nspname,c.relname),'[]') FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY n.nspname,c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'tables',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p')),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(pg_get_userbyid(r) ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,c.relname,p.polname),'[]') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'),
 'acl',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
 SELECT jsonb_build_array('table',n.nspname,c.relname,CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','S','v','m')
 UNION ALL SELECT jsonb_build_array('function',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT jsonb_build_array('schema',n.nspname,pg_get_userbyid(n.nspowner),CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT jsonb_build_array('column',n.nspname,c.relname,col.attname,CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT jsonb_build_array('default',coalesce(n.nspname,''),pg_get_userbyid(d.defaclrole),d.defaclobjtype,CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE n.nspname IS NULL OR (n.nspname!~'^pg_' AND n.nspname<>'information_schema')
 ) a))::text`;
function inventory(root) {
  const m = marker(root);
  endpoint(m);
  const actual = JSON.parse(
    sql(
      m,
      "SELECT coalesce(json_agg(datname ORDER BY datname),'[]') FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'",
    ),
  );
  check(JSON.stringify(actual) === JSON.stringify([...dbs].sort()), 'Unexpected/missing databases');
  const result = {
    databases: {},
    roles: JSON.parse(
      sql(
        m,
        "SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil) ORDER BY rolname) FROM pg_roles WHERE rolname!~'^pg_'",
      ),
    ),
    edges: JSON.parse(
      sql(
        m,
        "SELECT coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(member),pg_get_userbyid(roleid),admin_option,inherit_option,set_option) ORDER BY pg_get_userbyid(member),pg_get_userbyid(roleid)),'[]') FROM pg_auth_members WHERE pg_get_userbyid(member)!~'^pg_' OR pg_get_userbyid(roleid)!~'^pg_'",
      ),
    ),
  };
  for (const db of dbs) {
    const tables = JSON.parse(
      sql(
        m,
        "SELECT json_agg(json_build_array(n.nspname,c.relname) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p')",
        db,
      ),
    );
    const data = {};
    for (const [schema, name] of tables) {
      const q = `SET timezone='UTC'; SET extra_float_digits=3; SELECT json_build_object('rows',count(*)::text,'rowHash',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM ${ident(schema)}.${ident(name)} t) x`;
      data[schema + '.' + name] = JSON.parse(sql(m, q, db).split('\n').at(-1));
    }
    const sequences = JSON.parse(
      sql(
        m,
        "SELECT coalesce(json_agg(json_build_array(schemaname,sequencename,last_value) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname!~'^pg_'",
        db,
      ),
    );
    for (const seq of sequences) {
      const value = JSON.parse(
        sql(
          m,
          `SELECT json_build_array(last_value::text,is_called) FROM ${ident(seq[0])}.${ident(seq[1])}`,
          db,
        ),
      );
      seq.push(...value);
    }
    const facts = JSON.parse(sql(m, catalogSql, db));
    const extras = JSON.parse(
      sql(
        m,
        "SELECT jsonb_build_object('types',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault,(SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.contypid=t.oid),(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY n.nspname,t.typname),'[]') FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND t.typtype IN('d','e')),'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension),'dbacl',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(d.datdba),CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE datname=current_database()))",
        db,
      ),
    );
    result.databases[db] = { data, sequences, catalog: facts, extras };
  }
  result.roleGrantors = JSON.parse(
    sql(
      m,
      "SELECT coalesce(json_agg(json_build_array(pg_get_userbyid(member),pg_get_userbyid(roleid),pg_get_userbyid(grantor)) ORDER BY pg_get_userbyid(member),pg_get_userbyid(roleid)),'[]') FROM pg_auth_members WHERE pg_get_userbyid(member)!~'^pg_' OR pg_get_userbyid(roleid)!~'^pg_'",
    ),
  );
  result.roleSecretDigests = JSON.parse(
    sql(
      m,
      "SELECT json_agg(json_build_array(rolname,encode(sha256(convert_to(coalesce(rolpassword,''),'UTF8')),'hex')) ORDER BY rolname) FROM pg_authid WHERE rolname!~'^pg_'",
    ),
  );
  return result;
}
function compare(a, b) {
  const mismatches = [];
  const walk = (x, y, p = '') => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (
      x &&
      y &&
      typeof x === 'object' &&
      typeof y === 'object' &&
      !Array.isArray(x) &&
      !Array.isArray(y)
    ) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
        walk(x[k], y[k], p ? `${p}.${k}` : k);
    } else mismatches.push(p);
  };
  walk(a, b);
  return mismatches;
}
function exportBundle(root, bin18, out, snapshotRoot) {
  if (!snapshotRoot && fs.existsSync(path.join(root, 'host-files')))
    snapshotRoot = path.join(root, 'host-files');
  const m = marker(root);
  endpoint(m);
  check(m.major === 16 || m.major === 18, 'Source major rejected');
  check(
    /PostgreSQL\) 18\./.test(run(path.join(bin18, 'pg_dump'), ['--version'])),
    'Use PG18 logical dump client',
  );
  absent(out);
  fs.mkdirSync(out, { mode: 0o700 });
  write(path.join(out, 'INCOMPLETE.json'), { operation: 'EXPORT' });
  // Only a read-only source clone or an idle owned target is admitted. No live application may write during a three-DB cut.
  const active = Number(
    sql(
      m,
      "SELECT count(*) FROM pg_stat_activity WHERE datname=ANY(ARRAY['zhiban_trial_content_disposable','zhiban_trial_content_native','zhiban_trial_lesson_native']) AND pid<>pg_backend_pid()",
    ),
  );
  check(active === 0, 'Source has active application connections; stop writers first');
  check(
    sql(m, 'SHOW default_transaction_read_only') === 'on',
    'Restart owned source in backup read-only mode first',
  );
  let roles = run(path.join(bin18, 'pg_dumpall'), [
    '-h',
    path.join(root, 'socket'),
    '-p',
    String(m.port),
    '-U',
    m.admin,
    '--roles-only',
  ]);
  fs.writeFileSync(path.join(out, 'roles.sql'), roles, { mode: 0o600 });
  for (const db of dbs) {
    run(path.join(bin18, 'pg_dump'), [
      ...args(m, db),
      '--format=custom',
      '--create',
      '--file=' + path.join(out, db + '.dump'),
    ]);
    fs.chmodSync(path.join(out, db + '.dump'), 0o600);
  }
  const inv = inventory(root);
  write(path.join(out, 'inventory.json'), inv);
  if (snapshotRoot) {
    privatePath(snapshotRoot, true);
    fs.mkdirSync(path.join(out, 'host-files'), { mode: 0o700 });
    for (const name of fs.readdirSync(snapshotRoot)) {
      if (['data', 'socket', 'postgres.log'].includes(name)) continue;
      fs.cpSync(path.join(snapshotRoot, name), path.join(out, 'host-files', name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
    }
    tree(path.join(out, 'host-files'));
    function restrict(p) {
      const st = fs.lstatSync(p);
      check(!st.isSymbolicLink(), 'Host-file link rejected');
      fs.chmodSync(p, st.isDirectory() ? 0o700 : 0o600);
      if (st.isDirectory()) for (const n of fs.readdirSync(p)) restrict(path.join(p, n));
    }
    restrict(path.join(out, 'host-files'));
  }
  fs.unlinkSync(path.join(out, 'INCOMPLETE.json'));
  const manifest = {
    kind: 'LOCAL_LOGICAL_PG_TRANSFER_V1',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    sourceMajor: m.major,
    targetMajor: 18,
    inventoryVersion: 2,
    sourceSnapshot: m.snapshot ?? null,
    createdAt: new Date().toISOString(),
    scope: 'PRIVATE_QUARANTINE_NO_PROVIDER_ACTIVATION',
    databases: dbs,
    files: tree(out),
  };
  write(path.join(out, 'MANIFEST.json'), manifest);
  return { path: out, pin: hash(fs.readFileSync(path.join(out, 'MANIFEST.json'))) };
}
function bundle(input, pin) {
  privatePath(input, true);
  privatePath(path.join(input, 'MANIFEST.json'));
  const bytes = fs.readFileSync(path.join(input, 'MANIFEST.json'));
  check(hash(bytes) === pin, 'Manifest pin mismatch');
  const m = JSON.parse(bytes);
  check(
    m.kind === 'LOCAL_LOGICAL_PG_TRANSFER_V1' &&
      m.targetMajor === 18 &&
      m.inventoryVersion === 2 &&
      m.scope === 'PRIVATE_QUARANTINE_NO_PROVIDER_ACTIVATION' &&
      m.evidenceOrigin === 'LOCAL' &&
      m.githubActions === false &&
      JSON.stringify(m.databases) === JSON.stringify(dbs),
    'Logical profile rejected',
  );
  const actual = tree(input);
  delete actual['MANIFEST.json'];
  for (const name of [
    'roles.sql',
    'inventory.json',
    ...dbs.map((d) => d + '.dump'),
    'host-files/accounts.json',
    'host-files/member-control.json',
    'host-files/content-installation.json',
    'host-files/native-secret/instance-secret.key',
  ])
    check(name in actual, 'Required recovery material missing');
  check(
    Object.keys(actual).every(
      (name) =>
        ['roles.sql', 'inventory.json', ...dbs.map((d) => d + '.dump')].includes(name) ||
        name.startsWith('host-files/'),
    ),
    'Unexpected recovery material',
  );
  check(
    JSON.stringify(Object.entries(actual).sort()) ===
      JSON.stringify(Object.entries(m.files).sort()),
    'Logical bundle closure mismatch',
  );
  for (const p of Object.keys(actual)) privatePath(path.join(input, p));
  return m;
}
function materialize(root, input, pin) {
  bundle(input, pin);
  marker(root);
  const receipt = path.join(root, 'RESTORED.json');
  if (fs.existsSync(receipt)) check(json(receipt).pin === pin, 'Restore receipt pin mismatch');
  else
    check(
      fs.existsSync(path.join(root, 'RESTORING.json')) &&
        json(path.join(root, 'RESTORING.json')).pin === pin &&
        json(path.join(root, 'RESTORE-COMPARISON.json')).differences.length === 0,
      'Verified restore required before private material copy',
    );
  const destination = path.join(root, 'host-files');
  check(!fs.existsSync(destination), 'Private host target exists');
  fs.cpSync(path.join(input, 'host-files'), destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  const restrict = (p) => {
    const st = fs.lstatSync(p);
    check(!st.isSymbolicLink(), 'Host link rejected');
    fs.chmodSync(p, st.isDirectory() ? 0o700 : 0o600);
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) restrict(path.join(p, n));
  };
  restrict(destination);
  check(
    JSON.stringify(tree(destination)) === JSON.stringify(tree(path.join(input, 'host-files'))),
    'Host file copy mismatch',
  );
  write(path.join(root, 'HOST-RESTORED.json'), {
    pin,
    files: tree(destination),
    scope: 'QUARANTINED_ORIGINAL_BINDINGS_NO_ACTIVATION',
  });
}
function restore(root, input, pin) {
  const pack = bundle(input, pin),
    m = marker(root);
  check(m.major === 18 && !m.snapshot, 'Target must be fresh owned PG18');
  endpoint(m);
  check(
    !fs.existsSync(path.join(root, 'RESTORING.json')) &&
      !fs.existsSync(path.join(root, 'RESTORED.json')),
    'Partial/previous restore cannot be retried or activated',
  );
  check(
    sql(m, "SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'") ===
      '0',
    'Target database exists',
  );
  check(
    sql(m, "SELECT count(*) FROM pg_roles WHERE rolname!~'^pg_' AND rolname<>'postgres'") === '0',
    'Target has foreign roles',
  );
  write(path.join(root, 'RESTORING.json'), { pin });
  const roleLines = fs.readFileSync(path.join(input, 'roles.sql'), 'utf8').split('\n');
  check(
    roleLines.filter((line) => line === 'CREATE ROLE postgres;').length === 1,
    'Original bootstrap role must be postgres',
  );
  const roleFile = path.join(root, 'roles.restore.sql');
  fs.writeFileSync(
    roleFile,
    roleLines.filter((line) => line !== 'CREATE ROLE postgres;').join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  run(path.join(m.bin, 'psql'), [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '--single-transaction',
    ...args(m),
    '-f',
    roleFile,
  ]);
  for (const db of dbs)
    run(path.join(m.bin, 'pg_restore'), [
      ...args(m),
      '--exit-on-error',
      '--create',
      path.join(input, db + '.dump'),
    ]);
  const actual = inventory(root),
    expected = comparable(json(path.join(input, 'inventory.json'))),
    normalized = comparable(actual),
    differences = compare(expected.facts, normalized.facts);
  write(path.join(root, 'RESTORE-COMPARISON.json'), {
    differences,
    compatibilityRules: normalized.introduced,
    expectedHash: hash(fs.readFileSync(path.join(input, 'inventory.json'))),
    actual,
  });
  check(
    differences.length === 0,
    'Restored data/ACL/schema differs; quarantined partial target retained',
  );
  materialize(root, input, pin);
  write(path.join(root, 'RESTORED.json'), {
    kind: 'LOCAL_PG18_QUARANTINED_RESTORE',
    pin,
    sourceMajor: pack.sourceMajor,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    providerActivated: false,
  });
  fs.unlinkSync(path.join(root, 'RESTORING.json'));
  return { status: 'PASS_QUARANTINED_RESTORE', databases: dbs.length, providerActivated: false };
}
if (require.main === module) {
  try {
    const [op, ...a] = process.argv.slice(2);
    let r;
    if (op === 'clone16' && a.length === 4)
      r = create(a[0], '/usr/lib/postgresql/16/bin', 16, Number(a[1]), a[2], a[3]);
    else if (op === 'init18' && a.length === 3) r = create(a[0], a[1], 18, Number(a[2]));
    else if (['start', 'start-readonly'].includes(op) && a.length === 1)
      r = start(a[0], op === 'start-readonly' ? true : undefined);
    else if (op === 'stop' && a.length === 1) r = stop(a[0]);
    else if (op === 'export' && a.length >= 3 && a.length <= 4) r = exportBundle(...a);
    else if (op === 'restore' && a.length === 3) r = restore(...a);
    else if (op === 'materialize' && a.length === 3) r = materialize(...a);
    else if (op === 'inspect' && a.length === 1) r = inventory(a[0]);
    else
      throw Error(
        'Use init18 ROOT BIN PORT | clone16 ROOT PORT SNAPSHOT PIN | start/stop/inspect ROOT | export ROOT BIN18 OUT [HOST_ROOT] | restore ROOT BUNDLE PIN',
      );
    if (r) console.log(JSON.stringify(r));
  } catch (e) {
    console.error(
      e.code || typeof e.status === 'number'
        ? 'PostgreSQL operation failed; owned inputs retained'
        : e.message,
    );
    process.exitCode = 1;
  }
}
module.exports = {
  create,
  start,
  stop,
  exportBundle,
  restore,
  inventory,
  compare,
  bundle,
  marker,
  materialize,
};
