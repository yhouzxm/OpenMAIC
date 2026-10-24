#!/usr/bin/env python3
"""Materialize reviewed replacements from exact frozen source bodies; no DB."""
import hashlib
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
content = (ROOT / 'docs/v2/candidates/m5-content/02-helpers-and-guards.sql').read_text()
bridge = (ROOT / 'lib/zhiban/infrastructure/identity/postgres/migrations/0013_openmaic_bridge_consistency_fix.sql').read_text()
def extract(source, name):
    m = re.search(r'CREATE (?:OR REPLACE )?FUNCTION '+re.escape(name)+r'\(.*?\$\$;', source, re.S)
    assert m, name
    return m.group().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
def patch(source, old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)
operation = extract(content, 'zhiban_content.operation_guard')
operation = patch(operation,"session_user<>'zhiban_bridge_runtime'", "session_user NOT IN('zhiban_bridge_runtime','zhiban_reconcile_executor')")
link = extract(content, 'zhiban_content.link_consistency')
link = patch(link,"session_user<>'zhiban_bridge_runtime'", "session_user NOT IN('zhiban_bridge_runtime','zhiban_reconcile_executor')")
link = patch(link, 'a.resource_id=r.id AND a.actor_id=co.actor_id AND (',
    'a.resource_id=r.id AND (a.actor_id=co.actor_id OR zhiban_reconcile.resolved_content_audit(co.tenant_id,co.id,a.id)) AND (')
link = patch(link,"co.state='FAILED' AND a.event_type='OPERATION_FAILED'", "co.state='FAILED' AND a.event_type IN('OPERATION_FAILED','CONTENT_RECONCILED_UNPUBLISHED')")
link = patch(link, 'o.actor_id IS DISTINCT FROM NEW.actor_id',
    '(o.actor_id IS DISTINCT FROM NEW.actor_id AND NOT zhiban_reconcile.resolved_content_audit(NEW.tenant_id,NEW.operation_id,NEW.id))')
link = patch(link,"WHEN 'OPERATION_FAILED' THEN", "WHEN 'CONTENT_RECONCILED_UNPUBLISHED' THEN o.state='FAILED' AND NEW.occurred_at=o.completed_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision AND zhiban_reconcile.resolved_content_audit(NEW.tenant_id,NEW.operation_id,NEW.id)\n          WHEN 'OPERATION_FAILED' THEN")
mapping = extract(bridge, 'zhiban_bridge.mapping_consistency')
old='''v_op.actor_kind IS DISTINCT FROM NEW.actor_kind
      OR v_op.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR v_op.actor_membership_id IS DISTINCT FROM NEW.actor_membership_id
      OR v_op.service_ref IS DISTINCT FROM NEW.service_ref'''
new='''((v_op.actor_kind IS DISTINCT FROM NEW.actor_kind
      OR v_op.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR v_op.actor_membership_id IS DISTINCT FROM NEW.actor_membership_id
      OR v_op.service_ref IS DISTINCT FROM NEW.service_ref)
      AND NOT zhiban_reconcile.resolved_bridge_audit(NEW.tenant_id,NEW.operation_id,NEW.event_id))'''
mapping = patch(mapping, old, new)
text = '-- UNAPPLIED: narrowly scoped replacements, original trigger OIDs/ACL retained.\n'
text += '-- Source hashes: '+hashlib.sha256(content.encode()).hexdigest()+' '+hashlib.sha256(bridge.encode()).hexdigest()+'\n'
text += '\n\n'.join([operation, link, mapping])+'\n'
(HERE / '05-existing-constraint-supplement.sql').write_text(text)
print('Generated three constraint replacements; no original source changed')
