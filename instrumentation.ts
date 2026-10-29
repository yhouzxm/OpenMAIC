/** Keep Node persistence, providers and workers out of the Edge dependency graph. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('@/lib/server/instrumentation-node');
    await registerNode();
  }
}
