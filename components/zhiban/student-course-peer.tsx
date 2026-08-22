'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { HeartHandshake, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { CoursePeerConfig, CoursePeerMessage } from '@/lib/zhiban/peer';

export function StudentCoursePeer({ courseId }: { courseId: string }) {
  const [config, setConfig] = useState<CoursePeerConfig | null>(null),
    [sessionId, setSessionId] = useState<string | null>(null),
    [messages, setMessages] = useState<CoursePeerMessage[]>([]),
    [proactiveBrief, setProactiveBrief] = useState<{ id: string; objective: string } | null>(null),
    [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/peer`),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Peer 加载失败');
    setConfig(body.config);
    setSessionId(body.sessionId);
    setMessages(body.messages ?? []);
    setProactiveBrief(body.proactiveBrief ?? null);
  }, [courseId]);
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, [load]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);
  useEffect(() => {
    if (!proactiveBrief) return;
    void fetch(`/api/zhiban/student/courses/${courseId}/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'proactive_seen', briefId: proactiveBrief.id }),
    }).catch(() => undefined);
  }, [courseId, proactiveBrief]);
  if (!config || !config.enabled || config.status !== 'published') return null;
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget,
      message = String(new FormData(form).get('message') ?? '').trim();
    if (!message || busy) return;
    const requestId = crypto.randomUUID();
    setMessages((x) => [
      ...x,
      {
        id: `local-${requestId}`,
        role: 'user',
        content: message,
        emotion: 'neutral',
        riskLevel: 'none',
        status: 'completed',
        safetyCategory: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    form.reset();
    setBusy(true);
    try {
      const model = getCurrentModelConfig(),
        headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-model': model.modelString,
          'x-api-key': model.apiKey,
        };
      if (model.baseUrl) headers['x-base-url'] = model.baseUrl;
      if (model.providerType) headers['x-provider-type'] = model.providerType;
      const response = await fetch(`/api/zhiban/student/courses/${courseId}/peer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          sessionId,
          requestId,
          thinkingConfig: model.thinkingConfig,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? 'Peer 回应失败');
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const body = await response.json();
        setSessionId(body.sessionId);
        setMessages((x) => [...x, body.message]);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Peer 流式响应不可用');
      const decoder = new TextDecoder();
      let buffer = '',
        streamed = '';
      const localId = `peer-${requestId}`;
      setMessages((x) => [
        ...x,
        {
          id: localId,
          role: 'assistant',
          content: '',
          emotion: 'neutral',
          riskLevel: 'none',
          status: 'completed',
          safetyCategory: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const type = frame.match(/^event: (.+)$/m)?.[1],
            raw = frame.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const payload = JSON.parse(raw);
          if (type === 'start') setSessionId(payload.sessionId);
          if (type === 'delta') {
            streamed += payload.delta;
            setMessages((x) => x.map((m) => (m.id === localId ? { ...m, content: streamed } : m)));
          }
          if (type === 'done')
            setMessages((x) => x.map((m) => (m.id === localId ? payload.message : m)));
          if (type === 'error') throw new Error(payload.error);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Peer 回应失败');
    } finally {
      setBusy(false);
    }
  };
  const rate = async (messageId: string, rating: -1 | 1) => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'feedback', messageId, rating, comment: '' }),
    });
    if (response.ok) toast.success('感谢你的反馈');
    else toast.error('反馈提交失败');
  };
  const newSession = async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'new_session', sessionId }),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error ?? '无法开始新对话');
    }
    setSessionId(null);
    setMessages([]);
    toast.success('已开始新的陪伴对话');
  };
  return (
    <section id="course-peer" className="border bg-white">
      <header className="flex items-center gap-3 border-b bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-violet-600 text-white">
          <HeartHandshake className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">{config.displayName}</h2>
          <p className="text-xs text-slate-500">共情陪伴 · 帮你把压力转成一个可行动的小步骤</p>
        </div>
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          onClick={() => void newSession().catch((error) => toast.error(error.message))}
        >
          新对话
        </Button>
      </header>
      <div className="max-h-[460px] min-h-40 space-y-4 overflow-y-auto p-4">
        {!messages.length && (
          <div className="rounded bg-violet-50 p-4 text-sm text-violet-900">
            {config.welcomeMessage}
          </div>
        )}
        {proactiveBrief && (
          <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
            最近的学习似乎不太轻松。{proactiveBrief.objective}
            。如果你愿意，可以从此刻最困扰你的一个小点说起。
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-3 text-sm text-white'
                : 'max-w-[92%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm'
            }
          >
            {m.role === 'assistant' ? (
              <Streamdown>{m.content}</Streamdown>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
            {m.role === 'assistant' && (
              <div className="mt-2 flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="有帮助"
                  onClick={() => void rate(m.id, 1)}
                >
                  <ThumbsUp className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="没帮助"
                  onClick={() => void rate(m.id, -1)}
                >
                  <ThumbsDown className="size-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="max-w-[92%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
            Peer 正在听你说……
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t p-4">
        <textarea
          name="message"
          required
          maxLength={5000}
          rows={2}
          className="min-w-0 flex-1 resize-none rounded border p-3 text-sm"
          placeholder="可以说说此刻的学习感受、压力或畏难……"
        />
        <Button disabled={busy} className="self-end bg-violet-600 hover:bg-violet-700">
          <Send className="mr-1 size-4" />
          发送
        </Button>
      </form>
      <p className="px-4 pb-3 text-xs text-slate-400">
        Peer 提供一般学习陪伴，不替代心理咨询或紧急援助；你可以忽略建议，不影响成绩。
      </p>
    </section>
  );
}
