// Strict validation-only child. Secrets enter via fd4; result leaves via private fd3.
const fs = require('node:fs'),
  path = require('node:path');
const c = require('./release-contract.cjs'),
  physical = require('./physical-closure.cjs');
const SCHEMAS = [
  'zhiban_identity',
  'zhiban_bridge',
  'zhiban_academic',
  'zhiban_learning',
  'zhiban_assessment',
  'zhiban_content',
  'zhiban_reconcile',
  'zhiban_reconcile_catalog',
  'zhiban_handoff',
];
const ROLES = [
  ...c.ROLE,
  'zhiban_identity_owner',
  'zhiban_openmaic_owner',
  'zhiban_migrator',
  'zhiban_openmaic_migrator',
  'zhiban_reconcile_controller',
  'zhiban_reconcile_issuer',
  'zhiban_reconcile_executor',
  'zhiban_reconcile_native_proof',
  'zhiban_reconcile_observer',
];
const expectedFields = [
  'formatVersion',
  'purpose',
  'evidenceOrigin',
  'githubActions',
  'authorityKeySha256',
  'profile',
  'sourceBindingsSha256',
  'review',
  'before',
  'after',
];
const compatibilityFields = [
  'status',
  'formatVersion',
  'purpose',
  'evidenceOrigin',
  'githubActions',
  'authorityKeySha256',
  'releaseId',
  'credentialGenerationId',
  'deploymentId',
  'sourceBindingsSha256',
  'configurationSha256',
  'buildManifestSha256',
  'contexts',
  'launchAllowed',
  'terminalActionsAllowed',
];
const transportFields = [
  'status',
  'formatVersion',
  'purpose',
  'evidenceOrigin',
  'githubActions',
  'authorityKeySha256',
  'releaseId',
  'credentialGenerationId',
  'deploymentId',
  'target',
  'sourceBindingsSha256',
  'hbaSha256',
  'hbaRules',
  'postmasterStart',
  'observedAt',
  'expiresAt',
  'credentialLineageSha256',
  'oldCredentialDigests',
];
let phase = 'REQUEST';
async function main() {
  c.insist(
    process.argv.length === 4 &&
      process.argv[2] === '--validate-handoff' &&
      globalThis.__zhibanValidation,
    'Preloaded validation guard required',
  );
  const root = process.argv[3],
    raw = fs.readFileSync(4);
  c.insist(raw.length < 8 * 1024 * 1024, 'Bounded validation request required');
  const r = JSON.parse(raw);
  c.keys(r, [
    'formatVersion',
    'releaseId',
    'credentialGenerationId',
    'sourceBindingsSha256',
    'artifactManifestSha256',
    'configurationSha256',
    'expectedProfileSha256',
    'challenge',
    'authorityPublicKey',
    'expectedProfile',
    'compatibilityReceipt',
    'compatibilityReceiptSha256',
    'transportEvidence',
    'previousCredentials',
    'shadowEvidence',
  ]);
  c.insist(
    r.formatVersion === 1 &&
      c.UUID.test(r.releaseId) &&
      c.UUID.test(r.credentialGenerationId) &&
      c.HASH.test(r.sourceBindingsSha256) &&
      c.HASH.test(r.challenge),
    'Validation request rejected',
  );
  phase = 'ARTIFACTS';
  const artifactRaw = c.bytes(path.join(root, 'artifact-manifest.json')),
    artifact = JSON.parse(artifactRaw);
  c.insist(
    c.sha(artifactRaw) === r.artifactManifestSha256 &&
      artifact.releaseId === r.releaseId &&
      artifact.credentialGenerationId === r.credentialGenerationId,
    'Pinned artifact generation rejected',
  );
  for (const f of artifact.files) {
    c.relative(f.path);
    c.insist(c.sha(c.bytes(path.join(root, f.path))) === f.sha256, 'Artifact leaf drift');
  }
  const buildRaw = c.bytes(path.join(root, 'build-manifest.json')),
    build = JSON.parse(buildRaw),
    closureRaw = c.bytes(path.join(root, 'closure-manifest.json')),
    closure = JSON.parse(closureRaw),
    configRaw = c.bytes(path.join(root, 'ordinary.json')),
    cfg = c.config(JSON.parse(configRaw), r.releaseId, r.credentialGenerationId);
  c.insist(
    build.sourceBindingsSha256 === r.sourceBindingsSha256 &&
      build.configurationSha256 === r.configurationSha256 &&
      c.sha(configRaw) === r.configurationSha256 &&
      build.closureManifestSha256 === c.sha(closureRaw),
    'Build/source/configuration binding rejected',
  );
  physical.verify(root, closure);
  const checks = {
    sixRoleTcpScram: false,
    oldCredentialsDenied: false,
    exactHba: false,
    configurationComposition: false,
    compatibilityReceipts: false,
    physicalClosure: true,
    loaderInstrumentation: false,
    nativeAbiLibraries: false,
    freshShadowLoad: false,
  };
  phase = 'EXPECTED_PROFILE';
  const expectedRaw = Buffer.from(r.expectedProfile),
    expected = c.signed(
      expectedRaw,
      r.authorityPublicKey,
      'REVIEWED_ORDINARY_HANDOFF_PROFILE',
      expectedFields,
    );
  c.insist(
    c.sha(expectedRaw) === r.expectedProfileSha256 &&
      expected.sourceBindingsSha256 === r.sourceBindingsSha256 &&
      expected.profile === cfg.profile,
    'Independent expected/source required',
  );
  c.keys(expected.review, ['sourceKind', 'approvalRef', 'referenceEvidenceSha256']);
  c.insist(
    expected.review.sourceKind === 'INDEPENDENT_SHADOW_PG16' &&
      expected.review.approvalRef &&
      c.HASH.test(expected.review.referenceEvidenceSha256),
    'Independent review required',
  );
  phase = 'PRODUCT_LOAD';
  const product = require('./product.cjs'),
    sessions = [],
    pools = {};
  const connectOptions = (x) => ({
    host: '127.0.0.1',
    port: cfg.target.port,
    database: x.database,
    user: x.role,
    password: x.password,
    ssl: false,
    application_name: 'zhiban-validation-' + r.releaseId,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    query_timeout: 5000,
    options: '-c default_transaction_read_only=on',
  });
  async function open(x) {
    const client = new product.Client(connectOptions(x));
    client.on('error', () => {});
    let scram = false;
    client.connection.on('authenticationSASL', (m) => {
      scram = Array.isArray(m.mechanisms) && m.mechanisms.includes('SCRAM-SHA-256');
    });
    try {
      await client.connect();
      c.insist(scram, 'SCRAM authentication required');
      return client;
    } catch (error) {
      await client.end().catch((error) => {});
      throw error;
    }
  }
  try {
    phase = 'SIX_ROLE_CONNECTIONS';
    for (const x of cfg.connections) {
      const client = await open(x);
      sessions.push(client);
      const f = (
        await client.query(
          "SELECT session_user,current_user,current_database() db,current_setting('server_version_num')::int pg,pg_postmaster_start_time() start,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid,(SELECT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AND NOT has_database_privilege(r.oid,current_database(),'TEMP') AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE r.rolname=session_user) safe",
        )
      ).rows[0];
      c.insist(
        f.session_user === x.role &&
          f.current_user === x.role &&
          f.db === x.database &&
          f.pg >= 160000 &&
          f.pg < 170000 &&
          f.safe === true &&
          f.oid ===
            (x.database === 'zhiban_m1_dev' ? cfg.target.businessOid : cfg.target.nativeOid),
        'Ordinary live role/target rejected',
      );
    }
    checks.sixRoleTcpScram = true;
    const b = sessions[cfg.connections.findIndex((x) => x.role === 'zhiban_control_runtime')],
      n = sessions[cfg.connections.findIndex((x) => x.role === 'zhiban_openmaic_runtime')];
    phase = 'CATALOG';
    const catalog = {};
    for (const [part, client, schemas, file, col] of [
      ['business', b, SCHEMAS, '05-business-terminal-catalog.sql', 'terminal_catalog'],
      ['native', n, ['public'], '06-native-terminal-catalog.sql', 'terminal_native_catalog'],
    ]) {
      await client.query('BEGIN READ ONLY');
      try {
        catalog[part] = {
          complete: (
            await client.query(
              c.bytes(path.join(root, 'metadata/04-complete-catalog.sql')).toString(),
              [schemas, ROLES],
            )
          ).rows[0].installation_catalog,
          terminal: (await client.query(c.bytes(path.join(root, 'metadata', file)).toString()))
            .rows[0][col],
        };
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    c.insist(
      c.canonical(catalog) === c.canonical(expected.after),
      'Live ordinary profile mismatch',
    );
    phase = 'REGISTERED_SCOPE';
    await b.query('BEGIN READ WRITE ISOLATION LEVEL READ COMMITTED');
    let facts;
    try {
      facts = (
        await b.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
          cfg.deploymentId,
          r.releaseId,
          cfg.readSecret,
        ])
      ).rows[0].value;
      await b.query('COMMIT');
    } catch (error) {
      await b.query('ROLLBACK');
      throw error;
    }
    c.insist(
      facts.readPermissionPhase === 'REGISTERED' &&
        facts.activationStatus === 'REGISTERED_UNACTIVATED' &&
        facts.cluster === cfg.target.cluster &&
        facts.claimsEmpty === true &&
        facts.artifactManifestSha256 === r.artifactManifestSha256 &&
        facts.configurationSha256 === r.configurationSha256 &&
        facts.profileSha256 === r.expectedProfileSha256 &&
        facts.sourceSha256 === r.sourceBindingsSha256 &&
        facts.credentialGenerationId === r.credentialGenerationId,
      'Exact REGISTERED validation scope required',
    );
    c.insist(
      c.canonical(facts.ledgers) === c.canonical(build.ledgerBindings),
      'All frozen composition ledgers required',
    );
    c.insist(
      cfg.connections.every((x) => sessions[cfg.connections.indexOf(x)]._connected),
      'All ordinary sessions must remain observed',
    );
    cfg.identity.composition.admission.hmacKey = Buffer.from(
      cfg.identity.composition.admission.hmacKey,
      'hex',
    );
    for (const x of cfg.connections)
      pools[x.role] = new product.Pool({ ...connectOptions(x), max: 1 });
    phase = 'COMPOSITION';
    const composition = await product.createProduct(pools, cfg.identity, cfg.deploymentId);
    c.insist(
      composition.identity &&
        composition.academic &&
        composition.learning &&
        composition.assessment &&
        composition.content,
      'Full M1-M5 text composition required',
    );
    const response = await composition.identity.handle(
      new Request(cfg.target.origin + '/api/zhiban/identity/me', {
        headers: { 'x-zhiban-request': 'identity-v1', 'x-zhiban-client-ip': '127.0.0.1' },
      }),
    );
    c.insist(response.status === 401, 'Read-only unauthenticated composition probe rejected');
    checks.configurationComposition = true;
    phase = 'NATIVE_KDF';
    await product.nativeSelfCheck();
    physical.loadedLibraries(closure, build.libraryAliases);
    checks.nativeAbiLibraries = true;
    phase = 'COMPATIBILITY';
    if (r.compatibilityReceipt !== null) {
      const compatRaw = Buffer.from(r.compatibilityReceipt),
        p = c.signed(
          compatRaw,
          r.authorityPublicKey,
          'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS',
          compatibilityFields,
        );
      c.insist(
        p.status === 'ISSUED' &&
          c.sha(compatRaw) === r.compatibilityReceiptSha256 &&
          p.releaseId === r.releaseId &&
          p.credentialGenerationId === r.credentialGenerationId &&
          p.deploymentId === cfg.deploymentId &&
          p.sourceBindingsSha256 === r.sourceBindingsSha256 &&
          p.configurationSha256 === r.configurationSha256 &&
          p.buildManifestSha256 === c.sha(buildRaw) &&
          p.launchAllowed === false &&
          p.terminalActionsAllowed === false,
        'Compatibility generation/source rejected',
      );
      c.keys(p.contexts, ['identity', 'academic', 'learning', 'assessment', 'content']);
      for (const [k, v] of Object.entries(p.contexts)) {
        c.keys(v, ['policySha256', 'ledgerSha256', 'previousReceiptSha256']);
        c.insist(
          c.HASH.test(v.policySha256) &&
            c.HASH.test(v.ledgerSha256) &&
            c.HASH.test(v.previousReceiptSha256),
          'Compatibility context binding rejected',
        );
        const rows = facts.ledgers.filter((x) => x.context === k);
        c.insist(c.sha(c.canonical(rows)) === v.ledgerSha256, 'Compatibility ledger mismatch');
        const policy =
          k === 'identity'
            ? cfg.identity.manifest.policy
            : k === 'content'
              ? JSON.parse(c.bytes(path.join(root, 'assets/content-csp.json'))).policy
              : product.policies[k];
        c.insist(c.sha(c.canonical(policy)) === v.policySha256, 'Compatibility policy mismatch');
      }
      checks.compatibilityReceipts = true;
    }
    phase = 'TRANSPORT';
    if (r.transportEvidence !== null) {
      const t = c.signed(
        Buffer.from(r.transportEvidence),
        r.authorityPublicKey,
        'LOCAL_ORDINARY_TRANSPORT_EVIDENCE',
        transportFields,
      );
      c.insist(
        t.status === 'ISSUED' &&
          t.releaseId === r.releaseId &&
          t.credentialGenerationId === r.credentialGenerationId &&
          t.deploymentId === cfg.deploymentId &&
          c.canonical(t.target) === c.canonical(cfg.target) &&
          t.sourceBindingsSha256 === r.sourceBindingsSha256 &&
          Number.isSafeInteger(t.observedAt) &&
          Number.isSafeInteger(t.expiresAt) &&
          Date.now() >= t.observedAt &&
          Date.now() - t.observedAt <= 30000 &&
          t.expiresAt > Date.now() &&
          t.expiresAt - t.observedAt <= 300000 &&
          new Date(t.postmasterStart).toISOString() ===
            new Date(facts.postmasterStart).toISOString() &&
          c.HASH.test(t.hbaSha256) &&
          c.HASH.test(t.credentialLineageSha256),
        'Fresh independent transport evidence required',
      );
      c.keys(t.oldCredentialDigests, c.ROLE);
      const wanted = require('./ordinary-transport.cjs').rules();
      c.insist(
        c.canonical(t.hbaRules) === c.canonical(wanted),
        'Exact six ordinary HBA rules required',
      );
      checks.exactHba = true;
      c.insist(
        Array.isArray(r.previousCredentials) &&
          c.canonical(r.previousCredentials.map((x) => x.role).sort()) ===
            c.canonical([...c.ROLE].sort()),
        'Old credential provenance required',
      );
      for (const old of r.previousCredentials) {
        c.keys(old, ['role', 'password']);
        c.insist(
          c.ROLE.includes(old.role) &&
            c.HASH.test(old.password) &&
            t.oldCredentialDigests[old.role] === c.sha(old.password),
          'Old credential provenance mismatch',
        );
        const live = cfg.connections.find((x) => x.role === old.role);
        c.insist(old.password !== live.password, 'Old credential must differ');
        let rejected = false,
          client;
        try {
          client = await open({ ...live, password: old.password });
        } catch (error) {
          c.insist(
            ['28P01', '28000'].includes(error.code),
            'Old authentication probe inconclusive',
          );
          rejected = true;
        } finally {
          if (client) await client.end();
        }
        c.insist(rejected, 'Old credential still authenticates');
      }
      checks.oldCredentialsDenied = true;
    }
    phase = 'FINAL_RESULT';
    const state = globalThis.__zhibanValidation;
    c.insist(
      state.listenAttempts === 0 &&
        state.writesDenied === 0 &&
        state.native.length >= 1 &&
        state.loaded.includes('host/product.cjs'),
      'Fresh isolated loader observation required',
    );
    checks.loaderInstrumentation = true;
    checks.freshShadowLoad = cfg.target.environment === 'LOCAL_DISPOSABLE';
    if (r.shadowEvidence !== null) {
      const shadow = c.signed(
        Buffer.from(r.shadowEvidence),
        r.authorityPublicKey,
        'LOCAL_ORDINARY_SHADOW_VALIDATION',
        [
          'formatVersion',
          'status',
          'purpose',
          'evidenceOrigin',
          'githubActions',
          'authorityKeySha256',
          'sourceKind',
          'approvalRef',
          'sourceBindingsSha256',
          'codeClosureSha256',
          'validationEvidenceSha256',
          'shadowExpectedProfileSha256',
          'checks',
          'launchAllowed',
          'runtimeAccepted',
        ],
      );
      c.insist(
        shadow.status === 'ISSUED' &&
          shadow.sourceKind === 'INDEPENDENT_SHADOW_PG16' &&
          shadow.approvalRef &&
          shadow.sourceBindingsSha256 === r.sourceBindingsSha256 &&
          shadow.codeClosureSha256 === physical.codeDigest(closure) &&
          c.HASH.test(shadow.validationEvidenceSha256) &&
          c.HASH.test(shadow.shadowExpectedProfileSha256) &&
          shadow.launchAllowed === false &&
          shadow.runtimeAccepted === false,
        'Independent shadow code/source proof rejected',
      );
      c.keys(shadow.checks, Object.keys(checks));
      c.insist(
        Object.values(shadow.checks).every((x) => x === true),
        'Complete reviewed shadow validation required',
      );
      checks.freshShadowLoad = true;
    }

    const result = {
      formatVersion: 1,
      status: Object.values(checks).every((x) => x === true)
        ? 'VALIDATED_FOR_LAUNCH'
        : 'VALIDATION_INCOMPLETE',
      releaseId: r.releaseId,
      credentialGenerationId: r.credentialGenerationId,
      deploymentId: cfg.deploymentId,
      sourceBindingsSha256: r.sourceBindingsSha256,
      artifactManifestSha256: r.artifactManifestSha256,
      buildManifestSha256: c.sha(buildRaw),
      closureManifestSha256: c.sha(closureRaw),
      codeClosureSha256: physical.codeDigest(closure),
      configurationSha256: r.configurationSha256,
      expectedProfileSha256: r.expectedProfileSha256,
      compatibilityReceiptsSha256: r.compatibilityReceiptSha256,
      challengeSha256: c.sha(r.challenge),
      childPid: process.pid,
      childStart: fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ')[19],
      postmasterStart: facts.postmasterStart,
      epoch: facts.epoch,
      validationOnly: true,
      httpListening: false,
      businessWrites: false,
      terminalActionsAllowed: false,
      launchAllowed: false,
      runtimeAccepted: false,
      productionSignoff: false,
      checks,
      loaded: [...new Set(state.loaded)].sort(),
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    };
    return result;
  } finally {
    await Promise.all(Object.values(pools).map((p) => p.end()));
    await Promise.all(sessions.map((s) => s.end().catch((error) => {})));
  }
}
main()
  .then((result) => fs.writeSync(3, JSON.stringify(result) + '\n'))
  .catch((error) => {
    fs.writeSync(
      3,
      JSON.stringify({
        formatVersion: 1,
        status: 'VALIDATION_REJECTED',
        failedCheck: phase,
        resource:
          phase === 'NATIVE_KDF' && typeof error?.resource === 'string'
            ? path.basename(error.resource)
            : null,
        code: /^[A-Z0-9_]{3,32}$/.test(error?.code || '') ? error.code : 'REJECTED',
        httpListening: false,
        businessWrites: false,
        launchAllowed: false,
        runtimeAccepted: false,
        evidenceOrigin: 'LOCAL',
        githubActions: false,
      }) + '\n',
    );
    process.exitCode = 1;
  });
