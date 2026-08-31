'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';

echarts.use([LineChart, GridComponent, TooltipComponent, SVGRenderer]);

type TrendMetric = {
  title: string;
  unit: string;
  color: string;
  values: number[];
};

function MetricTrendChart({ attempts, metric }: { attempts: number[]; metric: TrendMetric }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const accessibleSummary = metric.values
    .map((value, index) => `第${attempts[index]}次${value}${metric.unit}`)
    .join('；');

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current, undefined, { renderer: 'svg' });
    }
    const chart = chartInstanceRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chart.setOption({
      animation: !reduceMotion,
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [];
          const item = items[0] as { axisValueLabel?: string; value?: number } | undefined;
          return `${item?.axisValueLabel ?? ''}<br/>${metric.title}：${item?.value ?? '—'}${metric.unit}`;
        },
      },
      grid: { left: 38, right: 14, top: 18, bottom: 30 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: attempts.map((attempt) => `第${attempt}次`),
        axisLabel: { color: '#64748b', fontSize: 11 },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: metric.title === '得分' ? 100 : undefined,
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [
        {
          type: 'line',
          data: metric.values,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: metric.color, width: 3 },
          itemStyle: { color: metric.color },
          areaStyle: { color: `${metric.color}18` },
        },
      ],
    });
    chart.resize();
  }, [attempts, metric]);

  useEffect(() => {
    const resize = () => chartInstanceRef.current?.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <figure className="rounded-lg border bg-slate-50/60 p-3">
      <figcaption className="text-sm font-medium text-slate-700">{metric.title}变化</figcaption>
      <div
        ref={chartRef}
        className="mt-2 h-40 w-full"
        role="img"
        aria-label={`${metric.title}趋势：${accessibleSummary}`}
      />
    </figure>
  );
}

export function TeacherAttemptTrendChart({ sessions }: { sessions: PersistedVirtualLabSession[] }) {
  const completed = sessions
    .filter(
      (
        session,
      ): session is PersistedVirtualLabSession & {
        overallScore: number;
        durationSeconds: number;
      } =>
        session.status === 'completed' &&
        session.overallScore !== null &&
        session.durationSeconds !== null,
    )
    .sort((left, right) => left.attemptNumber - right.attemptNumber);

  if (completed.length < 2) {
    return <p className="mt-2 text-sm text-slate-500">完成至少两次综合实训后显示趋势图。</p>;
  }

  const attempts = completed.map((session) => session.attemptNumber);
  const metrics: TrendMetric[] = [
    {
      title: '得分',
      unit: '分',
      color: '#2563eb',
      values: completed.map((session) => session.overallScore),
    },
    {
      title: '综合实训用时',
      unit: '秒',
      color: '#0891b2',
      values: completed.map((session) => session.durationSeconds),
    },
    {
      title: '提示次数',
      unit: '次',
      color: '#d97706',
      values: completed.map((session) => session.hintsUsed),
    },
  ];

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      {metrics.map((metric) => (
        <MetricTrendChart key={metric.title} attempts={attempts} metric={metric} />
      ))}
    </div>
  );
}
