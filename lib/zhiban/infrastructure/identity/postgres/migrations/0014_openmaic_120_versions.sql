-- Add the reviewed v1.2.0 tuple without rewriting any existing deployment or
-- generation. Existing receipts remain bound to their original provider.
ALTER TABLE zhiban_bridge.deployment_registry
  DROP CONSTRAINT deployment_registry_storage_version_check,
  DROP CONSTRAINT deployment_registry_dsl_version_check,
  DROP CONSTRAINT deployment_registry_renderer_version_check,
  ADD CONSTRAINT deployment_registry_provider_versions_check CHECK (
    (storage_version='0.31.1' AND dsl_version='0.11.2' AND renderer_version='0.1.11') OR
    (official_sha='a9da60b3b4adb429369c0da13d5637a904ead2b0' AND
     storage_version='0.37.3' AND dsl_version='0.11.3' AND renderer_version='0.1.14')
  );
ALTER TABLE zhiban_bridge.resource_generations
  DROP CONSTRAINT resource_generations_dsl_version_check,
  ADD CONSTRAINT resource_generations_dsl_version_check CHECK(dsl_version IN ('0.11.2','0.11.3'));
-- A generation stamp must agree with its exact deployment, including legacy
-- rows. Whitelisting both versions alone would admit a mixed provider pair.
ALTER TABLE zhiban_bridge.deployment_registry
  ADD CONSTRAINT deployment_registry_id_dsl_unique UNIQUE(deployment_id,dsl_version);
ALTER TABLE zhiban_bridge.resource_generations
  ADD CONSTRAINT resource_generations_deployment_dsl_fkey
    FOREIGN KEY(deployment_id,dsl_version)
    REFERENCES zhiban_bridge.deployment_registry(deployment_id,dsl_version) ON DELETE RESTRICT;
