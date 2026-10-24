-- UNAPPLIED inspection candidate: future observer/migrator only, READ ONLY.
SELECT jsonb_build_object(
 'serverVersion',current_setting('server_version_num'),'part','business','database',current_database(),
 'databases',(SELECT jsonb_agg(jsonb_build_object('name',datname,'owner',pg_get_userbyid(datdba),'acl',datacl::text) ORDER BY datname)
  FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')),
 'effectiveDatabasePrivileges',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'database',d.datname,'privilege',v.p,'allowed',has_database_privilege(r.oid,d.oid,v.p)) ORDER BY r.rolname,d.datname,v.p)
  FROM pg_roles r CROSS JOIN pg_database d CROSS JOIN (VALUES('CONNECT'),('CREATE'),('TEMP')) v(p)
  WHERE r.rolname LIKE 'zhiban_reconcile_%' AND d.datname IN('zhiban_m1_dev','zhiban_m5_native')),
 'observerCatalogPermissions',jsonb_build_object(
  'controlSystem',(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'allowed',has_function_privilege('zhiban_reconcile_observer',oid,'EXECUTE'))
    FROM pg_proc WHERE oid='pg_catalog.pg_control_system()'::regprocedure),
  'subscriptionTable',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl::text,'permissions',
    (SELECT jsonb_agg(jsonb_build_object('privilege',v.p,'allowed',has_table_privilege('zhiban_reconcile_observer',c.oid,v.p)) ORDER BY v.p)
      FROM (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(p))) FROM pg_class c WHERE oid='pg_catalog.pg_subscription'::regclass),
  'subscriptionColumns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text,
    'select',has_column_privilege('zhiban_reconcile_observer',attrelid,attnum,'SELECT'),
    'update',has_column_privilege('zhiban_reconcile_observer',attrelid,attnum,'UPDATE'),
    'references',has_column_privilege('zhiban_reconcile_observer',attrelid,attnum,'REFERENCES')) ORDER BY attnum)
    FROM pg_attribute WHERE attrelid='pg_catalog.pg_subscription'::regclass AND attnum>0 AND NOT attisdropped)),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname)
   FROM pg_namespace WHERE nspname IN('zhiban_reconcile','zhiban_reconcile_catalog')),
 'relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY n.nspname,c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('zhiban_reconcile','zhiban_reconcile_catalog','zhiban_content','zhiban_bridge')),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'acl',a.attacl::text) ORDER BY n.nspname,c.relname,a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname IN('zhiban_reconcile','zhiban_content','zhiban_bridge')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),
   'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
   'config',p.proconfig,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('zhiban_reconcile','zhiban_reconcile_catalog')
    OR (n.nspname IN('zhiban_content','zhiban_bridge') AND p.proname IN('operation_guard','link_consistency','mapping_consistency','business_resource_ready'))),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'deferrable',condeferrable,
   'deferred',condeferred,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname)
   FROM pg_constraint WHERE connamespace IN(SELECT oid FROM pg_namespace WHERE nspname IN('zhiban_reconcile','zhiban_content','zhiban_bridge'))),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p
   WHERE schemaname IN('zhiban_reconcile','zhiban_content','zhiban_bridge','zhiban_identity','zhiban_academic')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'definition',pg_get_triggerdef(oid),'enabled',tgenabled)
   ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
   (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('zhiban_reconcile','zhiban_content','zhiban_bridge'))),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,
   'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'config',rolconfig) ORDER BY rolname)
   FROM pg_roles WHERE rolname LIKE 'zhiban_reconcile_%'),
 'edges',(SELECT jsonb_agg(jsonb_build_object('member',m.rolname,'granted',r.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) ORDER BY m.rolname,r.rolname)
   FROM pg_auth_members a JOIN pg_roles m ON m.oid=a.member JOIN pg_roles r ON r.oid=a.roleid
   WHERE m.rolname LIKE 'zhiban_reconcile_%' OR r.rolname LIKE 'zhiban_reconcile_%'),
 'defaults',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',defaclnamespace::regnamespace::text,'type',defaclobjtype,'acl',defaclacl::text) ORDER BY defaclrole,defaclnamespace,defaclobjtype)
   FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM pg_roles WHERE rolname IN('zhiban_identity_owner','zhiban_reconcile_observer')))
) AS terminal_catalog;
