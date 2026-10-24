#!/usr/bin/env python3
"""Offline proposal grammar/contract checker. Never starts/connects PostgreSQL."""
import hashlib,json,re,sys
from pathlib import Path
from pglast import ast,parse_sql,get_postgresql_version
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sha=lambda b:hashlib.sha256(b).hexdigest()
v=json.loads((HERE/'request.template.json').read_text());checks=[]
assert v['status']=='UNISSUED_PLAN' and not any(v[k] for k in ['executionAllowed','realTargetExecuted','runtimeAccepted','launchAllowed','businessWritesAllowed','commitAllowed','pushAllowed','ciDispatchAllowed'])
assert all(x is None for x in v['pending'].values());checks.append('unissued-scope-and-pending-private-inputs')
r6=ROOT/'docs/v2/candidates/m5-handoff/inventory.json';assert sha(r6.read_bytes())==v['source']['handoffInventorySha256'];h=json.loads(r6.read_text())
for n,s in h['filesSha256'].items():assert sha((r6.parent/n).read_bytes())==s,n
for n,s in h['sourceBindingsSha256'].items():assert sha((ROOT/n).read_bytes())==s,n
checks.append('unchanged-r6-source-binding')
assert v['target']['dataDirectory']=='/home/zxm/.local/share/zhiban-m1/pgdata' and v['target']['systemIdentifier']=='7694054813252049413' and v['target']['port']==55433
assert v['client']['database']=='postgres' and v['client']['role']=='postgres' and '-X' in v['client']['options'] and '-w' in v['client']['options'];checks.append('fixed-management-endpoint-no-credential-fallback')
o=v['fixedServerOverrides'];assert o['listen_addresses']=='' and o['shared_preload_libraries']=='' and o['max_logical_replication_workers']=='0' and o['log_statement']=='none' and o['log_parameter_max_length']=='0' and o['default_transaction_read_only']=='on';checks.append('socket-isolation-and-startup-overrides')
lines=[l for l in (HERE/'management-only-hba.conf').read_text().splitlines() if l and not l.startswith('#')]
assert lines==['local postgres postgres scram-sha-256','local all all reject','local replication all reject','host all all 0.0.0.0/0 reject','host all all ::/0 reject','host replication all 0.0.0.0/0 reject','host replication all ::/0 reject'];checks.append('exact-scram-management-only-hba')
allowed_funcs={'jsonb_build_object','jsonb_agg','to_jsonb','current_database','current_setting','pg_control_system','pg_postmaster_start_time','pg_is_in_recovery','clock_timestamp','count'}
allowed_relations={'pg_database','pg_roles','pg_stat_activity','pg_prepared_xacts'}
def validate(sql):
 nodes=parse_sql(sql)
 def walk(n):
  if isinstance(n,(tuple,list)):
   for x in n:walk(x)
  elif isinstance(n,ast.Node):
   kind=type(n).__name__
   if kind.endswith('Stmt'):assert kind in ['SelectStmt','VariableSetStmt','TransactionStmt'],kind
   if isinstance(n,ast.SelectStmt):assert n.intoClause is None and not n.lockingClause
   if isinstance(n,ast.RangeVar):assert n.schemaname=='pg_catalog' and n.relname in allowed_relations
   if isinstance(n,ast.FuncCall):
    name=[x.sval for x in n.funcname];assert name[-1] in allowed_funcs and (len(name)==1 or name[0]=='pg_catalog'),name
   for field in n:walk(getattr(n,field))
 for n in nodes:walk(n.stmt)
 return nodes
sql=(HERE/'management-observe.sql').read_text();nodes=validate(sql)
assert re.search(r'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',sql) and sql.rstrip().endswith('ROLLBACK;')
assert [type(n.stmt).__name__ for n in nodes]==['TransactionStmt']+['VariableSetStmt']*4+['SelectStmt']*5+['TransactionStmt'];checks.append('pg16-grammar-and-fixed-readonly-catalog-whitelist')
for bad in ['SELECT pg_catalog.pg_reload_conf();','SELECT * FROM zhiban_content.resources;','WITH x AS (DELETE FROM pg_catalog.pg_database RETURNING *) SELECT * FROM x;','SELECT * INTO new_table FROM pg_catalog.pg_database;']:
 try:validate(bad)
 except (AssertionError,Exception):pass
 else:raise AssertionError('Unsafe observation query accepted')
checks.append('negative-write-custom-call-and-table-rejection')
assert not any(v['failure'][k] for k in ['automaticImmediateStop','automaticRestart','deletePidOrSocketFiles','releaseLockWithoutConfirmedStop','fallbackToExistingHbaOrCredentials','filePublicationOrReceiptRecovery']);checks.append('unknown-result-no-replay-or-flag-clear')
a=json.loads((HERE/'observation-approval.template.json').read_text())
assert a['status']=='UNISSUED' and a['humanAuthorizationRef'] is None and a['issuedAt'] is None and a['expiresAt'] is None
assert all(x is None for x in a['paths'].values()) and all(x is None for x in a['hashes'].values())
assert a['scope']['managementReadOnly'] is True and a['scope']['internalLifecycleWrites'] is True and a['scope']['privateAuthenticationStaging'] is True and all(x is False for k,x in a['scope'].items() if k not in ['managementReadOnly','internalLifecycleWrites','privateAuthenticationStaging'])
checks.append('unissued-executor-approval-and-exact-denied-capabilities')
assert a['target']['dataDirectory']==v['target']['dataDirectory'] and a['target']['systemIdentifier']==v['target']['systemIdentifier'] and a['target']['port']==v['target']['port']
checks.append('executor-template-same-real-target')
for t in re.findall(r'\]\(([^)]+)\)',(HERE/'README.md').read_text()):assert (HERE/t.split('#')[0]).exists(),t
checks.append('local-document-links')
files={p.name:sha(p.read_bytes()) for p in HERE.iterdir() if p.is_file() and p.name!='inventory.json'}
bindings={'docs/v2/zhiban-v2-m5-observer-custody-design.md':sha((ROOT/'docs/v2/zhiban-v2-m5-observer-custody-design.md').read_bytes())}
checks.append('source-bound-local-custody-and-authentication-staging-design')
i={'formatVersion':1,'status':'UNISSUED_PLAN','executionAllowed':False,'runtimeAccepted':False,'realTargetExecuted':False,'evidenceOrigin':'LOCAL','githubActions':False,'r6InventorySha256':sha(r6.read_bytes()),'filesSha256':files,'sourceBindingsSha256':bindings}
(HERE/'inventory.json').write_text(json.dumps(i,indent=2)+'\n')
out={'status':'STATIC_PLAN_PASS','evidenceOrigin':'LOCAL','githubActions':False,'r6InventorySha256':i['r6InventorySha256'],'planInventorySha256':sha((HERE/'inventory.json').read_bytes()),'checks':checks,'sqlStatements':len(nodes),'grammar':list(get_postgresql_version()),'realTargetExecuted':False,'credentialsRead':False,'runtimeAccepted':False}
if '--output' in sys.argv:Path(sys.argv[sys.argv.index('--output')+1]).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
