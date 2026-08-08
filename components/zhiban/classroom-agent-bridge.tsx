'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getActionsForRole } from '@/lib/orchestration/registry/types';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store';
import type { CourseAgentRuntime, InterventionBrief } from '@/lib/zhiban/agents/types';

export function ClassroomAgentBridge({ courseId }: { courseId: string }) {
  const [runtime, setRuntime] = useState<CourseAgentRuntime | null>(null);
  const [interventions, setInterventions] = useState<InterventionBrief[]>([]);
  const stageId = useStageStore((state) => state.stage?.id);
  const triggeredRef = useRef(new Set<string>());
  const inFlightRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/agents/courses/${courseId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '加载智能体失败');
    setRuntime(body.runtime);
    setInterventions(body.interventions ?? []);
  }, [courseId]);

  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
    const timer = window.setInterval(() => void load().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!runtime) return;
    const registry = useAgentRegistry.getState();
    for (const agent of runtime.agents) {
      const { voiceConfig: _unsupportedVoiceConfig, ...agentWithoutVoice } = agent;
      registry.addAgent({
        ...agentWithoutVoice,
        // Peer only converses; Tutor keeps OpenMAIC's assistant tool set.
        allowedActions: agent.id.startsWith('zhiban-peer-') ? [] : getActionsForRole(agent.role),
        createdAt: new Date(),
        updatedAt: new Date(),
        isDefault: false,
        // Zhiban role adapters are not part of the OpenMAIC-generated roster:
        // roster hydration may clear generated agents, but must retain these.
        isGenerated: false,
        isRuntime: true,
        boundStageId: stageId,
      });
    }
    const settings = useSettingsStore.getState();
    const ids = runtime.agents.map((agent) => agent.id);
    settings.setSelectedAgentIds([...new Set([...settings.selectedAgentIds, ...ids])]);
  }, [runtime, stageId]);

  useEffect(
    () => () => {
      const registry = useAgentRegistry.getState();
      registry.deleteAgent(`zhiban-tutor-${courseId}`);
      registry.deleteAgent(`zhiban-peer-${courseId}`);
    },
    [courseId],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ briefId?: string; outcome: 'deliver' | 'fail'; error?: string }>).detail;
      if (!detail?.briefId) return;
      void fetch(`/api/zhiban/agents/courses/${courseId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ briefId: detail.briefId, action: detail.outcome, error: detail.error }),
      }).catch(() => undefined);
    };
    window.addEventListener('zhiban:agent-intervention-result', handler);
    return () => window.removeEventListener('zhiban:agent-intervention-result', handler);
  }, [courseId]);

  // Keep the native OpenMAIC classroom experience: no separate Zhiban modal
  // and no confirmation button. A pending brief is accepted/audited once and
  // then enters the existing directed-discussion path.
  useEffect(() => {
    if (!runtime || !stageId) return;
    const current = interventions.find((item) => item.targetRole !== 'teacher');
    if (!current || triggeredRef.current.has(current.id) || inFlightRef.current.has(current.id))
      return;
    const agentId = `zhiban-${current.targetRole}-${courseId}`;
    if (!runtime.agents.some((agent) => agent.id === agentId)) return;
    inFlightRef.current.add(current.id);

    void (async () => {
      try {
        const response = await fetch(`/api/zhiban/agents/courses/${courseId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ briefId: current.id, action: 'accept' }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '启动智能体协同失败');
        const started = await fetch(`/api/zhiban/agents/courses/${courseId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ briefId: current.id, action: 'start' }),
        });
        if (!started.ok) throw new Error('Unable to start agent intervention');
        triggeredRef.current.add(current.id);
        setInterventions((items) => items.filter((item) => item.id !== current.id));
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('zhiban:start-agent-intervention', {
              detail: {
                agentId,
                briefId: current.id,
                topic: current.targetRole === 'tutor' ? 'Tutor 学习辅导' : 'Peer 同伴交流',
                prompt: `${current.objective}\n交流语气：${current.tone}\n最多 ${current.maxTurns} 轮。不得涉及：${current.prohibitedContent.join('、')}。`,
              },
            }),
          );
        }, 100);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '启动智能体协同失败');
      } finally {
        inFlightRef.current.delete(current.id);
      }
    })();
  }, [courseId, interventions, runtime, stageId]);

  return null;
}
