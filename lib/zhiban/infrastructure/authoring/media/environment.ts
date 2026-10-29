/** LOCAL launchers may load provider secrets, never redirect owned DBs, processes or storage roots. */
export function providerEnvironment(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return (
        typeof value === 'string' &&
        !/^(?:NEXT_PUBLIC_|NODE_|PG|DATABASE|HOME$|PATH$|LD_)/.test(key) &&
        ([
          'ZHIBAN_OFFICE_CONVERTER_PATH',
          'ZHIBAN_OFFICE_CONVERTER_ROOT',
          'DEFAULT_MODEL',
          'OPENMAIC_CONFIG',
          'RENDER_SERVICE_URL',
          'ZHIBAN_MATERIAL_PARSER_CONFIG',
          'ZHIBAN_MATERIAL_PARSER_SHA256',
        ].includes(key) ||
          /^[A-Z][A-Z0-9_]*_(?:API_KEY|API_TOKEN|ACCESS_TOKEN|TOKEN|SECRET|ACCESS_KEY_ID|ACCESS_KEY_SECRET|BASE_URL|ENDPOINT|MODELS|REGION)$/.test(
            key,
          ))
      );
    }),
  );
}
