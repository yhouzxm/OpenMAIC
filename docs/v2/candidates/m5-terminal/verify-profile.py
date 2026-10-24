#!/usr/bin/env python3
"""Compare complete candidate profile snapshots offline; never issues authority.

Expected snapshot must come from a separately reviewed installer profile, never
copied from the live target during issuance. This CLI cannot establish that trust.
"""
import argparse
import json
from pathlib import Path

BUSINESS_KEYS={'serverVersion','part','database','databases','effectiveDatabasePrivileges','observerCatalogPermissions','schemas','relations','columns','functions','constraints','policies','triggers','roles','edges','defaults'}
NATIVE_KEYS={'indexes','serverVersion','part','database','schemas','relations','columns','effectiveSchemaPrivileges','effectiveTablePrivileges','effectiveColumnPrivileges','defaults'}
TABLES={'document_stages','document_scenes','document_outlines','document_stage_revision','document_scene_revision'}

def validate_shape(profile):
    if set(profile)!={'business','native'}:raise ValueError('Two independent collector parts required')
    for part,keys,db in [('business',BUSINESS_KEYS,'zhiban_m1_dev'),('native',NATIVE_KEYS,'zhiban_m5_native')]:
        item=profile[part]
        if set(item)!=keys or item['part']!=part or item['database']!=db or not 160000<=int(item['serverVersion'])<=169999:
            raise ValueError('Closed PG16 collector scope rejected: '+part)
    b,n=profile['business'],profile['native']
    for i in n['indexes'] or []:
        if not i['valid'] or not i['ready'] or not i['live']:raise ValueError('Native invalid/unready index rejected')
    if {d['name'] for d in b['databases'] or []}!={'zhiban_m1_dev','zhiban_m5_native'}:raise ValueError('Database ACL scope incomplete')
    catalog=b['observerCatalogPermissions']
    if not catalog['controlSystem']['allowed']:raise ValueError('Observer control-system EXECUTE missing')
    if any(p['allowed'] for p in catalog['subscriptionTable']['permissions']):raise ValueError('Observer whole-table privilege rejected')
    columns=catalog['subscriptionColumns']
    if not {'oid','subdbid','subenabled'}<={p['name'] for p in columns if p['select']} or any((p['name']=='subconninfo' and p['select']) or p['update'] or p['references'] for p in columns):
        raise ValueError('Observer column privilege drift')
    database_permissions=b['effectiveDatabasePrivileges']
    expected_roles={'zhiban_reconcile_controller','zhiban_reconcile_issuer','zhiban_reconcile_executor','zhiban_reconcile_native_proof','zhiban_reconcile_observer'}
    expected_pairs={(r,d,p) for r in expected_roles for d in ['zhiban_m1_dev','zhiban_m5_native'] for p in ['CONNECT','CREATE','TEMP']}
    actual_pairs={(v['role'],v['database'],v['privilege']) for v in database_permissions or []}
    if actual_pairs!=expected_pairs or len(database_permissions)!=len(expected_pairs):raise ValueError('Effective database matrix incomplete/extra roles')
    for v in database_permissions:
        target='zhiban_m5_native' if v['role']=='zhiban_reconcile_native_proof' else 'zhiban_m1_dev'
        allowed=v['privilege']=='CONNECT' and v['role']!='zhiban_reconcile_observer' and v['database']==target
        if v['allowed'] is not allowed:raise ValueError('Effective cross-database privilege rejected')
    if n['effectiveSchemaPrivileges']!={'usage':True,'create':False}:raise ValueError('Native schema privilege rejected')
    rows=n['effectiveTablePrivileges'] or []
    if not TABLES<={v['table'] for v in rows}:raise ValueError('Native required tables missing')
    for v in rows:
        if v['allowed'] is not (v['table'] in TABLES and v['privilege']=='SELECT'):raise ValueError('Native table privilege drift')
    columns=n['effectiveColumnPrivileges'] or []
    if not any(v['table']=='document_stages' and v['column']=='id' and v['privilege']=='UPDATE' and v['allowed'] for v in columns):
        raise ValueError('Native required id lock privilege missing')
    for v in columns:
        allowed=(v['table'] in TABLES and v['privilege']=='SELECT') or (v['table']=='document_stages' and v['column']=='id' and v['privilege']=='UPDATE')
        if v['allowed'] is not allowed:raise ValueError('Native column privilege drift')

def compare(expected,actual):
    validate_shape(expected);validate_shape(actual)
    # Deterministic ordered collector arrays; empty/null distinction is preserved.
    if expected!=actual:raise ValueError('Exact reviewed profile drift')
    return {'status':'OFFLINE_PROFILE_MATCH','runtimeAccepted':False,'receiptIssued':False,'evidenceOrigin':'LOCAL','githubActions':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected',required=True,type=Path)
    parser.add_argument('--actual',required=True,type=Path)
    args=parser.parse_args()
    try:print(json.dumps(compare(json.loads(args.expected.read_text()),json.loads(args.actual.read_text()))))
    except (ValueError,KeyError,TypeError) as error:parser.error(str(error))
