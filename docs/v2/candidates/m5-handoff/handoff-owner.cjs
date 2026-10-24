// Reviewed private owner boundary. No arbitrary SQL/roles, no password rotation.
const fs = require('node:fs'),
  path = require('node:path');
const h = require('./handoff-contracts.cjs');
async function transaction(b, work) {
  await b.query('BEGIN READ WRITE ISOLATION LEVEL READ COMMITTED');
  try {
    await b.query('SET LOCAL ROLE zhiban_identity_owner');
    await b.query("SET LOCAL lock_timeout='1000ms'");
    const result = await work();
    await b.query('COMMIT');
    return result;
  } catch (e) {
    await b.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
async function closed(b, p) {
  const row = (
    await b.query(
      'SELECT * FROM zhiban_reconcile.windows WHERE window_id=$1 AND deployment_id=$2',
      [p.windowId, p.deploymentId],
    )
  ).rows[0];
  h.requireValue(
    row?.phase === 'CLOSED' && row.epoch === p.epoch,
    'Latest CLOSED owner scope required',
  );
  await b.query('SELECT 1 FROM zhiban_reconcile.services WHERE service_ref=$1 FOR SHARE', [
    row.service_ref,
  ]);
  const n = (
    await b.query(
      'SELECT epoch::text FROM zhiban_reconcile.epoch_counters WHERE deployment_id=$1 FOR SHARE',
      [p.deploymentId],
    )
  ).rows[0];
  await b.query('SELECT 1 FROM zhiban_reconcile.windows WHERE window_id=$1 FOR SHARE', [
    p.windowId,
  ]);
  const claims = (
    await b.query(
      'SELECT current_window_id FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=$1 AND database_oid IN($2,$3) ORDER BY database_oid FOR SHARE',
      [p.target.cluster, p.target.businessOid, p.target.nativeOid],
    )
  ).rows;
  h.requireValue(
    n?.epoch === p.epoch &&
      claims.length === 2 &&
      claims.every((x) => x.current_window_id === null),
    'Current epoch/empty claims required',
  );
  h.requireValue(
    (
      await b.query(
        "SELECT count(*)::int n FROM zhiban_reconcile.windows WHERE deployment_id=$1 AND phase NOT IN('CLOSED','SUPERSEDED')",
        [p.deploymentId],
      )
    ).rows[0].n === 0,
    'Active maintenance scope rejected',
  );
  const events = (
    await b.query(
      "SELECT sequence::text,event_type,actor_role,provenance_digest,occurred_at FROM zhiban_reconcile.control_events WHERE window_id=$1 AND deployment_id=$2 AND event_type IN('CLOSED','RESUMING') ORDER BY sequence",
      [p.windowId, p.deploymentId],
    )
  ).rows;
  h.requireValue(
    events.length === 2 &&
      events[0].event_type === 'RESUMING' &&
      events[1].event_type === 'CLOSED' &&
      events[1].sequence === p.closedEventSequence &&
      events.every(
        (x) =>
          x.actor_role === 'zhiban_reconcile_controller' &&
          x.provenance_digest === row.nonce_digest,
      ) &&
      BigInt(events[0].occurred_at) <= BigInt(events[1].occurred_at),
    'CLOSED audit binding rejected',
  );
  h.requireValue(
    (
      await b.query(
        "SELECT count(*)::int n FROM zhiban_reconcile.grants WHERE window_id=$1 AND status='ISSUED'",
        [p.windowId],
      )
    ).rows[0].n === 0,
    'Outstanding terminal grants rejected',
  );
  const i = (
    await b.query('SELECT * FROM zhiban_reconcile.installations WHERE deployment_id=$1', [
      p.deploymentId,
    ])
  ).rows[0];
  h.requireValue(
    i?.cluster_identifier === p.target.cluster &&
      String(i.business_oid) === p.target.businessOid &&
      String(i.native_oid) === p.target.nativeOid &&
      row.cluster_identifier === i.cluster_identifier &&
      row.business_oid === i.business_oid &&
      row.native_oid === i.native_oid,
    'Exact owner installation target required',
  );
}
async function ledger(b, source, after) {
  h.requireValue(
    h.canonical(
      (
        await b.query(
          'SELECT version,checksum FROM zhiban_content.schema_migrations ORDER BY version',
        )
      ).rows,
    ) ===
      h.canonical([
        {
          version: '0001',
          checksum: 'e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324',
        },
        { version: '0002', checksum: source.inv.terminalPrerequisiteMigrationSha256 },
      ]),
    'Frozen prerequisite ledger rejected',
  );
  if (after)
    h.requireValue(
      h.canonical(
        (
          await b.query(
            'SELECT version,checksum FROM zhiban_handoff.schema_migrations ORDER BY version',
          )
        ).rows,
      ) === h.canonical([{ version: '0001', checksum: source.inv.migration.aggregateSha256 }]),
      'Handoff ledger rejected',
    );
}
async function install(ctx, approval, expected) {
  const p = approval.payload;
  h.live(p);
  h.requireValue(p.expectedProfileSha256 === expected.digest, 'Install expected binding required');
  await h.target(ctx.business, p.target);
  await h.nativeTarget(ctx.native, p.target);
  h.profile(await h.collect(ctx.business, ctx.native, false), expected.payload.before);
  return transaction(ctx.business, async () => {
    h.live(p);
    await ledger(ctx.business, ctx.source, false);
    for (const n of ctx.source.inv.migration.orderedComponents)
      await ctx.business.query(fs.readFileSync(path.join(__dirname, n), 'utf8'));
    await ctx.business.query("INSERT INTO zhiban_handoff.schema_migrations VALUES('0001',$1)", [
      ctx.source.inv.migration.aggregateSha256,
    ]);
    await ledger(ctx.business, ctx.source, true); // Same transaction metadata verification; collect() must not nest BEGIN.
    const complete = (
      await ctx.business.query(
        fs.readFileSync(path.join(__dirname, '04-complete-catalog.sql'), 'utf8'),
        [h.SCHEMAS, h.ROLES],
      )
    ).rows[0].installation_catalog;
    const terminal = (
      await ctx.business.query(
        fs.readFileSync(path.join(__dirname, '05-business-terminal-catalog.sql'), 'utf8'),
      )
    ).rows[0].terminal_catalog;
    h.requireValue(
      h.canonical({ complete, terminal }) === h.canonical(expected.payload.after.business),
      'Installed Business profile rejected',
    );
    h.live(p);
    return { status: 'INSTALLED_BLOCKED', launchAllowed: false };
  });
}
async function register(ctx, approval, expected, readSecret) {
  const p = approval.payload;
  h.live(p);
  h.requireValue(
    h.digest.test(readSecret) && p.expectedProfileSha256 === expected.digest,
    'Prepare expected/token binding required',
  );
  await h.target(ctx.business, p.target);
  await h.nativeTarget(ctx.native, p.target);
  h.profile(await h.collect(ctx.business, ctx.native), expected.payload.after);
  await ledger(ctx.business, ctx.source, true);
  return transaction(ctx.business, async () => {
    await closed(ctx.business, p);
    h.live(p);
    await ctx.business.query(
      "INSERT INTO zhiban_handoff.host_read_authorizations VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,'REGISTERED')",
      [
        p.deploymentId,
        p.releaseId,
        p.credentialGenerationId,
        p.epoch,
        h.sha(readSecret),
        p.artifactManifestSha256,
        p.configurationSha256,
        p.expectedProfileSha256,
        p.sourceBindingsSha256,
      ],
    );
    return { status: 'REGISTERED_UNACTIVATED', launchAllowed: false };
  });
}
function bindReceipt(receipt, approval, ack, readSecret) {
  const r = receipt.payload,
    p = approval.payload,
    a = ack.payload;
  for (const k of [
    'deploymentId',
    'releaseId',
    'credentialGenerationId',
    'target',
    'sourceBindingsSha256',
    'artifactManifestSha256',
    'configurationSha256',
    'windowId',
    'epoch',
    'closedEventSequence',
    'fenceId',
    'fenceSequence',
  ])
    h.requireValue(h.canonical(r[k]) === h.canonical(p[k]), 'Receipt/prepare mismatch');
  h.requireValue(
    r.prepareApprovalId === p.approvalId &&
      r.handoffId === p.handoffId &&
      r.profileSha256 === p.expectedProfileSha256 &&
      r.hostAckSha256 === ack.digest &&
      r.compatibilityReceiptsSha256 === a.compatibilityReceiptsSha256 &&
      r.readAuthorization.permissionDigest === h.sha(readSecret),
    'Late receipt authority binding rejected',
  );
  for (const k of [
    'deploymentId',
    'releaseId',
    'credentialGenerationId',
    'sourceBindingsSha256',
    'artifactManifestSha256',
    'configurationSha256',
    'expectedProfileSha256',
  ])
    h.requireValue(a[k] === p[k], 'ACK/prepare mismatch');
  h.keys(
    a.checks,
    Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'host-ack.template.json'))).checks),
  );
  h.requireValue(
    a.validationOnly === true &&
      a.httpListening === false &&
      a.businessWrites === false &&
      Object.values(a.checks).every((v) => v === true),
    'Incomplete product validation ACK',
  );
}
async function seal(ctx, approval, expected, receipt, ack, readSecret, challengeSha256) {
  const p = approval.payload;
  h.live(p);
  bindReceipt(receipt, approval, ack, readSecret);
  h.requireValue(
    ack.payload.challengeSha256 === challengeSha256 && h.digest.test(challengeSha256),
    'Fresh ACK challenge required',
  );
  await h.target(ctx.business, p.target);
  await h.nativeTarget(ctx.native, p.target);
  h.profile(await h.collect(ctx.business, ctx.native), expected.payload.after);
  await ledger(ctx.business, ctx.source, true);
  return transaction(ctx.business, async () => {
    await closed(ctx.business, p);
    const changed = await ctx.business.query(
      "UPDATE zhiban_handoff.host_read_authorizations SET status='ACTIVE',handoff_receipt_digest=$1 WHERE deployment_id=$2 AND release_id=$3 AND status='REGISTERED' AND credential_generation_id=$4 AND epoch=$5 AND token_digest=$6 AND artifact_manifest_digest=$7 AND configuration_digest=$8 AND profile_digest=$9 AND source_digest=$10",
      [
        receipt.digest,
        p.deploymentId,
        p.releaseId,
        p.credentialGenerationId,
        p.epoch,
        h.sha(readSecret),
        p.artifactManifestSha256,
        p.configurationSha256,
        p.expectedProfileSha256,
        p.sourceBindingsSha256,
      ],
    );
    h.requireValue(changed.rowCount === 1, 'One-time exact seal required');
    h.live(p);
    return { status: 'HANDOFF_VERIFIED', launchAllowed: false };
  });
}
async function revoke(ctx, approval, expected) {
  const p = approval.payload;
  h.live(p);
  h.requireValue(
    p.expectedProfileSha256 === expected.digest,
    'Revocation profile binding rejected',
  );
  await h.target(ctx.business, p.target);
  await h.nativeTarget(ctx.native, p.target);
  h.profile(await h.collect(ctx.business, ctx.native), expected.payload.after);
  await ledger(ctx.business, ctx.source, true);
  return transaction(ctx.business, async () => {
    const changed = await ctx.business.query(
      "UPDATE zhiban_handoff.host_read_authorizations SET status='REVOKED' WHERE deployment_id=$1 AND release_id=$2 AND token_digest=$3 AND status IN('REGISTERED','ACTIVE')",
      [p.deploymentId, p.releaseId, p.hostPermissionSha256],
    );
    h.requireValue(changed.rowCount === 1, 'Exact revocable host scope required');
    h.live(p);
    return { status: 'REVOKED', launchAllowed: false };
  });
}
async function seedClear(ctx, approval, expected, controller, controllerSecret, clearSecret) {
  const p = approval.payload;
  h.live(p);
  h.requireValue(
    p.profileSha256 === expected.digest &&
      h.digest.test(controllerSecret) &&
      h.digest.test(clearSecret),
    'Clear seed authority required',
  );
  await h.target(ctx.business, p.target);
  await h.nativeTarget(ctx.native, p.target);
  h.profile(await h.collect(ctx.business, ctx.native), expected.payload.after, true);
  await ledger(ctx.business, ctx.source, true);
  return transaction(ctx.business, async () => {
    await closed(ctx.business, p);
    const hrow = (
      await ctx.business.query(
        'SELECT * FROM zhiban_handoff.host_read_authorizations WHERE deployment_id=$1 AND release_id=$2 FOR SHARE',
        [p.deploymentId, p.releaseId],
      )
    ).rows[0];
    h.requireValue(
      hrow?.status === 'ACTIVE' &&
        hrow.epoch === p.epoch &&
        hrow.credential_generation_id === p.credentialGenerationId &&
        hrow.handoff_receipt_digest === p.handoffReceiptSha256 &&
        hrow.artifact_manifest_digest === p.artifactManifestSha256 &&
        hrow.profile_digest === p.profileSha256 &&
        hrow.source_digest === p.sourceBindingsSha256,
      'Exact sealed host scope required',
    );
    const observed = (
      await ctx.business.query('SELECT zhiban_reconcile_catalog.observe($1,$2) value', [
        p.target.businessOid,
        p.target.nativeOid,
      ])
    ).rows[0].value;
    const physical = observed.backends.filter(
      (x) =>
        x.pid === controller.processID &&
        x.role === 'zhiban_reconcile_controller' &&
        x.databaseOid === p.target.businessOid &&
        x.type === 'client backend',
    );
    h.requireValue(
      physical.length === 1 &&
        observed.cluster === p.target.cluster &&
        new Date(observed.postmasterStart).toISOString() ===
          new Date(p.postmasterStart).toISOString(),
      'Preopened physical controller required',
    );
    const backend = {
      pid: physical[0].pid,
      backend_start: physical[0].start,
      postmaster: observed.postmasterStart,
    };
    await ctx.business.query(
      "INSERT INTO zhiban_reconcile.controller_authorizations SELECT $1,$2,$3,$4,$5,$6,$7,'ACTIVE' ON CONFLICT(deployment_id) DO UPDATE SET token_digest=excluded.token_digest,backend_pid=excluded.backend_pid,backend_start=excluded.backend_start,nonce_digest=excluded.nonce_digest,expires_at=excluded.expires_at,provenance_digest=excluded.provenance_digest,status='ACTIVE'",
      [
        p.deploymentId,
        h.sha(controllerSecret),
        backend.pid,
        backend.backend_start,
        h.sha(clearSecret),
        p.expiresAt,
        approval.digest,
      ],
    );
    await ctx.business.query(
      "INSERT INTO zhiban_handoff.clear_authorizations VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ISSUED')",
      [
        p.approvalId,
        p.deploymentId,
        p.releaseId,
        p.windowId,
        p.epoch,
        p.fenceId,
        p.fenceSequence,
        h.sha(clearSecret),
        approval.digest,
        p.targetGateSha256,
        p.pointerSha256,
        p.fenceHistorySha256,
        backend.pid,
        backend.backend_start,
        backend.postmaster,
        p.issuedAt,
        p.expiresAt,
      ],
    );
    h.live(p);
    return { status: 'CLEAR_SEEDED_BLOCKED', launchAllowed: false };
  });
}
module.exports = { install, register, seal, revoke, seedClear, bindReceipt };
