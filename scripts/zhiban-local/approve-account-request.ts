import { withAccountControl } from './account-control';
import { approveLocalAccount, revokeLocalAccount } from './account-authority';
const args = process.argv.slice(2);
async function main() {
  if (
    args.length < 1 ||
    args.length > 2 ||
    !/^[0-9a-f-]{36}$/.test(args[0]) ||
    (args[1] && !['--reissue', '--revoke'].includes(args[1]))
  )
    throw Error('Use: approve-account-request.ts REQUEST_ID [--reissue|--revoke]');
  const result = await withAccountControl<Record<string, unknown>>((cfg, pools) =>
    args[1] === '--revoke'
      ? revokeLocalAccount(cfg, pools, args[0])
      : approveLocalAccount(cfg, pools, args[0], args[1] === '--reissue'),
  );
  console.log(
    JSON.stringify(
      { evidenceOrigin: 'LOCAL', githubActions: false, ...result, ticketOrPasswordPrinted: false },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    'LOCAL account operation refused or outcome unconfirmed. Read the request status and protected source/delivery bundle before retry; no password or ticket is logged.',
  );
  process.exitCode = 1;
});
