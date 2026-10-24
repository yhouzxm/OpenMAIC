#!/usr/bin/env python3
"""Offline candidate planner. No DB/network/subprocess/credential access, ever.

Produces a reviewable ordered recovery/resume plan; not an execution runner.
All parameter values for secrets are symbolic private-slot references.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
V7 = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
WRITERS = ['zhiban_migrator', 'zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime',
           'zhiban_bridge_runtime', 'zhiban_academic_runtime', 'zhiban_openmaic_migrator', 'zhiban_openmaic_runtime']
MAINTENANCE = ['zhiban_reconcile_controller', 'zhiban_reconcile_issuer', 'zhiban_reconcile_executor', 'zhiban_reconcile_native_proof']

def private_slot(name):
    return {'privateSlot': name, 'value': 'NEVER_IN_PLAN'}

def step(kind, name, **facts):
    return {'kind': kind, 'name': name, **facts}

def verify_sources():
    inventory = json.loads((HERE/'inventory.json').read_text())
    for name, expected in inventory['filesSha256'].items():
        if hashlib.sha256((HERE/name).read_bytes()).hexdigest() != expected:
            raise ValueError('Candidate source drift: '+name)
    return hashlib.sha256((HERE/'inventory.json').read_bytes()).hexdigest()

def plan(mode, request):
    expected = {'formatVersion', 'evidenceOrigin', 'pgMajor', 'port', 'businessDatabase', 'nativeDatabase',
                'deploymentId', 'oldWindowId', 'newWindowId', 'takeoverRequestId', 'approvalRef'}
    if set(request) != expected or request['formatVersion'] != 1 or request['evidenceOrigin'] != 'LOCAL':
        raise ValueError('Closed candidate request rejected')
    if (request['pgMajor'], request['port'], request['businessDatabase'], request['nativeDatabase']) != (16, 55433, 'zhiban_m1_dev', 'zhiban_m5_native'):
        raise ValueError('Only the owned LOCAL PG16 dev target is allowed')
    for key in ['deploymentId', 'oldWindowId', 'newWindowId', 'takeoverRequestId']:
        if not isinstance(request[key], str) or not V7.fullmatch(request[key]):
            raise ValueError('UUIDv7 required: '+key)
    if request['oldWindowId'] == request['newWindowId']:
        raise ValueError('Window replay rejected')
    # Approval content is not loaded. A text field alone never enables execution.
    if request['approvalRef'] is not None and (not isinstance(request['approvalRef'],str) or len(request['approvalRef'])>256):
        raise ValueError('Approval reference rejected')
    steps = [
        step('GATE', 'source-and-local-target-preflight', requirements=[
            'explicit maintenance/recovery approval for this exact target',
            'PG16 cluster system identifier/database OIDs/postmaster/live ACL and receipt hashes match',
            'no prepared transactions/subscriptions/background writers/unreviewed extensions',
            'controller authorization newly owner-issued and backend-bound',
            'private durable journal (0600), maintenance flock, stopped host/launchers',
            'no changes to original 55432 test cluster']),
    ]
    if mode == 'recover':
        steps += [
            step('ADMIN_SQL', 'close-both-databases', connection='postgres', sql=[
                'ALTER DATABASE zhiban_m1_dev ALLOW_CONNECTIONS false',
                'ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false'], journal='intent/confirmed per database'),
            step('ADMIN_SQL', 'disable-all-old-login-roles', connection='postgres', sql=['ALTER ROLE '+role+' NOLOGIN' for role in WRITERS+MAINTENANCE]),
            step('GATE', 'rotate-credentials-and-install-bootstrap-hba', requirements=[
                'rotate ALL old maintenance and ordinary writer credentials without logging parameters',
                'deny ordinary and old-maintenance trust/peer/cert-mapped paths',
                'only new controller exact source/role allowed; pg_hba reload/catalog verified',
                'negative connection probes (old credentials and ordinary roles) must fail']),
            step('ADMIN_SQL', 'terminate-and-confirm-old-backends', connection='postgres', sql=[
                "SELECT pg_terminate_backend(pid,1000) FROM pg_stat_activity WHERE datname IN ('zhiban_m1_dev','zhiban_m5_native')",
                "SELECT pid,backend_start,usename,datid FROM pg_stat_activity WHERE datname IN ('zhiban_m1_dev','zhiban_m5_native')"], require='both target lists empty; cancellation/timeout is not drain acknowledgement'),
            step('ADMIN_SQL', 'business-bootstrap-only', connection='postgres', sql=[
                'ALTER ROLE zhiban_reconcile_controller LOGIN',
                'ALTER DATABASE zhiban_m1_dev ALLOW_CONNECTIONS true'], require='Native false; ordinary admission and other maintenance roles still denied'),
            step('GATE', 'authorize-new-controller-backend', requirements=[
                'preopen new controller Business client',
                'owner installs fresh controller_authorizations for exact PID/backend_start/nonce/TTL and deployment',
                'no terminal DML using administrator credentials']),
            step('HELPER_TRANSACTION', 'lookup-takeover-before-write', connection='new-controller', isolation='read committed',
                 sql='SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5)',
                 parameters=[request['deploymentId'],request['oldWindowId'],request['newWindowId'],request['takeoverRequestId'],private_slot('newControllerCapability')],
                 require='COMMITTED: never repeat this takeover; if successor lost its controller, start a NEW request targeting currentWindowId; NOT_OBSERVED is not replay authority'),
            step('GATE', 'select-reviewed-takeover-path', requirements=[
                'atomic-takeover below is conditional: exact lookup NOT_OBSERVED AND locked claims/oldWindowId scope still current AND fresh recovery approval',
                'COMMITTED skips the same takeover; dead successor requires a fresh old/new/request/nonce and another full drain/bootstrap',
                'on mismatch/unknown/error STOP BLOCKED; do not infer rollback']),
            step('HELPER_TRANSACTION', 'atomic-takeover', connection='new-controller', isolation='read committed',
                 sql='SELECT zhiban_reconcile.takeover_blocked_window($1,$2,$3,$4,$5)',
                 parameters=[request['oldWindowId'],request['newWindowId'],request['takeoverRequestId'],private_slot('newWindowNonce'),private_slot('newControllerCapability')],
                 condition='only approved NOT_OBSERVED path; never unconditional replay',
                 require='old grant invalidation, SUPERSEDED/predecessor/successor, epoch counter and two claims commit together'),
            step('HELPER_TRANSACTION', 'lookup-takeover-after-commit', connection='new-controller', isolation='read committed',
                 sql='SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5)',
                 parameters=[request['deploymentId'],request['oldWindowId'],request['newWindowId'],request['takeoverRequestId'],private_slot('newControllerCapability')],
                 require='exact COMMITTED pair; after disconnect run a fresh full bootstrap before lookup; on unknown STOP BLOCKED'),
            step('GATE', 'if-takeover-ack-unknown', requirements=[
                'keep host stopped/admission blocked',
                'new bootstrap checks takeover_request_id/claims before any additional takeover',
                'dead successor is itself superseded to a higher epoch; never revive old capability',
                'finalize is NEVER replayed']),
            step('GATE', 'preopen-new-maintenance-clients', requirements=[
                'PREPARING only: temporarily open Native exclusively to new proof role',
                'preopen registered issuer/executor/proof clients with fresh credentials',
                'verify all backend identities; then disable LOGIN again',
                'no issue_grant/register_proof/finalize during bootstrap']),
            step('ADMIN_SQL', 'reclose-both-databases', connection='postgres', sql=[
                'ALTER DATABASE zhiban_m1_dev ALLOW_CONNECTIONS false',
                'ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS false']),
            step('HELPER_TRANSACTION', 'fresh-drain-and-barrier', connection='new-controller',
                 sql='SELECT zhiban_reconcile.renew_barrier($1,$2)', parameters=[request['newWindowId'],private_slot('newControllerCapability')],
                 require='zero non-allowlisted backend, exact actual catalog, fresh epoch; heartbeat every 10 seconds'),
            step('STOP', 'recovery-completed-maintenance-only', requirements=[
                'databases remain closed; host remains stopped',
                'ACK_UNKNOWN terminal result is queried only via read_recovery_result with exact tenant/operation/request',
                'no new terminal grant without a new per-operation approval']),
        ]
    else:
        steps += [
            step('HELPER_TRANSACTION', 'disable-finalize-before-opening', connection='registered-controller',
                 sql='SELECT zhiban_reconcile.begin_resume($1,$2)', parameters=[request['oldWindowId'],private_slot('controllerCapability')],
                 require='COMMIT RESUMING and revoke unconsumed grants before administrator opens either database'),
            step('GATE', 'restore-new-credentials-and-exact-admission', requirements=[
                'all old writer processes drained and old credentials unusable',
                'restore only reviewed role LOGIN/pg_hba ACL and private new credentials',
                'record actual partial results; on failure host stays stopped']),
            step('ADMIN_SQL', 'open-both-databases', connection='postgres', sql=[
                'ALTER DATABASE zhiban_m1_dev ALLOW_CONNECTIONS true',
                'ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true']),
            step('GATE', 'validate-restored-profile', requirements=['exact new installation receipts/role graph/ACL/credential handoff verified', 'no old-maintenance credential admitted']),
            step('HELPER_TRANSACTION', 'close-ledger-and-release-claims', connection='registered-controller',
                 sql='SELECT zhiban_reconcile.complete_resume($1,$2)', parameters=[request['oldWindowId'],private_slot('controllerCapability')]),
            step('GATE', 'release-maintenance-flag-and-launch', requirements=['CLOSED committed, two claims NULL', 'new verified host build only']),
        ]
    return {'formatVersion':1,'kind':'LOCAL_TERMINAL_RECOVERY_PLAN_CANDIDATE','status':'UNEXECUTED',
            'evidenceOrigin':'LOCAL','githubActions':False,'executionSupported':False,
            'candidateInventorySha256':verify_sources(),'mode':mode,'request':request,'steps':steps,
            'onAnyFailure':'BLOCKED; no finally reopen; do not replay finalize; durable intent/confirmed journal',
            'notRead':['password files','private DSNs','existing runtime receipts'],'notPerformed':['connect','DDL','DML','termination','receipt issuance']}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',required=True,choices=['recover','resume'])
    parser.add_argument('--request',required=True,type=Path)
    args=parser.parse_args()
    try:
        print(json.dumps(plan(args.mode,json.loads(args.request.read_text())),ensure_ascii=False,indent=2))
    except (ValueError,KeyError,TypeError) as error:
        parser.error(str(error))
