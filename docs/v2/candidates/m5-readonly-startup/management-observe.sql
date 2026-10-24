-- UNEXECUTED. Fixed management-only catalog observation; no application helper calls.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '10000ms';
SELECT pg_catalog.jsonb_build_object(
 'kind','MANAGEMENT_IDENTITY',
 'database',pg_catalog.current_database(),'sessionUser',session_user,'currentUser',current_user,
 'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 'serverVersionNum',pg_catalog.current_setting('server_version_num')::integer,
 'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'dataDirectory',pg_catalog.current_setting('data_directory'),
 'port',pg_catalog.current_setting('port'),
 'socketDirectories',pg_catalog.current_setting('unix_socket_directories'),
 'listenAddresses',pg_catalog.current_setting('listen_addresses'),
 'postmasterStart',pg_catalog.pg_postmaster_start_time(),
 'inRecovery',pg_catalog.pg_is_in_recovery(),
 'transactionReadOnly',pg_catalog.current_setting('transaction_read_only'),
 'defaultTransactionReadOnly',pg_catalog.current_setting('default_transaction_read_only'),
 'sharedPreload',pg_catalog.current_setting('shared_preload_libraries'),
 'sessionPreload',pg_catalog.current_setting('session_preload_libraries'),
 'localPreload',pg_catalog.current_setting('local_preload_libraries'),
 'workerProcesses',pg_catalog.current_setting('max_worker_processes'),
 'logicalWorkers',pg_catalog.current_setting('max_logical_replication_workers'),
 'observeTime',pg_catalog.clock_timestamp(),
 'authorityAccepted',false,'runtimeAccepted',false);
SELECT pg_catalog.jsonb_build_object('kind','TARGET_DATABASES','values',
 coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) ORDER BY d.name),'[]'::jsonb))
FROM (SELECT datname::text AS name,oid::text AS oid,datallowconn AS allow_connections
 FROM pg_catalog.pg_database WHERE datname IN ('zhiban_m1_dev','zhiban_m5_native')) d;
SELECT pg_catalog.jsonb_build_object('kind','ROLE_ATTRIBUTES','values',
 coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.name),'[]'::jsonb))
FROM (SELECT rolname::text AS name,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication
 FROM pg_catalog.pg_roles WHERE rolname !~ '^pg_') r;
SELECT pg_catalog.jsonb_build_object('kind','BACKEND_IDENTITIES','values',
 coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY b.pid),'[]'::jsonb))
FROM (SELECT pid,backend_start,usename::text AS role,datid::text AS database_oid,backend_type
 FROM pg_catalog.pg_stat_activity) b;
SELECT pg_catalog.jsonb_build_object('kind','PREPARED_COUNT','count',count(*)::text)
FROM pg_catalog.pg_prepared_xacts WHERE database IN ('zhiban_m1_dev','zhiban_m5_native');
ROLLBACK;
