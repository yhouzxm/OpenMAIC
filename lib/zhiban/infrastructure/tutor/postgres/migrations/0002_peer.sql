-- Explicit course AI learning companion; legacy conversations remain Tutor.
ALTER TABLE zhiban_tutor.policies ADD COLUMN peer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE zhiban_tutor.sessions ADD COLUMN style text NOT NULL DEFAULT 'TUTOR' CHECK(style IN('TUTOR','PEER'));
GRANT UPDATE(peer_enabled) ON zhiban_tutor.policies TO zhiban_academic_runtime;
-- Session style is immutable. Existing RLS/recipient binding and insert-only audit apply unchanged.
