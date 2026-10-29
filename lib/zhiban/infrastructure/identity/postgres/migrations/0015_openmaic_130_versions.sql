-- Add the reviewed v1.3.0 tuple. Never relabel a prior receipt/deployment.
ALTER TABLE zhiban_bridge.deployment_registry
  DROP CONSTRAINT deployment_registry_provider_versions_check,
  ADD CONSTRAINT deployment_registry_provider_versions_check CHECK (
    (storage_version='0.31.1' AND dsl_version='0.11.2' AND renderer_version='0.1.11') OR
    (official_sha='a9da60b3b4adb429369c0da13d5637a904ead2b0' AND
     storage_version='0.37.3' AND dsl_version='0.11.3' AND renderer_version='0.1.14') OR
    (official_sha='c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1' AND
     storage_version='0.38.1' AND dsl_version='0.12.0' AND renderer_version='0.2.0')
  );
ALTER TABLE zhiban_bridge.resource_generations
  DROP CONSTRAINT resource_generations_dsl_version_check,
  ADD CONSTRAINT resource_generations_dsl_version_check CHECK(dsl_version IN ('0.11.2','0.11.3','0.12.0'));
-- The existing (deployment_id,dsl_version) FK continues to reject mixed tuples.
