'use client';

import { useEffect, useMemo, useState } from 'react';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { InteractiveRenderer } from '@/components/scene-renderers/interactive-renderer';
import { Button } from '@/components/ui/button';
import { buildMechInteractiveHtml, mechValidationProtocol } from '@/lib/zhiban/virtual-lab/interactive-template';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import type { InteractiveContent } from '@/lib/types/stage';

type HostMessage = { type: string; action?: string; command?: string; status?: string; detail?: string; timestamp?: string };
const PRIMARY_SCENE_ID = 'mech-iframe-validation-primary';
const RETURN_SCENE_ID = 'mech-iframe-validation-return';

function contentFor(label: string, sceneId: string): InteractiveContent {
  return {
    type: 'interactive', url: '',
    html: buildMechInteractiveHtml({ title: label, activityId: sceneId, scenarioId: 'iframe-validation', protocol: mechValidationProtocol }),
    widgetType: 'visualization3d',
    widgetConfig: {
      type: 'visualization3d', visualizationType: 'custom',
      description: '最小机电虚拟实训前置能力验证：box、cylinder、旋转、视角控制和 iframe 消息。',
      objects: [
        { id: 'test-box', type: 'box', animation: { type: 'rotate', speed: 1, axis: 'y' } },
        { id: 'test-cylinder', type: 'cylinder', animation: { type: 'rotate', speed: 1.35, axis: 'y' } },
      ],
      interactions: [{ type: 'orbit', target: 'camera', label: '旋转视角' }, { type: 'zoom', target: 'camera', label: '缩放视角' }],
    },
  };
}

export function MechIframeValidation() {
  const [activeSceneId, setActiveSceneId] = useState(PRIMARY_SCENE_ID);
  const [messages, setMessages] = useState<HostMessage[]>([]);
  const primaryContent = useMemo(() => contentFor('机电验证场景 A', PRIMARY_SCENE_ID), []);
  const returnContent = useMemo(() => contentFor('机电验证场景 B', RETURN_SCENE_ID), []);
  const activeContent = activeSceneId === PRIMARY_SCENE_ID ? primaryContent : returnContent;

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data as HostMessage | undefined;
      if (!data || !['MECH_TEST_READY', 'MECH_TEST_ACTION', 'MECH_TEST_COMMAND_ACK'].includes(data.type)) return;
      setMessages((current) => [data, ...current].slice(0, 8));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const sendCommand = (command: 'stop_rotation' | 'resume_rotation') => {
    const send = useWidgetIframeStore.getState().getSendMessage(activeSceneId);
    if (!send) { setMessages((current) => [{ type: 'HOST_SEND_PENDING', detail: 'iframe 消息通道尚未就绪，请稍候再试。' }, ...current]); return; }
    send('MECH_TEST_COMMAND', { source: mechValidationProtocol.source, version: mechValidationProtocol.version, activityId: activeSceneId, scenarioId: 'iframe-validation', command });
    setMessages((current) => [{ type: 'HOST_SENT_COMMAND', command }, ...current]);
  };

  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8"><InteractiveIframeHost /><div className="mx-auto max-w-6xl space-y-4">
    <header className="rounded-xl border border-slate-700 bg-slate-900 p-5"><h1 className="text-xl font-semibold">机电虚拟实训 · Interactive HTML 最小验证</h1><p className="mt-2 text-sm text-slate-300">仅验证现有 Interactive HTML、visualization3d 配置与 iframe 双向消息通道。</p></header>
    <div className="flex flex-wrap gap-2"><Button data-testid="mech-stop-rotation" onClick={() => sendCommand('stop_rotation')}>宿主发送：停止旋转</Button><Button data-testid="mech-resume-rotation" variant="secondary" onClick={() => sendCommand('resume_rotation')}>宿主发送：恢复旋转</Button><Button data-testid="mech-switch-scene" variant="outline" className="border-slate-500 bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white" onClick={() => setActiveSceneId((id) => id === PRIMARY_SCENE_ID ? RETURN_SCENE_ID : PRIMARY_SCENE_ID)}>切换验证场景并返回</Button></div>
    <section className="relative h-[min(62vh,580px)] min-h-[420px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl" data-testid="mech-interactive-slot"><InteractiveRenderer content={activeContent} sceneId={activeSceneId} /></section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-semibold">宿主接收数据</h2><div className="mt-3 space-y-2 text-sm" data-testid="mech-host-messages">{messages.length ? messages.map((message, index) => <pre key={`${message.type}-${index}`} className="overflow-x-auto rounded bg-slate-950 p-3 text-emerald-300">{JSON.stringify(message, null, 2)}</pre>) : <p className="text-slate-400">等待 iframe 就绪消息…</p>}</div></section>
  </div></main>;
}
