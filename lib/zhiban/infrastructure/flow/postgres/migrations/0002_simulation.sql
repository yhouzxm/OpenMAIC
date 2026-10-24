-- Additive immutable server-simulation evidence. No legacy notebook or report rewrite.
CREATE TABLE zhiban_flow.simulation_runs(
 tenant_id uuid NOT NULL,id uuid NOT NULL,notebook_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 50),
 notebook_revision bigint NOT NULL CHECK(notebook_revision>0),source text NOT NULL CHECK(source='SERVER_CALCULATED_SIMULATION'),
 model_id text NOT NULL CHECK(model_id IN('DC_OHM_V1','RC_CHARGE_V1')),model_sha256 text NOT NULL CHECK(model_sha256~'^[a-f0-9]{64}$'),
 executor_source_sha256 text NOT NULL CHECK(executor_source_sha256~'^[a-f0-9]{64}$'),
 input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),output_sha256 text NOT NULL CHECK(output_sha256~'^[a-f0-9]{64}$'),
 parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,notebook_id,id),UNIQUE(tenant_id,notebook_id,sequence),
 FOREIGN KEY(tenant_id,notebook_id) REFERENCES zhiban_flow.notebooks(tenant_id,id)
);
CREATE TABLE zhiban_flow.simulation_report_runs(
 tenant_id uuid NOT NULL,notebook_id uuid NOT NULL,notebook_revision bigint NOT NULL,submission_id uuid NOT NULL,run_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 1 AND 50),
 PRIMARY KEY(tenant_id,notebook_id,notebook_revision,position),UNIQUE(tenant_id,submission_id,run_id),
 FOREIGN KEY(tenant_id,notebook_id,notebook_revision,submission_id) REFERENCES zhiban_flow.reports(tenant_id,notebook_id,notebook_revision,submission_id),
 FOREIGN KEY(tenant_id,notebook_id,run_id) REFERENCES zhiban_flow.simulation_runs(tenant_id,notebook_id,id)
);
REVOKE ALL ON zhiban_flow.simulation_runs,zhiban_flow.simulation_report_runs FROM PUBLIC;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['simulation_runs','simulation_report_runs'] LOOP
 EXECUTE format('ALTER TABLE zhiban_flow.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE zhiban_flow.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_flow.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_flow.%I TO zhiban_academic_runtime',n);
END LOOP; END $$;
