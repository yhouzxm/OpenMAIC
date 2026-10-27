/** Request-scoped live authorization. A newer login must never rebind an older model stream. */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { AsyncLocalStorage } from 'node:async_hooks';
export type ClassroomBinding = {
  owner: string;
  tenant?: string;
  stage: string;
  imageTool?: AgentTool;
  guard<T>(work: () => Promise<T>): Promise<T>;
};
const execution = new AsyncLocalStorage<ClassroomBinding | undefined>();
export const withClassroomBinding = <T>(
  binding: ClassroomBinding | undefined,
  work: () => Promise<T>,
) => execution.run(binding, work);
export const currentClassroomBinding = (owner: string) => {
  const binding = execution.getStore();
  return binding?.owner === owner ? binding : undefined;
};
export const isClassroomOwner = (owner: string) => owner.startsWith('course-learner-');
