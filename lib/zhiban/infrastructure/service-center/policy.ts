import { z } from 'zod';
const id = z.string().min(1).max(128);
const assignment = z.union([z.string().min(1), z.null(), z.record(z.string(),z.unknown())]);
export const settingsInput = z.object({
  revision: z.number().int().nonnegative().nullable(),
  change: z.discriminatedUnion('kind', [
    z.object({kind:z.literal('slots'),set:z.record(id,assignment).optional(),clear:z.array(id).optional()}).strict(),
    z.object({kind:z.literal('provider'),id,preset:id,apiKey:z.string().max(16384).optional(),baseUrl:z.string().min(1).max(2048).nullable().optional(),models:z.array(z.string().min(1).max(256)).max(200).nullable().optional()}).strict(),
    z.object({kind:z.literal('remove-provider'),id}).strict(),
  ]),
}).strict();
export const probeInput = z.object({
  kind:z.enum(['llm','image','video','document','tts','asr','catalogue']),
  provider:z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  model:z.string().min(1).max(256).optional(),
  revision:z.number().int().nonnegative().nullable(),
}).strict();
export const auditSummary = (change: z.infer<typeof settingsInput>['change']) =>
  change.kind === 'slots' ? { kind:change.kind, slots:[...Object.keys(change.set??{}),...(change.clear??[])] }
  : {kind:change.kind,provider:change.id,...(change.kind==='provider'?{preset:change.preset,keyChanged:change.apiKey!==undefined}: {})};
