#!/usr/bin/env python3
"""Offline candidate verification. No DB/network access, DDL or receipt issuance."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sha = lambda b: hashlib.sha256(b).hexdigest()
inventory = json.loads((HERE / 'inventory.json').read_text())
receipt = json.loads((HERE / 'receipt.template.json').read_text())
checks = []

def check(name, condition):
    if not condition:
        raise ValueError(name)
    checks.append({'name': name, 'status': 'PASS'})

check('branch and baseline match', subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip() == inventory['gitBranch'] and subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == inventory['gitBaselineSha'])
check('candidate remains unapplied metadata', inventory['status'] == 'UNAPPLIED_CANDIDATE' and not inventory['migration']['automaticRunnerIntegration'])
for name, digest in inventory['filesSha256'].items():
    check('source hash: ' + name, sha((HERE / name).read_bytes()) == digest)
check('ordered logical migration checksum', sha(b''.join((HERE / name).read_bytes() for name in inventory['migration']['orderedComponents'])) == inventory['migration']['aggregateSha256'])
for source in inventory['prerequisiteMigrationSources']:
    path = ROOT / source['path']
    check('prerequisite snapshot: ' + str(path.relative_to(ROOT)), sha(path.read_bytes()) == source['sha256'])
    if source['baseline'] == 'HEAD_EXACT':
        check('frozen HEAD bytes: ' + path.name, path.read_bytes() == subprocess.check_output(['git', 'show', 'HEAD:' + source['path']], cwd=ROOT))
check('receipt binds candidate sources', receipt['candidateInventorySha256'] == sha((HERE / 'inventory.json').read_bytes()) and receipt['candidateMigrationSha256'] == inventory['migration']['aggregateSha256'])
check('receipt unissued, LOCAL and no fabricated observations', receipt['status'] == 'UNISSUED' and receipt['migrationStatus'] == 'UNAPPLIED' and receipt['evidenceOrigin'] == 'LOCAL' and receipt['githubActions'] is False and receipt['runtimeAccepted'] is False and all(receipt[k] is None for k in ['approvalRef', 'issuedAt', 'installedAt', 'acceptedImplementationSha', 'actualServerVersionNum', 'prerequisiteLedgerVerified', 'contentLedgerVerified', 'liveCatalogManifest', 'liveCatalogFingerprint', 'identityUnchangedFingerprint', 'nativeReceiptDigest', 'nativeDeploymentFingerprint', 'sourceArtifactBindings', 'localTlsCspHostBindings']) and set(receipt['checks'].values()) == {'NOT_RUN'})
all_sql = '\n'.join((HERE / f).read_text() for f in inventory['filesSha256'])
# Strip comments; reject unplanned broad/destructive SQL before optional parsing.
code = re.sub(r'--[^\n]*', '', all_sql)
check('no role/database/bootstrap/ledger rewrite or automatic transaction', not re.search(r'\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|DATABASE)\b|\bDROP\s|\bTRUNCATE\s|\bDELETE\s+FROM|\bUPDATE\s+\w+\.schema_migrations\b|^\s*(?:COMMIT|ROLLBACK|BEGIN)\s*;', code, re.I | re.M))
check('single existing function replacement is structural gate', re.findall(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([\w.]+)', code, re.I) == ['zhiban_bridge.business_resource_ready'])
check('exact same-client role and no new academic raw grant', inventory['acl']['businessLoginRole'] == 'zhiban_bridge_runtime' and not inventory['acl']['newRoles'] and not inventory['acl']['rawAcademicPrivilegesForBridge'] and not re.search(r'GRANT\s+[^;]*\sON\s+zhiban_academic\.', code, re.I))
parser = {'status': 'NOT_RUN', 'reason': 'Optional isolated pglast 6.x / PG16 not installed; hash checks are not syntax proof.'}
try:
    import pglast
    from pglast import ast
except ImportError:
    pass
else:
    check('offline parser is PostgreSQL 16', pglast.get_postgresql_version()[0] == 16)
    parser = {'status': 'PASS', 'pglastVersion': pglast.__version__, 'postgresqlParserVersion': list(pglast.get_postgresql_version()), 'files': []}
    parsed_functions = []
    for name in inventory['filesSha256']:
        sql = (HERE / name).read_text()
        statements = pglast.parse_sql(sql)
        bodies = pglast.parse_plpgsql(sql)
        dynamic_count = 0
        for match in re.finditer(r"EXECUTE format\('((?:[^']|'')*)'", sql):
            pglast.parse_sql(match[1].replace("''", "'").replace('%I', 'probe_table'))
            dynamic_count += 1
        sql_body_count = 0
        for raw in statements:
            node = raw.stmt
            if isinstance(node, ast.CreateFunctionStmt):
                opts = {o.defname: o.arg for o in node.options}
                function_name = '.'.join(v.sval for v in node.funcname)
                parsed_functions.append(function_name)
                expected = next(f for f in inventory['candidateFunctions'] if f['name'] == function_name)
                check('function body binding: ' + function_name, sha(opts['as'][0].sval.encode()) == expected['bodySha256'])
                check('function security binding: ' + function_name, opts.get('security', ast.Boolean(boolval=False)).boolval == expected['securityDefiner'])
                if opts['language'].sval == 'sql':
                    pglast.parse_sql(opts['as'][0].sval)
                    sql_body_count += 1
        parser['files'].append({'file': name, 'sqlStatements': len(statements), 'parsedFunctionAndDoBodies': len(bodies), 'sqlLanguageBodies': sql_body_count, 'dynamicDdlTemplates': dynamic_count})
    check('complete declared function set', sorted(parsed_functions) == sorted(f['name'] for f in inventory['candidateFunctions']))
result = {'formatVersion': 1, 'evidenceOrigin': 'LOCAL', 'scope': 'OFFLINE_UNAPPLIED_CANDIDATE_ONLY', 'gitBaselineSha': inventory['gitBaselineSha'], 'inventorySha256': sha((HERE / 'inventory.json').read_bytes()), 'verifierSha256': sha(Path(__file__).read_bytes()), 'migrationAggregateSha256': inventory['migration']['aggregateSha256'], 'checkCount': len(checks), 'checks': checks, 'syntaxParser': parser, 'databaseConnections': 0, 'migrationApplied': False, 'liveCatalogOrAclVerified': False, 'receiptIssued': False, 'commitPushCiDispatch': False, 'limitations': ['No live SQL semantic/type resolution', 'No ACL/RLS/row-lock/concurrency/Native or host validation', 'Static source snapshots do not establish live ledger match']}
print(json.dumps(result, ensure_ascii=False, indent=2))
