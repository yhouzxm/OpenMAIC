/** Portable design only. Course authority and learner/runtime facts never travel in an archive. */
import { isSlideContent, enumerateAssetManifest } from '@openmaic/dsl';
import type { AppDocument } from '@/lib/document-store/persistence-types';
import { resolvePBLContent, upgradeLegacyPBLConfigToProjectV2 } from '@/lib/pbl/legacy/read';
import { stripToDesignTemplate } from '@/lib/pbl/v2/runtime/learner-state';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import {
  agentConfigFromManifest,
  manifestAgentFromConfig,
  type ClassroomManifest,
} from '@/lib/export/classroom-zip-types';
import { actionsToManifest } from '@/lib/export/manifest-actions';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
export function designOnly(source: AppDocument): AppDocument {
  const d = structuredClone(source),
    s = d.stage;
  const stage = {
    id: s.id,
    name: s.name,
    description: s.description,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    languageDirective: s.languageDirective,
    style: s.style,
    whiteboard: s.whiteboard,
    videoManifest: s.videoManifest,
    agentIds: s.agentIds,
    generatedAgentConfigs: s.generatedAgentConfigs?.map((a) =>
      agentConfigFromManifest(manifestAgentFromConfig(a), a.id),
    ),
    interactiveMode: s.interactiveMode,
    taskEngineMode: s.taskEngineMode,
  };
  const scenes = d.scenes.map((scene) => {
    const clean = {
      id: scene.id,
      stageId: s.id,
      type: scene.type,
      title: scene.title,
      order: scene.order,
      content: scene.content,
      actions: scene.actions,
      whiteboards: scene.whiteboards,
      multiAgent: scene.multiAgent,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    } as Scene;
    if (clean.content.type === 'pbl') {
      const resolved = resolvePBLContent(clean.content);
      if (resolved.kind === 'v2')
        clean.content = { type: 'pbl', projectV2: stripToDesignTemplate(resolved.projectV2) };
      else if (resolved.kind === 'legacy')
        clean.content = {
          type: 'pbl',
          projectV2: stripToDesignTemplate(
            upgradeLegacyPBLConfigToProjectV2(resolved.projectConfig),
          ),
        };
      else clean.content = { type: 'pbl' };
    }
    return clean;
  });
  return { stage, scenes };
}
export function mapDesignRefs(document: AppDocument, mapping: ReadonlyMap<string, string>) {
  const slide = (s: Parameters<typeof slideMediaReferenceSlots>[0]) => {
    for (const slot of slideMediaReferenceSlots(s)) {
      const ref = slot.read();
      if (ref && mapping.has(ref)) slot.write(mapping.get(ref));
    }
  };
  for (const s of document.stage.whiteboard ?? []) slide(s);
  for (const scene of document.scenes) {
    if (isSlideContent(scene.content)) slide(scene.content.canvas);
    for (const board of scene.whiteboards ?? []) slide(board);
    for (const a of scene.actions ?? [])
      if (a.type === 'speech' && a.audioId && mapping.has(a.audioId))
        a.audioId = mapping.get(a.audioId);
  }
  if (document.stage.videoManifest)
    document.stage.videoManifest = Object.fromEntries(
      Object.entries(document.stage.videoManifest).map(([ref, value]) => [
        mapping.get(ref) ?? ref,
        value,
      ]),
    );
  return document;
}
export function nativeManifest(
  d: AppDocument,
  mediaIndex: ClassroomManifest['mediaIndex'],
): ClassroomManifest {
  const configs = d.stage.generatedAgentConfigs ?? [],
    indices = new Map(configs.map((a, i) => [a.id, i]));
  const audio = new Map(
    Object.entries(mediaIndex)
      .filter(([, v]) => v.type === 'audio')
      .map(([path, v]) => [v.sourceRef!, path]),
  );
  return {
    formatVersion: 1,
    appVersion: 'OpenMAIC-1.2.1-zhiban-archive',
    exportedAt: new Date().toISOString(),
    stage: {
      name: d.stage.name,
      description: d.stage.description,
      language: d.stage.languageDirective,
      style: d.stage.style,
      createdAt: d.stage.createdAt,
      updatedAt: d.stage.updatedAt,
      videoManifest: d.stage.videoManifest,
    },
    agents: configs.map(manifestAgentFromConfig),
    scenes: d.scenes.map((s) => ({
      type: s.type,
      title: s.title,
      order: s.order,
      content: s.content,
      actions: s.actions ? actionsToManifest(s.actions, audio, indices) : undefined,
      whiteboards: s.whiteboards,
      multiAgent: s.multiAgent?.enabled
        ? {
            enabled: true,
            agentIndices: s.multiAgent.agentIds
              .map((id) => indices.get(id))
              .filter((i): i is number => i !== undefined),
            directorPrompt: s.multiAgent.directorPrompt,
          }
        : undefined,
    })),
    mediaIndex,
  };
}
export function fromNativeManifest(m: ClassroomManifest): AppDocument {
  const now = Date.now(),
    agents = (m.agents ?? []).map((a, i) => agentConfigFromManifest(a, 'import-agent-' + i));
  const audio = new Map(
    Object.entries(m.mediaIndex ?? {})
      .filter(([, v]) => v.type === 'audio')
      .map(([path, v]) => [path, v.sourceRef ?? path]),
  );
  const scenes = m.scenes.map((s, i) => ({
    id: 'import-scene-' + i,
    stageId: 'import-stage',
    type: s.type,
    title: s.title,
    order: s.order ?? i,
    content: s.content,
    whiteboards: s.whiteboards,
    actions: s.actions?.map((a) => {
      if (a.type === 'speech') {
        const { audioRef, ...rest } = a;
        return { ...rest, ...(audioRef ? { audioId: audio.get(audioRef) } : {}) };
      }
      if (a.type === 'discussion') {
        const { agentIndex, ...rest } = a;
        delete (rest as unknown as { agentId?: string }).agentId;
        return {
          ...rest,
          ...(typeof agentIndex === 'number' && agents[agentIndex]
            ? { agentId: agents[agentIndex].id }
            : {}),
        };
      }
      return a;
    }) as Action[],
    multiAgent: s.multiAgent?.enabled
      ? {
          enabled: true,
          agentIds: s.multiAgent.agentIndices.map((index) => agents[index]?.id).filter(Boolean),
          directorPrompt: s.multiAgent.directorPrompt,
        }
      : undefined,
    createdAt: now,
    updatedAt: now,
  })) as Scene[];
  return designOnly({
    stage: {
      id: 'import-stage',
      name: m.stage.name,
      description: m.stage.description,
      languageDirective: m.stage.language,
      style: m.stage.style,
      videoManifest: m.stage.videoManifest,
      createdAt: now,
      updatedAt: now,
      generatedAgentConfigs: agents,
      agentIds: agents.map((a) => a.id),
    },
    scenes,
  });
}
export const designRefs = (d: AppDocument) => enumerateAssetManifest(d).entries.map((a) => a.ref);
