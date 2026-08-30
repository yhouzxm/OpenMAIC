'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { RadarChart } from 'echarts/charts';
import { RadarComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([RadarChart, RadarComponent, TooltipComponent, SVGRenderer]);

export type LearningProfileRadarDimension = {
  label: string;
  shortLabel: string;
  score: number;
};

export function LearningProfileRadar({
  dimensions,
}: {
  dimensions: readonly LearningProfileRadarDimension[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const accessibleSummary = dimensions.map((item) => `${item.label}${item.score}分`).join('；');

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current, undefined, { renderer: 'svg' });
    }
    const chart = chartInstanceRef.current;
    chart.setOption({
      animationDuration: 360,
      tooltip: {
        trigger: 'item',
        formatter: () => dimensions.map((item) => `${item.label}：${item.score}分`).join('<br/>'),
      },
      radar: {
        center: ['50%', '51%'],
        radius: '66%',
        indicator: dimensions.map((item) => ({ name: item.shortLabel, max: 100 })),
        splitNumber: 4,
        axisName: { color: '#334155', fontSize: 12, fontWeight: 600 },
        axisLine: { lineStyle: { color: '#bfdbfe' } },
        splitLine: { lineStyle: { color: '#dbeafe' } },
        splitArea: {
          areaStyle: { color: ['#f8fbff', '#f0f7ff'] },
        },
      },
      series: [
        {
          type: 'radar',
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#2563eb', width: 2 },
          itemStyle: { color: '#0ea5e9' },
          areaStyle: { color: 'rgba(14, 165, 233, 0.22)' },
          data: [
            {
              value: dimensions.map((item) => item.score),
              name: '当前能力画像',
            },
          ],
        },
      ],
    });
    chart.resize();
  }, [dimensions]);

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
    <div
      ref={chartRef}
      className="h-[320px] w-full"
      role="img"
      aria-label={`六维能力画像：${accessibleSummary}`}
    />
  );
}
