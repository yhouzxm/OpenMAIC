-- Preserve UUIDv7 validation without granting the business role a frozen Identity helper.
ALTER TABLE zhiban_onboarding.requests DROP CONSTRAINT requests_id_check;
ALTER TABLE zhiban_onboarding.requests ADD CONSTRAINT requests_id_check CHECK(id::text~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
ALTER TABLE zhiban_onboarding.claims DROP CONSTRAINT claims_id_check;
ALTER TABLE zhiban_onboarding.claims ADD CONSTRAINT claims_id_check CHECK(id::text~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
