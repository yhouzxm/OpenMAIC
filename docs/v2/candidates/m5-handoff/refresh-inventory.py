#!/usr/bin/env python3
"""Offline candidate binding; no DB, signing, installation or gate changes."""
import hashlib,json,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sha=lambda b:hashlib.sha256(b).hexdigest()
components=['01-schema.sql','02-helpers.sql','03-acl.sql']
terminal=ROOT/'docs/v2/candidates/m5-terminal/inventory.json'
assert sha(terminal.read_bytes())=='4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a'
old=json.loads(terminal.read_text())
for n,h in old['filesSha256'].items():assert sha((terminal.parent/n).read_bytes())==h,n
for g in ['prerequisitesSha256','recoveryWiringSha256']:
 for n,h in old[g].items():assert sha((ROOT/n).read_bytes())==h,n
files=sorted(p for p in HERE.iterdir() if p.is_file() and p.name!='inventory.json')
source_files=['docs/v2/zhiban-v2-m5-handoff-clear-design.md','scripts/zhiban-local/release-product.ts','scripts/zhiban-local/release-https.ts','scripts/zhiban-local/build-m5.ts','scripts/zhiban-local/config.ts','scripts/zhiban-local/content-receipt.ts','scripts/zhiban-local/launch.ts','scripts/zhiban-local/server.ts','lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher.ts']
inv={'formatVersion':1,'status':'UNAPPLIED','evidenceOrigin':'LOCAL','githubActions':False,'runtimeAccepted':False,'launchAllowed':False,'terminalActionsAllowed':False,
 'baselineSha':'daf63afa83470d24a9ed41d171c6a17f8a80adb6','profile':'ordinary-host-after-terminal-local-v1',
 'migration':{'schema':'zhiban_handoff','version':'0001','orderedComponents':components,'aggregateSha256':sha(b''.join((HERE/n).read_bytes() for n in components)),'activeMigrationDirectory':False,'transaction':'one owner transaction + future computed new ledger INSERT; no existing ledger rewrite'},
 'filesSha256':{p.name:sha(p.read_bytes()) for p in files},'terminalPrerequisiteInventorySha256':sha(terminal.read_bytes()),'terminalPrerequisiteMigrationSha256':old['migration']['aggregateSha256'],
 'sourceBindingsSha256':{n:sha((ROOT/n).read_bytes()) for n in source_files},
 'acl':{'newRoleEdges':[],'newNativeGrants':[],'clientTableGrants':[], 'hostFactsRole':'zhiban_control_runtime','clearControlRole':'zhiban_reconcile_controller','newTables':'FORCE RLS owner internal only'},
 'seededAuthority':False,'signaturesIssued':False,'builderImplemented':True,'validationChildImplemented':True,'physicalDependencyClosureImplemented':True,'localActualBuildValidated':True,'issuerImplemented':True,'installerImplemented':True,'loaderImplemented':True,'gatePublisherImplemented':True,'ownerSeedersImplemented':True,'deliveryExecutorImplemented':True,'controlLoaderImplemented':True,'physicalDependencyClosureVerified':False,
 'notImplemented':['independently reviewed real ordinary expected/shadow remains UNISSUED','independent real-host/shadow acceptance of physical closure and native ABI/OS library references','real management transport/shadow attestation and independently reviewed issuer inputs','real issuance, OS/browser CA trust installation, explicit file-publication recovery approval and target HBA/credential delivery','real product/host and complete OS crash/restart acceptance']}
(HERE/'inventory.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2)+'\n')
subprocess.run(['pnpm','exec','prettier','--write',str(HERE/'inventory.json')],cwd=ROOT,check=True)
print(json.dumps({'status':'UNAPPLIED','inventorySha256':sha((HERE/'inventory.json').read_bytes()),'migrationSha256':inv['migration']['aggregateSha256'],'files':len(files)},ensure_ascii=False))
