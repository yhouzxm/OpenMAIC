-- NOT EXECUTED. Read-only inspection inputs for a future LOCAL receipt issuer.
-- Run with private admin connection after explicit install; never via HTTP.
-- Capture structured rows privately, not passwords/connection URLs.
SELECT current_database() AS database,current_setting('port') AS port,
 current_setting('data_directory') AS data_directory,current_setting('server_version_num') AS server_version_num;
SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls
 FROM pg_roles WHERE rolname IN ('zhiban_identity_owner','zhiban_bridge_runtime') ORDER BY rolname;
SELECT r.rolname AS member,granted.rolname AS granted_role,m.admin_option,m.inherit_option,m.set_option
 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid
 WHERE r.rolname IN ('zhiban_identity_owner','zhiban_bridge_runtime')
 OR granted.rolname IN ('zhiban_identity_owner','zhiban_bridge_runtime') ORDER BY member,granted_role;
SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,d.defaclobjtype,d.defaclacl
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner')
 ORDER BY schema,d.defaclobjtype;
SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,n.nspacl
 FROM pg_namespace n WHERE n.nspname IN ('zhiban_identity','zhiban_bridge','zhiban_academic','zhiban_content') ORDER BY n.nspname;
SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN ('zhiban_bridge','zhiban_academic','zhiban_content')
 ORDER BY n.nspname,c.relname;
SELECT n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attacl,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
 AND n.nspname IN ('zhiban_content','zhiban_academic') ORDER BY n.nspname,c.relname,a.attnum;
SELECT n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,
 ARRAY(SELECT CASE WHEN id=0 THEN 'PUBLIC' ELSE pg_get_userbyid(id) END FROM unnest(p.polroles) id ORDER BY id) AS roles,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('zhiban_bridge','zhiban_academic','zhiban_content') ORDER BY n.nspname,c.relname,p.polname;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_function_result(p.oid) AS result,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.provolatile,
 p.proisstrict,p.proparallel,p.proconfig,p.proacl,p.prosrc,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='zhiban_content' OR (n.nspname='zhiban_bridge' AND p.proname='business_resource_ready')
 ORDER BY n.nspname,p.proname,arguments;
SELECT n.nspname,c.relname,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('zhiban_bridge','zhiban_content') ORDER BY n.nspname,c.relname,t.tgname;
SELECT n.nspname,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) AS definition
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='zhiban_content' ORDER BY c.relname,k.conname;
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='zhiban_content' ORDER BY tablename,indexname;
SELECT 'identity' AS context,version,checksum FROM zhiban_identity.schema_migrations
 UNION ALL SELECT 'academic',version,checksum FROM zhiban_academic.schema_migrations
 UNION ALL SELECT 'learning',version,checksum FROM zhiban_learning.schema_migrations
 UNION ALL SELECT 'assessment',version,checksum FROM zhiban_assessment.schema_migrations
 UNION ALL SELECT 'content',version,checksum FROM zhiban_content.schema_migrations ORDER BY context,version;
-- Existing exact baseline manifest verifier must additionally compare effective
-- database CONNECT/CREATE/TEMP, schema ACL, default ACL and every unchanged
-- Identity/private Native object/role. This query file is not that verifier.
