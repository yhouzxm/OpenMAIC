'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, FlaskConical, Loader2, Users } from 'lucide-react';
import type { PersistedVirtualLabSession, TeacherVirtualLabAnalytics, TeacherVirtualLabStudent } from '@/lib/zhiban/virtual-lab/persistence/types';

const COURSE_ID = 'mech-mechatronics-system';
const activityName = '自动输送系统智能故障诊断';
const metricLabels: Record<string, string> = { participatingStudents: '参与学生', completedStudents: '完成人数', completionRate: '完成率', averageScore: '平均得分', averageDurationSeconds: '平均用时', averageHintsUsed: '平均提示' };
function duration(seconds: number | null) { return seconds === null ? '—' : `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`; }

export function TeacherVirtualLabAnalytics() {
  const [data, setData] = useState<TeacherVirtualLabAnalytics>();
  const [selected, setSelected] = useState<TeacherVirtualLabStudent>();
  const [selectedHistory, setSelectedHistory] = useState<PersistedVirtualLabSession[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`/api/zhiban/teacher/virtual-lab/${COURSE_ID}`);
      let body: TeacherVirtualLabAnalytics & { error?: string };
      try { body = await response.json() as TeacherVirtualLabAnalytics & { error?: string }; } catch { throw new Error('暂时无法读取虚拟实训学情，请稍后重试。'); }
      if (!response.ok) throw new Error(body.error ?? '加载失败');
      setData(body); setSelected(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selectStudent = (student: TeacherVirtualLabStudent) => {
    setSelected(student); setSelectedHistory([]);
    void fetch(`/api/zhiban/teacher/virtual-lab/${COURSE_ID}/students/${student.userId}`)
      .then(async (response) => response.ok ? await response.json().catch(() => null) : null)
      .then((body: { sessions?: PersistedVirtualLabSession[] } | null) => setSelectedHistory(body?.sessions ?? []))
      .catch(() => undefined);
  };
  if (error) return <main className="p-6"><section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800">{error}</section></main>;
  if (!data) return <main className="flex min-h-[50vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 size-5 animate-spin" />正在加载虚拟实训学情…</main>;
  return <main className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
    <header className="rounded-xl border bg-white p-6"><div className="flex items-center gap-3"><FlaskConical className="size-6 text-blue-600" /><div><h1 className="text-xl font-semibold">虚拟实训学情</h1><p className="mt-1 text-sm text-slate-500">《机电一体化系统》 · {activityName}</p></div></div></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Object.entries(data.metrics).map(([key, value]) => <div className="rounded-xl border bg-white p-4" key={key}><p className="text-xs text-slate-500">{metricLabels[key]}</p><b className="mt-2 block text-2xl">{key === 'completionRate' && value !== null ? `${value}%` : key === 'averageDurationSeconds' ? duration(value) : value ?? '—'}</b></div>)}</section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-xl border bg-white"><div className="flex items-center gap-2 border-b p-5 font-semibold"><Users className="size-5 text-blue-600" />学生实训记录</div>{!data.students.length ? <p className="p-8 text-center text-sm text-slate-500">暂无足够数据</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">学生</th><th>完成次数</th><th>最近 / 最高得分</th><th>最近用时</th><th>提示</th><th>主要薄弱点</th><th>最近完成</th></tr></thead><tbody>{data.students.map((student) => <tr key={student.userId} onClick={() => selectStudent(student)} className="cursor-pointer border-t hover:bg-blue-50"><td className="px-4 py-3 font-medium text-blue-700">{student.name}</td><td>{student.attempts}</td><td>{student.latestScore ?? '—'} / {student.highestScore ?? '—'}</td><td>{duration(student.latestDurationSeconds)}</td><td>{student.latestHintsUsed ?? '—'}</td><td>{student.weakPoints.join('；') || '—'}</td><td>{student.completedAt ? new Date(student.completedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table></div>}</section>
      <aside className="space-y-5"><section className="rounded-xl border bg-white p-5"><div className="flex items-center gap-2 font-semibold"><BarChart3 className="size-5 text-blue-600" />班级能力维度</div><div className="mt-4 space-y-3">{data.dimensions.map((item) => <div key={item.key}><div className="flex justify-between text-sm"><span>{item.label}</span><b>{item.average ?? '—'}{item.average === null ? '' : '%'}</b></div><div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${item.average ?? 0}%` }} /></div></div>)}</div></section><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">高频错误 TOP</h2>{data.errorPatterns.length ? <ol className="mt-3 space-y-2 text-sm">{data.errorPatterns.slice(0, 5).map((item) => <li key={item.code} className="flex justify-between gap-3"><span>{item.code}</span><b>{item.percent}%</b></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">暂无足够数据</p>}</section><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">教学干预提示</h2>{data.interventions.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">{data.interventions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">当前暂无需要提示的高频错误。</p>}</section></aside>
    </div>
    {selected && <section className="rounded-xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">{selected.name} · 最近一次能力摘要</h2><button className="text-sm text-blue-600" onClick={() => { setSelected(undefined); setSelectedHistory([]); }}>关闭</button></div>{selected.latestAssessment ? <><div className="mt-4 grid gap-3 md:grid-cols-5">{Object.entries(selected.latestAssessment.dimensions).map(([key, value]) => <div className="rounded-lg bg-slate-50 p-3" key={key}><p className="text-xs text-slate-500">{key}</p><b>{value.score}/{value.maxScore}</b></div>)}</div><p className="mt-4 text-sm text-slate-700">关键错误：{selected.latestAssessment.errorPatterns.join('、') || '无'}；推荐补强：{selected.latestAssessment.recommendedContent.map((item) => item.title).join('；') || '暂无'}</p></> : <p className="mt-3 text-sm text-slate-500">暂无已完成 Assessment。</p>}<div className="mt-5 border-t pt-4"><h3 className="font-medium">历史尝试趋势</h3>{selectedHistory.length ? <div className="mt-2 flex flex-wrap gap-3 text-sm">{selectedHistory.filter((item) => item.status === 'completed').map((item) => <span className="rounded bg-slate-50 px-3 py-2" key={item.id}>第{item.attemptNumber}次：{item.overallScore ?? '—'}分 / {duration(item.durationSeconds)} / {item.hintsUsed}次提示</span>)}</div> : <p className="mt-2 text-sm text-slate-500">正在读取历史记录，或暂无历史记录。</p>}</div></section>}
  </main>;
}
