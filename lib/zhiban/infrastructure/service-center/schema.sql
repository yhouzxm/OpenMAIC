-- Additive host-local service audit; no Identity or previously applied migration changes.
CREATE TABLE IF NOT EXISTS zhiban_service_events (
 tenant_id uuid NOT NULL, event_id bigint GENERATED ALWAYS AS IDENTITY,
 actor_id uuid NOT NULL, command_id text NOT NULL, event_kind text NOT NULL,
 revision integer, summary jsonb NOT NULL, sealed_intent jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,event_id), UNIQUE(tenant_id,command_id)
);
CREATE TABLE IF NOT EXISTS zhiban_service_owners (
 owner_id text PRIMARY KEY, tenant_id uuid NOT NULL
);
