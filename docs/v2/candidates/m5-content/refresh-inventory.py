#!/usr/bin/env python3
"""Refresh reviewed candidate byte bindings; no database or receipt issuance."""
import hashlib,json,re
from pathlib import Path
here=Path(__file__).resolve().parent
sha=lambda data:hashlib.sha256(data).hexdigest()
inventory=json.loads((here/'inventory.json').read_text())
for f in inventory['filesSha256']:inventory['filesSha256'][f]=sha((here/f).read_bytes())
inventory['migration']['aggregateSha256']=sha(b''.join((here/f).read_bytes() for f in inventory['migration']['orderedComponents']))
for function in inventory['candidateFunctions']:
 sql=(here/function['sourceFile']).read_text()
 match=re.search(r'CREATE (?:OR REPLACE )?FUNCTION\s+'+re.escape(function['name'])+r'\s*\(.*?AS \$\$(.*?)\$\$;',sql,re.S)
 if not match:raise ValueError(function['name'])
 function['body']=match[1];function['bodySha256']=sha(match[1].encode())
columns=next(t['columns'] for t in inventory['candidateTables'] if t['name']=='zhiban_content.operations')
if not any(c['name']=='expected_native_digest' for c in columns):
 index=next(n for n,c in enumerate(columns) if c['name']=='prepare_operation_id')
 columns.insert(index,{'name':'expected_native_digest','type':'text','definition':"expected_native_digest text CHECK (expected_native_digest ~ '^[a-f0-9]{64}$')"})
inventory['profiles']['protectedRoleEdges']={'zhiban_migrator->zhiban_identity_owner':{'admin_option':False,'inherit_option':False,'set_option':True},'otherOwnerEdges':[],'bridgeRuntimeIncomingAndOutgoingEdges':[],'migratorIncomingAndOtherOutgoingEdges':[]}
inventory['publicationInvariants']={'reverseActiveLink':'every ACTIVE generation for every resource slot binds exact current publication, successful content operation and PUBLISHED/ENABLED or WITHDRAWN/SUSPENDED','failedFenceRelease':'prepare absent or terminal SUCCEEDED/FAILED, activation absent or terminal FAILED; unresolved Bridge references reject','allResourceActivationsRequireExactlyOneContentPublish':True,'activationBinding':'same tenant/resource, exact content bridge_operation_id, matching PREPARE_CONTENT slot/generation; all states including RESERVED/OUTCOME_UNKNOWN','allResourcePreparesRequireContentReservation':True,'reservedCommitRequiresPrepareReference':True,'expectedNativeDigest':'immutable, non-null exactly for PUBLISH_CONTENT; equals generation and publication digest','prepareOperationUniquePerTenant':True,'prepareCreationMustNotPrecedeContentReservation':True}
(here/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
receipt=json.loads((here/'receipt.template.json').read_text())
assert receipt['status']=='UNISSUED' and not receipt['runtimeAccepted']
receipt['candidateInventorySha256']=sha((here/'inventory.json').read_bytes());receipt['candidateMigrationSha256']=inventory['migration']['aggregateSha256']
(here/'receipt.template.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print('Updated UNAPPLIED sources; receipt remains UNISSUED:',inventory['migration']['aggregateSha256'])
