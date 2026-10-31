/** Fixed audited SQL sources, shared by independent reference construction and installation. */
export const preparationFiles = {
  business: [
    'docs/v2/candidates/pg18-provider-v1/bootstrap-roles.pg18.sql',
    'docs/v2/candidates/pg18-provider-v1/bootstrap-bridge-roles.pg18.sql',
    'lib/zhiban/infrastructure/production/service-roles.sql',
  ],
  content: ['docs/v2/candidates/pg18-provider-v1/bootstrap-native-roles.pg18.sql'],
  authoring: ['lib/zhiban/infrastructure/production/authoring-roles.sql'],
} as const;
