/** Explicit reuse allowlist. No open proxy and no upstream public publication/identity/config writes. */
import * as h0 from '@/app/api/generation-runs/events/route';
import * as h1 from '@/app/api/agent/sessions/status/route';
import * as h2 from '@/app/api/model-config/import/route';
import * as h3 from '@/app/api/agent/owner-events/route';
import * as h4 from '@/app/api/server-providers/route';
import * as h5 from '@/app/api/folders/members/route';
import * as h6 from '@/app/api/generation-runs/route';
import * as h7 from '@/app/api/agent/sessions/route';
import * as h8 from '@/app/api/agent/runtime/route';
import * as h9 from '@/app/api/agents/import/route';
import * as h10 from '@/app/api/agent/skills/route';
import * as h11 from '@/app/api/model-config/route';
import * as h12 from '@/app/api/materials/route';
import * as h13 from '@/app/api/folders/route';
import * as h14 from '@/app/api/stages/route';
import * as h15 from '@/app/api/agents/route';
import * as h16 from '@/app/api/usage/route';
import * as h17 from '@/app/api/generation-runs/[id]/confirm-outline/route';
import * as h18 from '@/app/api/generation-runs/[id]/hold-outline/route';
import * as h19 from '@/app/api/stages/[id]/generation-complete/route';
import * as h20 from '@/app/api/agent/sessions/[id]/messages/route';
import * as h21 from '@/app/api/generation-runs/[id]/events/route';
import * as h22 from '@/app/api/agent/sessions/[id]/cancel/route';
import * as h23 from '@/app/api/agent/sessions/[id]/events/route';
import * as h24 from '@/app/api/generation-runs/[id]/retry/route';
import * as h25 from '@/app/api/materials/[id]/extraction/route';
import * as h26 from '@/app/api/stages/[id]/freshness/route';
import * as h27 from '@/app/api/persistence/[...path]/route';
import * as h28 from '@/app/api/stages/[id]/manifest/route';
import * as h29 from '@/app/api/stage-meta/[stageId]/route';
import * as h30 from '@/app/api/generation-runs/[id]/route';
import * as h31 from '@/app/api/agent/sessions/[id]/route';
import * as h32 from '@/app/api/stages/[id]/scenes/route';
import * as h33 from '@/app/api/stages/[id]/status/route';
import * as h34 from '@/app/api/agent/skills/[id]/route';
import * as h35 from '@/app/api/materials/[id]/route';
import * as h36 from '@/app/api/folders/[id]/route';
import * as h37 from '@/app/api/stages/[id]/route';
import * as h38 from '@/app/api/agents/[id]/route';
import * as original from '@/app/api/materials/[id]/original/route';
import * as library from '@/app/api/materials/library/route';
import * as materialFolders from '@/app/api/materials/folders/route';
import * as materialFolder from '@/app/api/materials/folders/[id]/route';
import * as materialMove from '@/app/api/materials/move/route';
export const nativeRoutes = [
  { pattern: /^\/api\/materials\/([^/]+)\/original$/, keys: ['id'], handlers: original },
  { pattern: /^\/api\/materials\/library$/, keys: [], handlers: library },
  { pattern: /^\/api\/materials\/folders$/, keys: [], handlers: materialFolders },
  { pattern: /^\/api\/materials\/folders\/([^/]+)$/, keys: ['id'], handlers: materialFolder },
  { pattern: /^\/api\/materials\/move$/, keys: [], handlers: materialMove },
  { pattern: new RegExp('^/api/generation-runs/events$'), keys: [], handlers: h0 },
  { pattern: new RegExp('^/api/agent/sessions/status$'), keys: [], handlers: h1 },
  { pattern: new RegExp('^/api/model-config/import$'), keys: [], handlers: h2 },
  { pattern: new RegExp('^/api/agent/owner-events$'), keys: [], handlers: h3 },
  { pattern: new RegExp('^/api/server-providers$'), keys: [], handlers: h4 },
  { pattern: new RegExp('^/api/folders/members$'), keys: [], handlers: h5 },
  { pattern: new RegExp('^/api/generation-runs$'), keys: [], handlers: h6 },
  { pattern: new RegExp('^/api/agent/sessions$'), keys: [], handlers: h7 },
  { pattern: new RegExp('^/api/agent/runtime$'), keys: [], handlers: h8 },
  { pattern: new RegExp('^/api/agents/import$'), keys: [], handlers: h9 },
  { pattern: new RegExp('^/api/agent/skills$'), keys: [], handlers: h10 },
  { pattern: new RegExp('^/api/model-config$'), keys: [], handlers: h11 },
  { pattern: new RegExp('^/api/materials$'), keys: [], handlers: h12 },
  { pattern: new RegExp('^/api/folders$'), keys: [], handlers: h13 },
  { pattern: new RegExp('^/api/stages$'), keys: [], handlers: h14 },
  { pattern: new RegExp('^/api/agents$'), keys: [], handlers: h15 },
  { pattern: new RegExp('^/api/usage$'), keys: [], handlers: h16 },
  {
    pattern: new RegExp('^/api/generation-runs/([^/]+)/confirm-outline$'),
    keys: ['id'],
    handlers: h17,
  },
  {
    pattern: new RegExp('^/api/generation-runs/([^/]+)/hold-outline$'),
    keys: ['id'],
    handlers: h18,
  },
  { pattern: new RegExp('^/api/stages/([^/]+)/generation-complete$'), keys: ['id'], handlers: h19 },
  { pattern: new RegExp('^/api/agent/sessions/([^/]+)/messages$'), keys: ['id'], handlers: h20 },
  { pattern: new RegExp('^/api/generation-runs/([^/]+)/events$'), keys: ['id'], handlers: h21 },
  { pattern: new RegExp('^/api/agent/sessions/([^/]+)/cancel$'), keys: ['id'], handlers: h22 },
  { pattern: new RegExp('^/api/agent/sessions/([^/]+)/events$'), keys: ['id'], handlers: h23 },
  { pattern: new RegExp('^/api/generation-runs/([^/]+)/retry$'), keys: ['id'], handlers: h24 },
  { pattern: new RegExp('^/api/materials/([^/]+)/extraction$'), keys: ['id'], handlers: h25 },
  { pattern: new RegExp('^/api/stages/([^/]+)/freshness$'), keys: ['id'], handlers: h26 },
  { pattern: new RegExp('^/api/persistence/(.+)$'), keys: ['path'], handlers: h27 },
  { pattern: new RegExp('^/api/stages/([^/]+)/manifest$'), keys: ['id'], handlers: h28 },
  { pattern: new RegExp('^/api/stage-meta/([^/]+)$'), keys: ['stageId'], handlers: h29 },
  { pattern: new RegExp('^/api/generation-runs/([^/]+)$'), keys: ['id'], handlers: h30 },
  { pattern: new RegExp('^/api/agent/sessions/([^/]+)$'), keys: ['id'], handlers: h31 },
  { pattern: new RegExp('^/api/stages/([^/]+)/scenes$'), keys: ['id'], handlers: h32 },
  { pattern: new RegExp('^/api/stages/([^/]+)/status$'), keys: ['id'], handlers: h33 },
  { pattern: new RegExp('^/api/agent/skills/([^/]+)$'), keys: ['id'], handlers: h34 },
  { pattern: new RegExp('^/api/materials/([^/]+)$'), keys: ['id'], handlers: h35 },
  { pattern: new RegExp('^/api/folders/([^/]+)$'), keys: ['id'], handlers: h36 },
  { pattern: new RegExp('^/api/stages/([^/]+)$'), keys: ['id'], handlers: h37 },
  { pattern: new RegExp('^/api/agents/([^/]+)$'), keys: ['id'], handlers: h38 },
];
