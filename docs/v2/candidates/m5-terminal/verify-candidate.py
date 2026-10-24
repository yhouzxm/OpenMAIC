#!/usr/bin/env python3
"""Offline static verification; never connects to PG or issues receipts."""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sha=lambda b:hashlib.sha256(b).hexdigest()
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sql-parser',action='store_true',help='require installed pglast in external tooling environment')
parser.add_argument('--output',type=Path)
args=parser.parse_args()
inv=json.loads((HERE/'inventory.json').read_text())
checks=[]
def passed(name,detail):checks.append({'name':name,'status':'PASS','detail':detail})
assert inv['status']=='UNAPPLIED' and inv['evidenceOrigin']=='LOCAL' and inv['githubActions'] is False and not inv['runtimeAccepted']
for name,expected in inv['filesSha256'].items():assert sha((HERE/name).read_bytes())==expected,name
for name,expected in inv['prerequisitesSha256'].items():assert sha((ROOT/name).read_bytes())==expected,name
for name,expected in inv.get('recoveryWiringSha256',{}).items():assert sha((ROOT/name).read_bytes())==expected,name
passed('candidate-and-prerequisite-byte-bindings',len(inv['filesSha256'])+len(inv['prerequisitesSha256']))
aggregate=sha(b''.join((HERE/n).read_bytes() for n in inv['migration']['orderedComponents']))
assert aggregate==inv['migration']['aggregateSha256']
passed('ordered-business-aggregate',aggregate)
for name,expected in inv['derivedReceiptTemplates']['normalizedSha256'].items():
 d=json.loads((HERE/name).read_text())
 assert d['status']=='UNISSUED' and not d['runtimeAccepted'] and d['githubActions'] is False
 assert d['candidateInventorySha256']==sha((HERE/'inventory.json').read_bytes())
 assert d['candidateMigrationSha256']==aggregate
 d['candidateInventorySha256']=d['candidateMigrationSha256']=None
 assert sha(json.dumps(d,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())==expected
passed('unissued-derived-receipts','installation and resolution templates; normalized semantic hashes')
all_sql={p.name:p.read_text() for p in HERE.glob('*.sql')}
def declarations(text):
 return list(re.finditer(r'CREATE (?:OR REPLACE )?FUNCTION\s+([\w.]+)\((.*?)\)(.*?)AS \$\$(.*?)\$\$;',text,re.S))
fn={m[1]:m for text in all_sql.values() for m in declarations(text)}
for f in inv['functions']:assert f['name'] in fn and sha(fn[f['name']][4].encode())==f['bodySha256']
acl=all_sql['07-acl.sql']
for block in re.finditer(r'GRANT EXECUTE ON FUNCTION\s+(.*?)\s+TO\s+([^;]+);',acl,re.S):
 for call in re.finditer(r'([\w.]+)\(([^)]*)\)',block[1]):
  if call[1]=='zhiban_identity.current_tenant_id':continue
  assert call[1] in fn,call[1]
  actual=[part.split()[1] for part in fn[call[1]][2].split(',') if part.strip()]
  assert actual==[part.strip() for part in call[2].split(',') if part.strip()],call.group()
assert not re.search(r'GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*TO\s+zhiban_reconcile_(?:issuer|executor|controller)',acl,re.S)
passed('exact-helper-signatures-and-client-acl','declared helper signatures match EXECUTE grants; no client raw DML/SELECT')
assert len(inv['roles']['newEdges'])==1 and not inv['roles']['ownerEdgesAdded']
assert inv['acl']['nativeDbEnforcedReadOnly'] is False
assert "UPDATE(id)" in all_sql['08-native-proof-acl.sql']
assert "value" not in (HERE/'recovery-request.template.json').read_text()
passed('declared-trust-and-role-boundaries','observer stats edge only; Native id write privilege explicitly disclosed')
final=fn['zhiban_reconcile.finalize_cancel_unpublished'][4]
assert 'UPDATE zhiban_content.resources' not in final and 'UPDATE zhiban_bridge.resource_slots' not in final
assert 'INSERT INTO zhiban_content.publications' not in final and 'ACTIVATE_GENERATION' not in final
assert final.index('lock_grant')<final.index('lock_target')<final.index('INSERT INTO zhiban_reconcile.write_scopes')
assert 'SET CONSTRAINTS ALL IMMEDIATE' in final and 'DELETE FROM zhiban_reconcile.write_scopes' in final
history=fn['zhiban_reconcile.assert_resolution_history'][4]
assert 'now_ms' not in history and 'assert_barrier' not in history and 'controller_context' not in history
assert 'version_status' in history and 'CURRENT' not in history
passed('terminal-scope-and-history-static-boundaries','no pointer/publication mutation; private scope and constraint forcing; no current lease/TTL dependency in history')
takeover=fn['zhiban_reconcile.read_takeover_result'][4]
assert 'controller_context' in takeover and 'successorIsCurrent' in takeover and 'NOT_OBSERVED' in takeover
assert 'currentWindowId' in takeover and 'FOR SHARE' in takeover
assert not re.search(r'\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|zhiban_)',takeover)
passed('takeover-ack-lookup-static-boundaries','controller capability; precise historical pair and current claims; no write replay')
closed=fn['zhiban_reconcile.read_closed_result'][4]
assert 'controller_context' in closed and 'p_epoch' in closed and 'FOR SHARE' in closed
assert 'COMMITTED_CLOSED' in closed and 'NOT_CLOSED' in closed and 'closed_event.sequence' in closed
assert "'restoreAllowed',false" in closed and "'clearMaintenanceFlagAllowed',false" in closed
assert not re.search(r'\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|zhiban_)',closed)
passed('closed-ack-static-boundaries','exact controller/deployment/window/epoch, CLOSED audit and claim checks, observation only')
for name,event in [('issue_result_lookup','LOOKUP_ISSUED'),('revoke_result_lookup','LOOKUP_REVOKED')]:
 body=fn['zhiban_reconcile.'+name][4]
 assert 'INSERT INTO zhiban_reconcile.control_events' in body and event in body and 'p_provenance' in body
assert "IF a.status='REVOKED' THEN RETURN" in fn['zhiban_reconcile.revoke_result_lookup'][4]
passed('lookup-lifecycle-audit-static-boundaries','same helper transaction, explicit provenance and repeated revoke no-op')
assert "'effectiveDatabasePrivileges'" in all_sql['09-catalog-inspect.sql']
assert "'observerCatalogPermissions'" in all_sql['09-catalog-inspect.sql']
assert "'effectiveColumnPrivileges'" in all_sql['10-native-catalog-inspect.sql']
assert 'validate_shape(expected);validate_shape(actual)' in (HERE/'verify-profile.py').read_text()
passed('combined-profile-static-contract','Business/Native collectors, actual cluster/catalog ACL and effective permissions; closed exact offline comparison')
installer=(HERE/'terminal-installation.cjs').read_text()
assert 'REVIEWED_TERMINAL_EXPECTED_PROFILE' in installer and 'INSTALL_LOCAL_TERMINAL_BLOCKED' in installer
assert 'crypto.verify' in installer and 'INSTALLED_BLOCKED' in installer and 'runtimeAccepted: false' in installer
assert "VALUES('0002',$1)" in installer and 'admissionRestored: false' in installer
assert 'const installationChecks = await installerDirected(state)' in (HERE/'verify-local-pg16.cjs').read_text()
passed('signed-blocked-installation-static-boundaries','pinned independent expected, exact approval, atomic ledger, blocked receipt and no reopen')
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('terminal_recovery_candidate',HERE/'recovery-plan.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
request=json.loads((HERE/'recovery-request.template.json').read_text())
for index,key in enumerate(['deploymentId','oldWindowId','newWindowId','takeoverRequestId'],1):
 request[key]=f'0199aabb-ccdd-7000-8000-{index:012d}'
for mode in ['recover','resume']:
 plan=mod.plan(mode,request)
 assert plan['executionSupported'] is False and plan['githubActions'] is False
 assert all('finalize_cancel_unpublished' not in str(s) for s in plan['steps'])
 if mode=='resume':
  names=[s['name'] for s in plan['steps']]
  assert names.index('disable-finalize-before-opening')<names.index('open-both-databases')<names.index('close-ledger-and-release-claims')
 if mode=='recover':
  names=[s['name'] for s in plan['steps']]
  assert names.index('lookup-takeover-before-write')<names.index('atomic-takeover')<names.index('lookup-takeover-after-commit')
  assert next(s for s in plan['steps'] if s['name']=='atomic-takeover')['condition']
for key,value in [('port',55432),('nativeDatabase','production'),('unexpectedField','injected'),('newWindowId',request['oldWindowId'])]:
 invalid={**request,key:value}
 try:mod.plan('recover',invalid)
 except ValueError:continue
 raise AssertionError('Negative request accepted: '+key)
passed('offline-recovery-and-resume-plans','two synthetic plans; other cluster/database/extra field/window replay rejected; never execute finalize')
for name in ['README.md']:
 for target in re.findall(r'\]\(([^)]+)\)',(HERE/name).read_text()):
  assert (HERE/target.split('#')[0]).exists(),target
passed('candidate-document-links','all local Markdown links resolve')
parser_info=None;sql_count=0;pl_count=0;limitations=[]
if args.sql_parser:
 import pglast
 for name,text in sorted(all_sql.items()):
  sql_count+=len(pglast.parse_sql(text))
  for m in declarations(text):
   if 'LANGUAGE plpgsql' not in m[3]:continue
   try:pglast.parse_plpgsql(m.group());pl_count+=1
   except Exception as error:
    if m[1]=='zhiban_reconcile.lock_grant' and 'LookupExplicitNamespace only supports pg_catalog and public' in str(error):
     limitations.append({'function':m[1],'reason':'offline parser does not resolve custom composite return namespace; live compile NOT_RUN'})
    else:raise
 parser_info={'name':'pglast','version':pglast.__version__,'postgresqlGrammar':list(pglast.get_postgresql_version()),'sqlStatements':sql_count,'plpgsqlFunctionsParsed':pl_count,'limitations':limitations}
 passed('sql-and-plpgsql-static-parsing',parser_info)
result={'formatVersion':1,'kind':'LOCAL_M5_TERMINAL_CANDIDATE_STATIC','evidenceOrigin':'LOCAL','githubActions':False,
 'gitBaselineSha':inv['gitBaselineSha'],'candidateInventorySha256':sha((HERE/'inventory.json').read_bytes()),
 'candidateMigrationSha256':aggregate,'status':'STATIC_PASS_WITH_DOCUMENTED_PARSER_LIMIT' if limitations else 'STATIC_PASS','checks':checks,
 'parser':parser_info,'databaseConnected':False,'migrationApplied':False,'receiptIssued':False,'runtimeAccepted':False,
 'notRun':['live function compile/catalog binding','PG16 semantic/RLS/ACL/atomic settlement','Native proof worker','crash recovery/drain/HBA/credential regression','affected host/business regression']}
if args.output:args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'checksPassed':len(checks),'sql':parser_info,'liveChecks':'NOT_RUN'},ensure_ascii=False))
