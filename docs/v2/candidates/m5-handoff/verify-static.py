#!/usr/bin/env python3
import json,hashlib,re,sys
from pathlib import Path
import pglast
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sha=lambda b:hashlib.sha256(b).hexdigest()
i=json.loads((HERE/'inventory.json').read_text());checks=[]
for n,h in i['filesSha256'].items():assert sha((HERE/n).read_bytes())==h,n
for n,h in i['sourceBindingsSha256'].items():assert sha((ROOT/n).read_bytes())==h,n
assert not any(i[k] for k in ['runtimeAccepted','launchAllowed','terminalActionsAllowed','seededAuthority','signaturesIssued'])
checks.append('source-bindings-and-deferred-authority')
sql='\n'.join((HERE/n).read_text() for n in i['migration']['orderedComponents']);assert sha(b''.join((HERE/n).read_bytes() for n in i['migration']['orderedComponents']))==i['migration']['aggregateSha256']
statements=sum(len(pglast.parse_sql((HERE/n).read_text())) for n in i['migration']['orderedComponents']);pl=0
for f in re.finditer(r'CREATE FUNCTION\s+([\w.]+)\((.*?)\)(.*?)AS \$\$(.*?)\$\$;',sql,re.S):
 if 'LANGUAGE plpgsql' in f[3]:pglast.parse_plpgsql(f.group());pl+=1
assert not re.search(r'\b(?:UPDATE|DELETE FROM|INSERT INTO) zhiban_(?:content|bridge|identity|reconcile)\.',sql)
checks.append('pg16-grammar-and-no-old-business-mutation')
acl=(HERE/'03-acl.sql').read_text();assert 'inspect_host_installation(uuid,uuid,text) TO zhiban_control_runtime' in acl
assert not re.search(r'GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s',acl)
assert 'TO zhiban_reconcile_controller' in acl and 'REVOKE ALL ON ALL FUNCTIONS' in acl
checks.append('client-helper-only-acl-and-owner-rls')
helpers=(HERE/'02-helpers.sql').read_text();assert "current_window_id IS NULL)<>2" in helpers and "n IS DISTINCT FROM a.epoch" in helpers
assert 'Same guarded transaction required' in helpers and "status='CONSUMED'" in helpers and "'COMMIT_PENDING'" in helpers
assert 'DEFERRABLE INITIALLY DEFERRED' in helpers and 'Immutable authorization binding' in helpers
checks.append('same-transaction-commit-and-current-window-barriers')
for p in HERE.glob('*.template.json'):
 d=json.loads(p.read_text());assert d['status']=='UNISSUED',p.name
checks.append('unissued-templates')
contract=json.loads((HERE/'execution.contract.json').read_text());assert contract['executionSupported'] and contract['candidateOnly'] and contract['hostWired'] and contract['signerWired'] and not contract['realTargetExecuted']
checks.append('local-issuer-https-wired-real-authority-deferred')
assert 'Initial authorization state rejected' in helpers and 'authorization_events' in sql and 'audit_authorization' in helpers
checks.append('initial-state-and-atomic-owner-control-audit')
assert 'userRoleInventory' in (HERE/'04-complete-catalog.sql').read_text() and 'c.release_id=p_release' in helpers
checks.append('complete-roles-and-latest-deployment-activation')
for name in [p.name for p in HERE.glob('*.cjs')]:
 import subprocess
 subprocess.run(['node','--check',str(HERE/name)],check=True,capture_output=True)
assert not re.search(r'crypto\.sign|issuerKeyPath|signed\(', (HERE/'handoff-executor.cjs').read_text())
assert 'clearAfterClosed' not in (HERE/'handoff-executor.cjs').read_text() and 'verify_clear_publication' in helpers
checks.append('candidate-executor-syntax-no-issuer-or-unlink')
assert i['builderImplemented'] and i['validationChildImplemented'] and i['physicalDependencyClosureImplemented'] and not i['physicalDependencyClosureVerified']
checks.append('actual-builder-child-wired-real-acceptance-deferred')
builder=(HERE/'release-builder.cjs').read_text();assert 'write: false' in builder and 'baselineStart' in builder and 'esbuildBinary' in builder and 'Nonliteral runtime loader rejected' in builder and 'libraryAliases' in builder
assert not re.search(r'new Client|new Pool|symlinkSync|packages: .external.',builder)
checks.append('exclusive-offline-build-source-tool-native-closure')
child=(HERE/'validation-child.cjs').read_text();parent=(HERE/'validation-parent.cjs').read_text();guard=(HERE/'validation-guard.cjs').read_text()
assert 'default_transaction_read_only=on' in child and 'BEGIN READ WRITE ISOLATION LEVEL READ COMMITTED' in child and 'All frozen composition ledgers required' in child and 'REGISTERED' in child
assert "--permission" in parent and 'childStart' in parent and "--validate-handoff" in guard and 'must not listen' in guard and 'filesystem mutation forbidden' in guard
checks.append('private-fd-challenge-readonly-child-and-runtime-guards')
assert 'compatibilityReceiptsSha256' in (HERE/'host-ack.template.json').read_text() and 'r.compatibilityReceiptsSha256' in (HERE/'handoff-owner.cjs').read_text()
assert 'VALIDATION_INCOMPLETE' in child
checks.append('missing-evidence-blocks-and-ack-binds-compatible-receipts')
assert i['issuerImplemented'] and i['loaderImplemented'] and contract['tlsWired']
assert 'ISSUANCE_COMPLETE' in (HERE/'receipt-completion.cjs').read_text() and 'controlDirectory === input.controlDirectory' in (HERE/'receipt-issuer.cjs').read_text()
assert 'verifyLaunchLocked' in (HERE/'ordinary-launcher.cjs').read_text() and 'ipc' in (HERE/'ordinary-launcher.cjs').read_text()
checks.append('independent-issuer-complete-group-and-lifetime-https-lock')
assert 'issuance-complete.json' in (HERE/'receipt-completion.cjs').read_text() and 'SIGNED_COMMIT_OBSERVED' in (HERE/'receipt-issuer.cjs').read_text()
assert 'ISSUANCE_COMMITTED_ACK_UNKNOWN' in (HERE/'receipt-issuer.cjs').read_text() and 'groupKind' in (HERE/'receipt-completion.cjs').read_text()
checks.append('canonical-master-and-readonly-unknown-ack-inspection')
assert 'SHUTDOWN_MS = 5000' in (HERE/'ordinary-shutdown.cjs').read_text() and 'socket.destroy()' in (HERE/'ordinary-shutdown.cjs').read_text()
assert 'summary.childExitConfirmed && summary.localPgClosed' in (HERE/'ordinary-launcher.cjs').read_text() and 'SHUTDOWN_INCOMPLETE' in (HERE/'ordinary-launcher.cjs').read_text()
checks.append('bounded-local-shutdown-before-fd-release')
for target in re.findall(r'\]\(([^)]+)\)',(HERE/'README.md').read_text()):assert (HERE/target.split('#')[0]).exists(),target
checks.append('local-document-links')
out={'status':'STATIC_PASS','evidenceOrigin':'LOCAL','githubActions':False,'candidateInventorySha256':sha((HERE/'inventory.json').read_bytes()),'candidateMigrationSha256':i['migration']['aggregateSha256'],'checks':checks,'sqlStatements':statements,'plpgsqlFunctions':pl,'grammar':list(pglast.get_postgresql_version()),'runtimeAccepted':False,'liveChecks':'NOT_RUN'}
if '--output' in sys.argv:Path(sys.argv[sys.argv.index('--output')+1]).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
