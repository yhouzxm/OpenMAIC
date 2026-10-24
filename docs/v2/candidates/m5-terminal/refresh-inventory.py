#!/usr/bin/env python3
"""Bind uninstalled candidate bytes; does not issue a receipt or contact PG."""
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sha=lambda b:hashlib.sha256(b).hexdigest()
components=['01-schema.sql','02-common-and-history.sql','03-operation-helpers.sql','04-control-and-lookup.sql',
            '05-existing-constraint-supplement.sql','06-guards.sql','07-acl.sql']
templates=['receipt.template.json','resolution-receipt.template.json']
files=sorted(p.name for p in HERE.iterdir() if p.is_file() and p.name not in ['inventory.json',*templates])
legacy=['docs/v2/candidates/m5-content/'+n for n in ['01-schema.sql','02-helpers-and-guards.sql','03-acl.sql']]
legacy+=[str(p.relative_to(ROOT)) for group in ['identity','academic','learning','assessment']
         for p in sorted((ROOT/f'lib/zhiban/infrastructure/{group}/postgres/migrations').glob('*.sql'))]
prerequisite={n:sha((ROOT/n).read_bytes()) for n in legacy}
external=['docs/v2/candidates/m5-terminal-preparation/'+n for n in ['technical-broker.cjs','prepare-reference.ts','README.md']]
external += ['scripts/zhiban-local/launch.ts', 'scripts/zhiban-local/content-receipt.ts']
external_bindings={n:sha((ROOT/n).read_bytes()) for n in external}
assert sha(b''.join((ROOT/n).read_bytes() for n in legacy[:3]))=='e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324'
functions=[]
for name in ['00-catalog-observer.sql',*components]:
 text=(HERE/name).read_text()
 for m in re.finditer(r'CREATE (?:OR REPLACE )?FUNCTION\s+([\w.]+)\((.*?)\)(.*?)AS \$\$(.*?)\$\$;',text,re.S):
  functions.append({'name':m[1],'arguments':' '.join(m[2].split()),'sourceFile':name,
                    'securityDefiner':'SECURITY DEFINER' in m[3],'bodySha256':sha(m[4].encode())})
normalized={}
for name in templates:
 d=json.loads((HERE/name).read_text());assert d['status']=='UNISSUED' and not d['runtimeAccepted']
 for field in ['candidateInventorySha256','candidateMigrationSha256']:d[field]=None
 normalized[name]=sha(json.dumps(d,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
inv={'formatVersion':1,'status':'UNAPPLIED','evidenceOrigin':'LOCAL','githubActions':False,'profile':'terminal-reconciliation-local-v1',
 'gitBaselineSha':'daf63afa83470d24a9ed41d171c6a17f8a80adb6','runtimeAccepted':False,
 'migration':{'schema':'zhiban_content','version':'0002','orderedComponents':components,'aggregateSha256':sha(b''.join((HERE/n).read_bytes() for n in components)),
              'transaction':'one explicit owner transaction; computed ledger INSERT by future installer; no changes to 0001'},
 'filesSha256':{n:sha((HERE/n).read_bytes()) for n in files},'prerequisitesSha256':prerequisite,'recoveryWiringSha256':external_bindings,
 'derivedReceiptTemplates':{'normalizedSha256':normalized,'normalization':'Only candidateInventorySha256/candidateMigrationSha256 replaced by null before compact sorted JSON hashing'},
 'bootstrap':{'clusterRoles':'00-role-bootstrap.sql','businessCatalogObserver':'00-catalog-observer.sql','businessConnectAcl':'00-business-connect.sql','nativeAcl':'08-native-proof-acl.sql','activeMigrationDirectory':False,'loginPasswordSeeded':False,'serviceGrantOrInstallationSeeded':False},
 'functions':functions,
 'roles':{'clients':['zhiban_reconcile_controller','zhiban_reconcile_issuer','zhiban_reconcile_executor','zhiban_reconcile_native_proof'],
          'observer':'zhiban_reconcile_observer','attributes':'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
          'newEdges':[{'member':'zhiban_reconcile_observer','granted':'pg_read_all_stats','admin':False,'inherit':True,'set':False}],
          'ownerEdgesAdded':[],'existingEdgesChanged':False},
 'acl':{'businessClientRawTableGrants':[],'helperExecute':'exact signatures in 07-acl.sql','nativeConnectOnly':'zhiban_reconcile_native_proof','businessPublicConnect':'revoked by explicit additive administrator phase; approved ordinary CONNECT preserved',
        'nativeSelectTables':['document_stages','document_scenes','document_outlines','document_stage_revision','document_scene_revision'],
        'nativeColumnUpdate':{'document_stages':['id']},'nativeDbEnforcedReadOnly':False,'publicFunctions':'no new helper PUBLIC EXECUTE; pre-existing pg_catalog PUBLIC ACL explicitly captured','defaultAclChanged':False},
 'existingFunctionsReplaced':['zhiban_content.operation_guard','zhiban_content.link_consistency','zhiban_bridge.mapping_consistency','zhiban_bridge.business_resource_ready'],
 'rls':{'newTables':'ENABLE/FORCE RLS, owner explicit policies, no client table grants','historicalClosure':'tenant RLS + non-client-callable trigger resource joins; independent of grant TTL/window/current service status',
        'currentWriteCapability':'private backend_pid + txid scope minted/removed only by current-authorized finalize'},
 'profiles':{'oldContent':'must still reject terminal delta','oldNative':'must still reject proof ACL/role delta','terminal':'Business 09 + Native 10 + cluster/database/catalog permissions embedded in 09; verify-profile.py closed comparison; reviewed expected source required'},
 'receiptRequiredBindings':['applied prerequisite ledgers','new content0002 ledger','Business/Native live full catalogs','all role/ACL/function/RLS deltas','owned PG16 cluster/OIDs','reviewed expected combined profile source and database/catalog effective privilege matrices',
                           'maintenance/Native proof/host builds','controller bootstrap/HBA/credentials/logging','LOCAL TR01/TR02/TR03 and affected business regressions'],
 'technicalInstallation':{'module':'terminal-installation.cjs','cli':'terminal-installer.cjs','offlineReviewSigner':'terminal-sign-review.cjs','purpose':'INSTALLED_BLOCKED only','authority':'independently pinned Ed25519 public key + signed shadow expected + exact signed install approval','readySeeded':False,'hostWired':False},
 'deferred':['trusted official expected artifact/authority for existing owned cluster and enabled loader integration','persistent broker and public Native proof worker','existing-cluster approval, credential handoff and complete enabled loader/profile signoff',
             'all PG16 semantic/failure injection/ACL/regression validation','complete enabled gate','production signoff','online reconciliation','Native GC'],
 'recovery':{'planner':'recovery-plan.py','executionSupported':True,'executionModule':'maintenance-executor.cjs','executionScope':'signed LOCAL control only; no business terminal grants/proofs/finalize or automatic host start','lockModule':'maintenance-lock.cjs','hbaModule':'maintenance-hba.cjs','observationModule':'terminal-recovery.cjs','observationScope':'preheld-client partial installation catalog/journal + restricted precise takeover ACK; no replay/open/takeover execution','normalResume':'RESUMING commit before open; CLOSED clears claims but keeps launcher flag until separate credential/build/receipt handoff', 'closedAck':'controller-only exact deployment/window/epoch and bound resume journal; COMMITTED_CLOSED or NOT_CLOSED; no replay/restore/flag release', 'credentialDelivery':'PREPARED_UNDELIVERED durable before ALTER; per-role journal; delivery gate UNISSUED',
             'ackLookup':'controller-only read_takeover_result; exact pair/request plus current claims, no write replay',
             'takeover':'old SUPERSEDED + new PREPARING + epoch counter + both claims atomic; no replay'}}
(HERE/'inventory.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2)+'\n')
subprocess.run(['pnpm','exec','prettier','--write',str(HERE/'inventory.json')],cwd=ROOT,check=True)
invsha=sha((HERE/'inventory.json').read_bytes())
for name in templates:
 d=json.loads((HERE/name).read_text());d['candidateInventorySha256']=invsha;d['candidateMigrationSha256']=inv['migration']['aggregateSha256']
 (HERE/name).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print('UNAPPLIED aggregate:',inv['migration']['aggregateSha256']);print('UNISSUED templates bound to inventory:',invsha)
