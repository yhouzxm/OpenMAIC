import { buildPg18Reference } from './build-pg18-reference';
void buildPg18Reference(process.argv.includes('--verify')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
