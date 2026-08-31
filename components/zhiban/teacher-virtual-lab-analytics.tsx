'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, FlaskConical, Loader2, Users } from 'lucide-react';
import { LearningProfileRadar } from '@/components/zhiban/learning-profile-radar';
import { TeacherAttemptTrendChart } from '@/components/zhiban/teacher-attempt-trend-chart';
import { CONCEPT_ERROR_CODES, type ConceptErrorCode } from '@/lib/zhiban/learning-center/types';
import { conceptErrorStudentLabel } from '@/lib/zhiban/scene-orchestration/guidance';
import type { AssessmentDimensionKey, ErrorPattern } from '@/lib/zhiban/virtual-lab/assessment';
import type {
  PersistedVirtualLabSession,
  TeacherVirtualLabAnalytics,
  TeacherVirtualLabStudent,
} from '@/lib/zhiban/virtual-lab/persistence/types';
import { MECHATRONICS_COURSE_CODE } from '@/lib/zhiban/mechatronics-course.constants';

const metricLabels: Record<string, string> = {
  enrolledStudents: '选课人数',
  participatingStudents: '实训参与人数',
  completedStudents: '实训完成人数',
  completionRate: '实训完成率',
  averageScore: '已完成实训平均分',
  averageDurationSeconds: '平均综合实训用时',
  averageHintsUsed: '平均提示',
};
const assessmentDimensionLabels: Record<AssessmentDimensionKey, string> = {
  diagnosisAccuracy: '故障定位',
  procedureQuality: '流程规范',
  evidenceReasoning: '证据推理',
  independence: '独立完成',
  verification: '结果验证',
};
const errorPatternLabels: Record<ErrorPattern, string> = {
  BLIND_GUESS: '证据不足时过早判断',
  SKIP_PLC_INSPECTION: '跳过PLC检查',
  SKIP_POWER_MEASUREMENT: '跳过供电测量',
  SKIP_OUTPUT_MEASUREMENT: '跳过输出测量',
  REPEATED_RESTART: '重复无效重启',
  OVER_RELIANCE_ON_HINTS: '提示依赖较多',
  INSUFFICIENT_VERIFICATION: '维修后验证不足',
  REPEATED_IRRELEVANT_INSPECTION: '重复无关检查',
};

function conceptErrorLabel(code: string) {
  return (CONCEPT_ERROR_CODES as readonly string[]).includes(code)
    ? conceptErrorStudentLabel(code as ConceptErrorCode)
    : '其他待巩固概念';
}

function errorPatternLabel(code: string) {
  return errorPatternLabels[code as ErrorPattern] ?? '其他诊断过程问题';
}

function abilityDescription(label: string, average: number | null) {
  if (average === null) return `${label}暂无足够学习证据。`;
  if (average >= 85) return `${label}整体表现稳定，可继续通过综合任务保持。`;
  if (average >= 70) return `${label}基础已经建立，仍可通过针对性练习进一步巩固。`;
  return `${label}是当前优先关注方向，建议结合下方误区和教学建议安排补练。`;
}
function duration(seconds: number | null) {
  return seconds === null
    ? '—'
    : `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

function metricValue(key: string, value: number | null) {
  if (value === null) return '—';
  if (key === 'completionRate') return `${value}%`;
  if (key === 'averageDurationSeconds') return duration(value);
  if (key === 'averageScore') return `${value}分`;
  if (key === 'averageHintsUsed') return `${value}次`;
  return `${value}人`;
}

export function TeacherVirtualLabAnalytics({ requestedCourseId }: { requestedCourseId?: string }) {
  const [courseId, setCourseId] = useState<string>();
  const [data, setData] = useState<TeacherVirtualLabAnalytics>();
  const [selected, setSelected] = useState<TeacherVirtualLabStudent>();
  const [selectedHistory, setSelectedHistory] = useState<PersistedVirtualLabSession[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      let resolvedCourseId = requestedCourseId;
      if (!resolvedCourseId) {
        const courseResponse = await fetch('/api/zhiban/teacher/courses');
        const courseBody = (await courseResponse.json().catch(() => ({}))) as {
          courses?: Array<{ id: string; code: string }>;
          error?: string;
        };
        if (!courseResponse.ok) throw new Error(courseBody.error ?? '暂时无法读取教师课程权限');
        const course = courseBody.courses?.find((item) => item.code === MECHATRONICS_COURSE_CODE);
        if (!course) throw new Error('尚未为当前教师安排“机电一体化系统”课程班');
        resolvedCourseId = course.id;
      }
      setCourseId(resolvedCourseId);
      const response = await fetch(`/api/zhiban/teacher/virtual-lab/${resolvedCourseId}`);
      let body: TeacherVirtualLabAnalytics & { error?: string };
      try {
        body = (await response.json()) as TeacherVirtualLabAnalytics & { error?: string };
      } catch {
        throw new Error('暂时无法读取课程学情分析，请稍后重试。');
      }
      if (!response.ok) throw new Error(body.error ?? '加载失败');
      setData(body);
      setSelected(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载失败');
    }
  }, [requestedCourseId]);
  useEffect(() => {
    void load();
  }, [load]);
  const selectStudent = (student: TeacherVirtualLabStudent) => {
    if (!courseId) return;
    setSelected(student);
    setSelectedHistory([]);
    void fetch(`/api/zhiban/teacher/virtual-lab/${courseId}/students/${student.userId}`)
      .then(async (response) => (response.ok ? await response.json().catch(() => null) : null))
      .then((body: { sessions?: PersistedVirtualLabSession[] } | null) =>
        setSelectedHistory(body?.sessions ?? []),
      )
      .catch(() => undefined);
  };
  if (error)
    return (
      <main className="p-6">
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          {error}
        </section>
      </main>
    );
  if (!data)
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-slate-500">
        <Loader2 className="mr-2 size-5 animate-spin" />
        正在加载课程学情分析…
      </main>
    );
  const hasCompleteSixDimensionData = data.knowledgeLearning.dimensions.every(
    (item) => item.average !== null,
  );
  const radarDimensions = data.knowledgeLearning.dimensions.map((item) => ({
    label: item.label,
    shortLabel: item.label.replace('能力', '').replace('故障诊断与验证', '诊断验证'),
    score: item.average ?? 0,
  }));
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
      <header className="rounded-xl border bg-white p-5 md:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <FlaskConical className="size-6 text-blue-600" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold">课程学情分析</h1>
              <p className="mt-1 text-sm text-slate-500">
                《机电一体化系统》 · 知识学习、诊断训练与综合实训
              </p>
            </div>
          </div>
          <Link
            href={`/zhiban/teacher/courses/${requestedCourseId}/learning-center`}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:self-auto"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回学习中心
          </Link>
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {Object.entries(data.metrics).map(([key, value]) => (
          <div className="rounded-xl border bg-white p-4" key={key}>
            <p className="text-xs text-slate-500">{metricLabels[key]}</p>
            <b className="mt-2 block text-2xl">{metricValue(key, value)}</b>
          </div>
        ))}
      </section>
      <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        用时数据仅统计学生在06综合实训中的已完成记录，不包含知识站学习与评价浏览时间。
      </p>
      <section
        className="rounded-xl border bg-white p-5"
        data-testid="teacher-learning-center-analytics"
      >
        <div className="flex items-center gap-2 font-semibold">
          <BarChart3 className="size-5 text-cyan-600" />
          知识学习与诊断能力
        </div>
        <p className="mt-2 text-sm text-slate-500">
          面向全部选课学生汇总；当前已有 {data.knowledgeLearning.participatingStudents}/
          {data.knowledgeLearning.enrolledStudents} 人产生学习记录。
        </p>
        {!data.knowledgeLearning.enrolledStudents ? (
          <p className="mt-5 rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">
            当前课程尚无有效选课学生。
          </p>
        ) : (
          <div className="mt-5 space-y-6">
            <div>
              <h3 className="font-medium">7站学习完成情况</h3>
              <p className="mt-1 text-sm text-slate-500">
                用于观察班级在哪个学习阶段出现进度断点。
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.knowledgeLearning.stationCompletion.map((station, index) => (
                  <article key={station.stationId} className="rounded-lg border p-3">
                    <div className="flex justify-between gap-3 text-sm">
                      <b>
                        {String(index + 1).padStart(2, '0')} {station.title}
                      </b>
                      <span className="shrink-0 font-semibold text-cyan-700">
                        {station.rate === null ? '—' : `${station.rate}%`}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {station.completedStudents}/{station.totalStudents} 人完成
                    </p>
                    <div
                      className="mt-2 h-2 overflow-hidden rounded bg-slate-100"
                      role="progressbar"
                      aria-label={`${station.title}完成率`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={station.rate ?? 0}
                    >
                      <div
                        className="h-full rounded bg-cyan-600"
                        style={{ width: `${Math.min(100, station.rate ?? 0)}%` }}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              <figure className="rounded-xl border border-blue-100 bg-gradient-to-b from-sky-50 to-white p-3">
                <figcaption className="px-2 pt-1 font-medium">六维班级平均能力</figcaption>
                {hasCompleteSixDimensionData ? (
                  <LearningProfileRadar dimensions={radarDimensions} />
                ) : (
                  <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-slate-500">
                    六项能力均产生真实学习证据后显示雷达图。
                  </div>
                )}
                <p className="px-2 pb-2 text-xs leading-5 text-slate-500">
                  雷达图用于观察班级能力是否均衡，具体数值和解释以右侧文字为准。
                </p>
              </figure>
              <div className="grid gap-3 md:grid-cols-2">
                {data.knowledgeLearning.dimensions.map((item) => (
                  <article key={item.key} className="rounded-lg border bg-slate-50/60 p-3">
                    <div className="flex justify-between text-sm">
                      <b>{item.label}</b>
                      <strong className="text-blue-700">
                        {item.average === null ? '—' : `${item.average}分`}
                      </strong>
                    </div>
                    <div
                      className="mt-2 h-2 overflow-hidden rounded bg-slate-200"
                      role="progressbar"
                      aria-label={`${item.label}班级平均分`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.average ?? 0}
                    >
                      <div
                        className="h-full rounded bg-blue-600"
                        style={{ width: `${Math.min(100, item.average ?? 0)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      {abilityDescription(item.label, item.average)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      数据覆盖：{item.evidenceStudents}/{item.totalStudents} 人
                    </p>
                  </article>
                ))}
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-xl border bg-amber-50/40 p-4">
                <h3 className="font-medium">高频概念误区</h3>
                <p className="mt-1 text-sm text-slate-500">
                  条形长度表示该误区在参与学生中的出现比例。
                </p>
                {data.knowledgeLearning.conceptErrors.length ? (
                  <ol className="mt-4 space-y-3 text-sm">
                    {data.knowledgeLearning.conceptErrors.map((item) => (
                      <li key={item.code}>
                        <div className="flex justify-between gap-3">
                          <span>{conceptErrorLabel(item.code)}</span>
                          <b className="shrink-0">
                            {item.count}人 · {item.percent}%
                          </b>
                        </div>
                        <div
                          className="mt-1.5 h-2 overflow-hidden rounded bg-amber-100"
                          role="img"
                          aria-label={`${conceptErrorLabel(item.code)}涉及${item.count}人，占全部选课学生${item.percent}%`}
                        >
                          <div
                            className="h-full rounded bg-amber-500"
                            style={{ width: `${Math.min(100, item.percent)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">暂无已记录的结构化概念误区。</p>
                )}
              </section>
              <section className="rounded-xl border bg-blue-50/40 p-4">
                <h3 className="font-medium">教学干预建议</h3>
                <p className="mt-1 text-sm text-slate-500">
                  根据上方真实学习记录生成，不使用虚构样例数据。
                </p>
                {data.knowledgeLearning.interventions.length ? (
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {data.knowledgeLearning.interventions.map((item, index) => (
                      <li key={item} className="flex gap-2 rounded-lg bg-white p-3">
                        <span className="font-semibold text-blue-700">{index + 1}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">当前没有达到提示条件的高频误区。</p>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-xl border bg-white">
          <div className="flex items-center gap-2 border-b p-5 font-semibold">
            <Users className="size-5 text-blue-600" />
            全部选课学生 · 综合实训记录
          </div>
          {!data.students.length ? (
            <p className="p-8 text-center text-sm text-slate-500">当前课程尚无有效选课学生</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3">学生</th>
                    <th>完成次数</th>
                    <th>最近 / 最高得分</th>
                    <th>最近实训用时</th>
                    <th>提示</th>
                    <th>主要薄弱点</th>
                    <th>最近完成</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((student) => (
                    <tr
                      key={student.userId}
                      onClick={() => selectStudent(student)}
                      className="cursor-pointer border-t hover:bg-blue-50"
                    >
                      <td className="px-4 py-3 font-medium text-blue-700">{student.name}</td>
                      <td>{student.attempts || '未开始'}</td>
                      <td>
                        {student.latestScore ?? '—'} / {student.highestScore ?? '—'}
                      </td>
                      <td>{duration(student.latestDurationSeconds)}</td>
                      <td>{student.latestHintsUsed ?? '—'}</td>
                      <td>{student.weakPoints.join('；') || '—'}</td>
                      <td>
                        {student.completedAt
                          ? new Date(student.completedAt).toLocaleString('zh-CN')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <div className="flex items-center gap-2 font-semibold">
              <BarChart3 className="size-5 text-blue-600" />
              综合实训五项过程能力
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              来自最近有效综合实训评价，与上方课程六维能力画像分别统计。
            </p>
            <div className="mt-4 space-y-3">
              {data.dimensions.map((item) => (
                <div key={item.key}>
                  <div className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <b>
                      {item.average ?? '—'}
                      {item.average === null ? '' : '%'}
                    </b>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full bg-blue-600"
                      style={{ width: `${item.average ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">高频错误 TOP</h2>
            {data.errorPatterns.length ? (
              <ol className="mt-3 space-y-3 text-sm">
                {data.errorPatterns.slice(0, 5).map((item) => (
                  <li key={item.code}>
                    <div className="flex justify-between gap-3">
                      <span>{errorPatternLabel(item.code)}</span>
                      <b>
                        {item.count}人 · {item.percent}%
                      </b>
                    </div>
                    <div
                      className="mt-1.5 h-2 overflow-hidden rounded bg-slate-100"
                      role="img"
                      aria-label={`${errorPatternLabel(item.code)}涉及${item.count}人，占比${item.percent}%`}
                    >
                      <div
                        className="h-full rounded bg-rose-500"
                        style={{ width: `${Math.min(100, item.percent)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-slate-500">暂无足够数据</p>
            )}
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">教学干预提示</h2>
            {data.interventions.length ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {data.interventions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">当前暂无需要提示的高频错误。</p>
            )}
          </section>
        </aside>
      </div>
      {selected && (
        <section className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{selected.name} · 最近一次能力摘要</h2>
            <button
              className="text-sm text-blue-600"
              onClick={() => {
                setSelected(undefined);
                setSelectedHistory([]);
              }}
            >
              关闭
            </button>
          </div>
          {selected.latestAssessment ? (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-5">
                {Object.entries(selected.latestAssessment.dimensions).map(([key, value]) => (
                  <div className="rounded-lg bg-slate-50 p-3" key={key}>
                    <p className="text-xs text-slate-500">
                      {assessmentDimensionLabels[key as AssessmentDimensionKey]}
                    </p>
                    <b>
                      {value.score}/{value.maxScore}
                    </b>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-slate-700">
                关键问题：
                {selected.latestAssessment.errorPatterns.map(errorPatternLabel).join('、') || '无'}
                ；推荐补强：
                {selected.latestAssessment.recommendedContent
                  .map((item) => item.title)
                  .join('；') || '暂无'}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">暂无已完成的综合实训评价。</p>
          )}
          <div className="mt-5 border-t pt-4">
            <h3 className="font-medium">历史尝试趋势</h3>
            <p className="mt-1 text-sm text-slate-500">
              分别比较综合实训得分、实训用时和提示次数，避免不同量纲混在一张图中。
            </p>
            {selectedHistory.length ? (
              <TeacherAttemptTrendChart sessions={selectedHistory} />
            ) : (
              <p className="mt-2 text-sm text-slate-500">正在读取历史记录，或暂无历史记录。</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
