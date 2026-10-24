import { withAccountControl } from './account-control';
import { prepareLoginIdentifier, registerLoginIdentifier } from './login-identifier-authority';
async function main() {
  const a = process.argv.slice(2);
  const r = await withAccountControl<Record<string, unknown>>((cfg, pools) => {
    if (a[0] === 'prepare' && a.length === 4)
      return prepareLoginIdentifier(cfg, pools, a[1], a[2], a[3]);
    if (['execute', 'inspect'].includes(a[0]) && a.length === 2)
      return registerLoginIdentifier(cfg, pools, a[1], a[0] === 'inspect');
    throw Error('Use prepare USER_ID @ALIAS SUBJECT_REF or execute|inspect SOURCE_REF');
  });
  console.log(
    JSON.stringify(
      { evidenceOrigin: 'LOCAL', githubActions: false, ...r, passwordOrTicketPrinted: false },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    'LOCAL login-identifier operation refused or result unconfirmed. Inspect the original signed source; never transfer a reserved name or automatically retry with a new source. No secret logged.',
  );
  process.exitCode = 1;
});
