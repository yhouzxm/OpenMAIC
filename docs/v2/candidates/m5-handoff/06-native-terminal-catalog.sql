-- UNAPPLIED Native profile collector; privileged read-only installer, not proof worker.
-- Separate connection to Native required. Result combines with Business collector.
SELECT jsonb_build_object(
 'part','native','database',current_database(),'serverVersion',current_setting('server_version_num'),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'table',t.relname,'definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname='public'),
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl::text,'rls',relrowsecurity,'forceRls',relforcerowsecurity) ORDER BY relname)
  FROM pg_class WHERE relnamespace='public'::regnamespace),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,'notNull',a.attnotnull) ORDER BY c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped),
 'effectiveSchemaPrivileges',jsonb_build_object('usage',has_schema_privilege('zhiban_reconcile_native_proof','public','USAGE'),'create',has_schema_privilege('zhiban_reconcile_native_proof','public','CREATE')),
 'effectiveTablePrivileges',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'privilege',v.p,'allowed',has_table_privilege('zhiban_reconcile_native_proof',c.oid,v.p)) ORDER BY c.relname,v.p)
  FROM pg_class c CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(p)
  WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v','m','f')),
 'effectiveColumnPrivileges',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'privilege',v.p,'allowed',has_column_privilege('zhiban_reconcile_native_proof',c.oid,a.attnum,v.p)) ORDER BY c.relname,a.attnum,v.p)
  FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN (VALUES('SELECT'),('UPDATE'),('INSERT'),('REFERENCES')) v(p)
  WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped),
 'defaults',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',defaclnamespace::regnamespace::text,'type',defaclobjtype,'acl',defaclacl::text) ORDER BY defaclrole,defaclnamespace,defaclobjtype)
  FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM pg_roles WHERE rolname IN('zhiban_openmaic_owner','zhiban_reconcile_native_proof')))
) AS terminal_native_catalog;
