/** Optional browser host boundary; ordinary OpenMAIC keeps its existing import policy. */
let suppressLegacyImport = false;
export function suppressGlobalLegacyImport() {
  suppressLegacyImport = true;
}
export function isGlobalLegacyImportSuppressed() {
  return suppressLegacyImport;
}
