import { z } from 'zod';
// Public presentation state only. Unknown keys (chat, answers, PBL, tools) reject.
export const publicPlayback = z
  .object({
    sceneId: z.string().min(1).max(128),
    actionIndex: z.number().int().min(0).max(10000),
    mode: z.enum(['paused', 'playing']),
    board: z.string().max(8000),
    summary: z.string().max(4000),
  })
  .strict();
export const liveCommand = z
  .object({
    kind: z.enum(['START', 'UPDATE', 'STOP']),
    revision: z.string().regex(/^(0|[1-9][0-9]{0,14})$/),
    controller: z.string().uuid(),
    state: publicPlayback,
  })
  .strict();
export type PublicPlayback = z.infer<typeof publicPlayback>;
export type LiveCommand = z.infer<typeof liveCommand>;
export const LIVE_TTL_MS = 15000;
