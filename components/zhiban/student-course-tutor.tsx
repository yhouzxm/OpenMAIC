'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { CourseTutorConfig, CourseTutorMessage } from '@/lib/zhiban/tutor';

export function StudentCourseTutor({ courseId }: { courseId: string }) {
  const [config, setConfig] = useState<CourseTutorConfig | null>(null), [sessionId, setSessionId] = useState<string | null>(null), [messages, setMessages] = useState<CourseTutorMessage[]>([]), [activity, setActivity] = useState<{ title: string; settings: { openingPrompt?: string; learningObjective?: string } } | null>(null), [busy, setBusy] = useState(false),[proactiveBrief,setProactiveBrief]=useState<{id:string;objective:string;tone:string}|null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const acceptedBriefRef=useRef<string|null>(null);
  const load = useCallback(async () => { const activityId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('activityId'); const query = activityId ? `?activityId=${activityId}` : ''; const response = await fetch(`/api/zhiban/student/courses/${courseId}/tutor${query}`), body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Tutor 加载失败'); setConfig(body.config); setSessionId(body.sessionId); setMessages(body.messages); setActivity(body.activity); setProactiveBrief(body.proactiveBrief??null); }, [courseId]);
  useEffect(() => { void load().catch((error) => toast.error(error.message)); }, [load]);
  useEffect(()=>{if(!proactiveBrief||acceptedBriefRef.current===proactiveBrief.id)return;acceptedBriefRef.current=proactiveBrief.id;void (async()=>{for(const action of ['accept','start']){const response=await fetch(`/api/zhiban/agents/courses/${courseId}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({briefId:proactiveBrief.id,action})});if(!response.ok)throw new Error('Monitor Tutor 协同启动失败');}})().catch(error=>toast.error(error.message));},[courseId,proactiveBrief]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);
  if (!config || config.status !== 'published' || !config.enabled) return null;
  const finishBrief=async(outcome:'deliver'|'fail',error?:string)=>{if(!proactiveBrief)return;await fetch(`/api/zhiban/agents/courses/${courseId}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({briefId:proactiveBrief.id,action:outcome,error})});if(outcome==='deliver')setProactiveBrief(null);};
  const send = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form), message = String(data.get('message') ?? '').trim(); if (!message || busy) return; const user: CourseTutorMessage = { id: `local-${Date.now()}`, role: 'user', content: message, citations: [], status: 'completed', createdAt: new Date().toISOString() }; setMessages((items) => [...items, user]); form.reset(); setBusy(true);
    try { const model = getCurrentModelConfig(), headers: Record<string,string> = { 'content-type': 'application/json', 'x-model': model.modelString, 'x-api-key': model.apiKey }; if (model.baseUrl) headers['x-base-url'] = model.baseUrl; if (model.providerType) headers['x-provider-type'] = model.providerType;
      const requestId = crypto.randomUUID(), activityId = new URLSearchParams(window.location.search).get('activityId');
      const response = await fetch(`/api/zhiban/student/courses/${courseId}/tutor`, { method: 'POST', headers, body: JSON.stringify({ message, sessionId, requestId, activityId, thinkingConfig: model.thinkingConfig }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Tutor 回答失败'); }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) { const body = await response.json(); setSessionId(body.sessionId); setMessages((items) => [...items, body.message]); await finishBrief('deliver'); return; }
      const reader = response.body?.getReader(); if (!reader) throw new Error('Tutor 流式响应不可用');
      const decoder = new TextDecoder(); let buffer = '', streamed = ''; const localId = `assistant-${requestId}`;
      setMessages((items) => [...items, { id: localId, role: 'assistant', content: '', citations: [], status: 'completed', createdAt: new Date().toISOString() }]);
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
        for (const frame of frames) { const type = frame.match(/^event: (.+)$/m)?.[1], raw = frame.match(/^data: (.+)$/m)?.[1]; if (!raw) continue; const payload = JSON.parse(raw);
          if (type === 'start') setSessionId(payload.sessionId);
          if (type === 'delta') { streamed += payload.delta; setMessages((items) => items.map((item) => item.id === localId ? { ...item, content: streamed } : item)); }
          if (type === 'done') {setMessages((items) => items.map((item) => item.id === localId ? payload.message : item));await finishBrief('deliver');}
          if (type === 'error') throw new Error(payload.error ?? 'Tutor 回答失败');
        }
      } }
    catch (error) { void finishBrief('fail',error instanceof Error?error.message:'Tutor 回答失败');toast.error(error instanceof Error ? error.message : 'Tutor 回答失败'); } finally { setBusy(false); } };
  const rate = async (messageId: string, rating: -1 | 1) => { const response = await fetch(`/api/zhiban/student/courses/${courseId}/tutor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'feedback', messageId, rating, comment: '' }) }); if (!response.ok) return toast.error('反馈提交失败'); toast.success('感谢你的反馈'); };
  return <section id="course-tutor" className="scroll-mt-20 border bg-white"><header className="flex items-center gap-3 border-b bg-gradient-to-r from-blue-50 to-cyan-50 p-4"><span className="flex size-10 items-center justify-center rounded-full bg-blue-600 text-white"><Bot className="size-5" /></span><div><h2 className="font-semibold">{config.displayName}</h2><p className="text-xs text-slate-500">课程知识辅导 · 回答会标注所依据的课程资料</p></div></header>
    <div className="max-h-[520px] min-h-56 space-y-4 overflow-y-auto p-4">{proactiveBrief&&<div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm"><b>Monitor 学习支持建议</b><p className="mt-1 text-slate-700">{proactiveBrief.objective}</p><p className="mt-1 text-xs text-slate-500">建议语气：{proactiveBrief.tone}</p></div>}{activity && <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm"><b>当前辅导活动：{activity.title}</b>{activity.settings.learningObjective && <p className="mt-1 text-slate-600">目标：{activity.settings.learningObjective}</p>}</div>}{!messages.length && <div className="rounded bg-blue-50 p-4 text-sm text-blue-900">{activity?.settings.openingPrompt || config.welcomeMessage}</div>}{messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm text-white' : 'max-w-[92%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm'}>{message.role === 'assistant' ? <Streamdown>{message.content}</Streamdown> : <p className="whitespace-pre-wrap">{message.content}</p>}{message.role === 'assistant' && <><div className="mt-3 space-y-1 border-t pt-2">{message.citations.map((citation, index) => <details key={`${message.id}-${citation.documentId}-${index}`} className="text-xs text-slate-500"><summary className="cursor-pointer">[资料{index + 1}] {citation.title}</summary><p className="mt-1 rounded bg-white p-2">{citation.excerpt}</p></details>)}</div><div className="mt-2 flex gap-1"><Button size="icon" variant="ghost" aria-label="有帮助" onClick={() => void rate(message.id, 1)}><ThumbsUp className="size-3" /></Button><Button size="icon" variant="ghost" aria-label="没帮助" onClick={() => void rate(message.id, -1)}><ThumbsDown className="size-3" /></Button></div></>}</div>)}{busy && <div className="max-w-[92%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">Tutor 正在查找课程资料并组织回答……</div>}<div ref={endRef} /></div>
    <form onSubmit={send} className="flex gap-2 border-t p-4"><textarea name="message" required maxLength={10000} rows={2} className="min-w-0 flex-1 resize-none rounded border p-3 text-sm" placeholder="询问知识难点、让 Tutor 帮你拆解任务……" /><Button disabled={busy} className="self-end"><Send className="mr-1 size-4" />发送</Button></form>
    <p className="px-4 pb-3 text-xs text-slate-400">Tutor 可能出错，请结合课程资料核对；不会代写作业或替代教师评分。</p>
  </section>;
}
