import { assertOwnerExecution } from '@/lib/server/owner-host-policy';
import { after } from 'next/server';

import { backgroundWorkspaceId } from '@/lib/server/model-config/runtime';
import { createLogger } from '@/lib/logger';
import { generateConversationTitle } from './conversation-title-generator';
import { getAgentSessionStore } from './store';

let hostScheduler: ((task: () => Promise<void>) => void) | undefined;
export function configureConversationTitleScheduler(schedule: (task: () => Promise<void>) => void) {
  if (hostScheduler) throw Error('Conversation title scheduler already configured');
  hostScheduler = schedule;
}
const log = createLogger('ConversationTitleTask');

async function runConversationTitleTask(sessionId: string, ownerId: string): Promise<void> {
  let store: Awaited<ReturnType<typeof getAgentSessionStore>>;
  let visibleUserText: string | null;
  try {
    await assertOwnerExecution(ownerId);
    store = await getAgentSessionStore();
    visibleUserText = await store.claimAutomaticSessionTitle(sessionId, ownerId);
  } catch (error) {
    log.error(`session ${sessionId}: automatic title claim failed`, error);
    return;
  }
  if (visibleUserText === null) return;

  let title: string | null;
  try {
    title = await generateConversationTitle(visibleUserText, await backgroundWorkspaceId(ownerId));
  } catch (error) {
    log.error(`session ${sessionId}: automatic title generation failed`, error);
    return;
  }
  if (title === null) return;

  try {
    await assertOwnerExecution(ownerId);
    await store.setAutomaticSessionTitle(sessionId, ownerId, title);
  } catch (error) {
    log.error(`session ${sessionId}: automatic title commit failed`, error);
  }
}

export function scheduleConversationTitle(sessionId: string, ownerId: string): void {
  if (hostScheduler) {
    hostScheduler(() => runConversationTitleTask(sessionId, ownerId));
    return;
  }
  try {
    after(() => runConversationTitleTask(sessionId, ownerId));
  } catch (error) {
    log.error(`session ${sessionId}: automatic title scheduling failed`, error);
  }
}
