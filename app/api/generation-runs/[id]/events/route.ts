// Next route modules expose only HTTP handlers and statically analyzable config.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { GET } from './handler';
