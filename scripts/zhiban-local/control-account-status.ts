import { withAccountControl } from './account-control';
import {
  prepareAccountStatus,
  executeAccountStatus,
  inspectAccountStatus,
  statusReasons,
  type StatusReason,
} from './account-status';
async function main() {
  const args = process.argv.slice(2),
    mode = args[0];
  const result = await withAccountControl<Record<string, unknown>>((cfg, pools) => {
    if (
      mode === 'prepare' &&
      args.length === 4 &&
      ['disable', 'restore'].includes(args[2]) &&
      statusReasons.includes(args[3] as StatusReason)
    )
      return prepareAccountStatus(
        cfg,
        pools,
        args[1],
        args[2] === 'disable' ? 'USER_DISABLE' : 'USER_RESTORE',
        args[3] as StatusReason,
      );
    if (args.length === 2 && mode === 'inspect') return inspectAccountStatus(cfg, pools, args[1]);
    if (args.length === 2 && ['execute', 'confirm'].includes(mode))
      return executeAccountStatus(cfg, pools, args[1], mode === 'confirm');
    throw Error(
      'Use prepare USER_ID disable|restore REASON, or inspect|execute|confirm OPERATION_REF',
    );
  });
  console.log(
    JSON.stringify(
      { evidenceOrigin: 'LOCAL', githubActions: false, ...result, secretPrinted: false },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    'LOCAL global account operation refused or result unconfirmed. Do not automatically retry. Use inspect OPERATION_REF; confirm only an unchanged applied result, otherwise prepare a new independently approved operation. No secret is logged.',
  );
  process.exitCode = 1;
});
