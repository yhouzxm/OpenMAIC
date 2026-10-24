/** Pure portable action mapping, shared by ZIP export and course publication. */
import type { Action, DiscussionAction, SpeechAction } from '@/lib/types/action';
import type { ManifestAction } from './classroom-zip-types';
export function actionsToManifest(
  actions: Action[],
  audioIdToPath: Map<string, string>,
  agentIdToIndex: Map<string, number> = new Map(),
  audioUrlToPath: Map<string, string> = new Map(),
): ManifestAction[] {
  return actions.map((action) => {
    if (action.type === 'speech') {
      const speech = action as SpeechAction;
      // A legacy audioUrl never enters the manifest: the type is gone from
      // the contract, but an unconverted document can still carry one at
      // runtime, and a bare rest-spread would export it. Its bytes travel
      // instead, fetched at export time and mapped to their own zip path.
      const {
        audioId,
        audioUrl: _legacyAudioUrl,
        ...rest
      } = speech as SpeechAction & {
        audioUrl?: string;
      };
      const audioRef =
        (audioId ? audioIdToPath.get(audioId) : undefined) ??
        (_legacyAudioUrl ? audioUrlToPath.get(_legacyAudioUrl) : undefined);
      return {
        ...rest,
        ...(audioRef ? { audioRef } : {}),
      } as ManifestAction;
    }
    if (action.type === 'discussion') {
      const discussion = action as DiscussionAction;
      const { agentId, ...rest } = discussion;
      const agentIndex = agentId ? agentIdToIndex.get(agentId) : undefined;
      return {
        ...rest,
        ...(agentIndex !== undefined ? { agentIndex } : agentId ? { agentId } : {}),
      } as ManifestAction;
    }
    return action as ManifestAction;
  });
}
