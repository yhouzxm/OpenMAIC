import { randomBytes } from 'node:crypto';
import type { Slide } from '@openmaic/dsl';
import type { MaicDocument } from '@openmaic/storage';
import { FixtureAuthority, type Mapping } from './boundary';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=',
  'base64',
);
export function wav(): Buffer {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(40, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(4, 40);
  bytes.fill(128, 44);
  return bytes;
}
// Request-path fixture only; no claim of decoded/playable video coverage.
export const WEBM = Buffer.from('1a45dfa3801853806701ffffffffffffff', 'hex');

export function slide(assets: { image: string; audio: string; video: string }): Slide {
  return {
    id: 'fixture-slide',
    viewportSize: 960,
    viewportRatio: 0.5625,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
    background: { type: 'image', image: { src: `asset:${assets.image}`, size: 'contain' } },
    elements: [
      {
        id: 'image',
        type: 'image',
        left: 0,
        top: 0,
        width: 80,
        height: 80,
        rotate: 0,
        src: `asset:${assets.image}`,
        fixedRatio: true,
      },
      {
        id: 'audio',
        type: 'audio',
        left: 90,
        top: 0,
        width: 80,
        height: 40,
        rotate: 0,
        src: `asset:${assets.audio}`,
        loop: false,
      },
      {
        id: 'video',
        type: 'video',
        left: 180,
        top: 0,
        width: 80,
        height: 80,
        rotate: 0,
        src: `asset:${assets.video}`,
        poster: `asset:${assets.image}`,
      },
      {
        id: 'text',
        type: 'text',
        left: 0,
        top: 90,
        width: 300,
        height: 50,
        rotate: 0,
        content: 'Synthetic preview',
        defaultFontName: 'sans-serif',
        defaultColor: '#111111',
      },
    ],
  } as Slide;
}

export function document(
  stage: string,
  canvas = slide({ image: 'png', audio: 'wav', video: 'webm' }),
): MaicDocument {
  return {
    stage: { id: stage, name: 'Duplicate fixture name', createdAt: 1000, updatedAt: 2000 },
    scenes: [
      {
        id: `${stage}-scene`,
        stageId: stage,
        title: 'Synthetic',
        order: 0,
        type: 'slide',
        content: { type: 'slide', canvas },
      },
    ],
  };
}

export function authorityFixture() {
  const authority = new FixtureAuthority();
  const prefix = randomBytes(8).toString('hex');
  const credential: Record<string, string> = {};
  for (const [alias, tenant, kind] of [
    ['teacherA', 'A', 'teacher'],
    ['adminA', 'A', 'admin'],
    ['studentA1', 'A', 'student'],
    ['studentA2', 'A', 'student'],
    ['studentB', 'B', 'student'],
  ] as const)
    credential[alias] = authority.enroll(alias, {
      tenant,
      kind,
      learner: `${prefix}-${alias}`,
      active: true,
      version: '1',
    });
  const stages = { A: `${prefix}-A`, A2: `${prefix}-A2`, B: `${prefix}-B` };
  for (const [name, tenant, readers] of [
    ['A', 'A', ['teacherA', 'studentA1']],
    ['A2', 'A', ['teacherA', 'studentA2']],
    ['B', 'B', ['studentB']],
  ] as const) {
    const stage = stages[name];
    const mapping: Mapping = {
      deployment: authority.deployment,
      stage,
      tenant,
      owner: `${prefix}-owner-${name}`,
      readers: new Set(readers),
      writers: new Set(tenant === 'A' ? ['teacherA'] : []),
      assets: new Set(['png', 'wav', 'webm']),
      state: 'ACTIVE',
      revision: '1',
    };
    authority.mappings.set(stage, mapping);
  }
  const sessions = {
    A: `${prefix}-runtime-A`,
    A2: `${prefix}-runtime-A2`,
    B: `${prefix}-runtime-B`,
  };
  for (const [name, alias] of [
    ['A', 'studentA1'],
    ['A2', 'studentA2'],
    ['B', 'studentB'],
  ] as const) {
    authority.bindings.set(sessions[name], {
      stage: stages[name],
      learner: authority.subjects.get(alias)!.learner,
      attempt: `${prefix}-attempt-${name}`,
    });
  }
  return { authority, stages, sessions, credential };
}
