import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const analyticsSource = readFileSync(
  resolve(process.cwd(), 'components/zhiban/teacher-virtual-lab-analytics.tsx'),
  'utf8',
);
const trendSource = readFileSync(
  resolve(process.cwd(), 'components/zhiban/teacher-attempt-trend-chart.tsx'),
  'utf8',
);
const persistenceServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/zhiban/virtual-lab/persistence/service.ts'),
  'utf8',
);
const teacherWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'components/zhiban/teacher-course-workspace.tsx'),
  'utf8',
);

describe('teacher course analytics visual presentation', () => {
  it('keeps course six-dimension and virtual-lab five-dimension statistics distinct', () => {
    expect(analyticsSource).toContain('六维班级平均能力');
    expect(analyticsSource).toContain('综合实训五项过程能力');
    expect(analyticsSource).toContain('分别统计');
  });

  it('integrates the learning-center return action into the analytics header', () => {
    expect(analyticsSource).toContain('返回学习中心');
    expect(analyticsSource).toContain('hover:bg-blue-50');
    expect(analyticsSource).not.toContain('← 返回智能诊断学习中心');
  });

  it('combines charts with visible text explanations and authentic empty states', () => {
    expect(analyticsSource).toContain('<LearningProfileRadar dimensions={radarDimensions} />');
    expect(analyticsSource).toContain('具体数值和解释以右侧文字为准');
    expect(analyticsSource).toContain('当前课程尚无有效选课学生');
    expect(analyticsSource).toContain('六项能力均产生真实学习证据后显示雷达图');
  });

  it('uses active course enrollments as the analytics population', () => {
    expect(persistenceServiceSource).toContain('FROM zhiban.enrollments e');
    expect(persistenceServiceSource).toContain("e.status='enrolled'");
    expect(persistenceServiceSource).toContain('enrolledLearnerIds');
    expect(analyticsSource).toContain("enrolledStudents: '选课人数'");
    expect(analyticsSource).toContain("averageScore: '已完成实训平均分'");
    expect(analyticsSource).toContain('全部选课学生 · 综合实训记录');
  });

  it('keeps the global teacher account bar on focused learning-center pages', () => {
    expect(teacherWorkspaceSource).toMatch(
      /if \(focusedLearningCenter\)[\s\S]*?<TeacherTopbar principalName=\{principalName\} \/>[\s\S]*?<main className="min-w-0">/,
    );
  });

  it('does not expose raw concept or assessment error codes as teacher-facing labels', () => {
    expect(analyticsSource).not.toContain('<span>{item.code}</span>');
    expect(analyticsSource).not.toContain('errorPatterns.join');
    expect(analyticsSource).toContain('conceptErrorLabel(item.code)');
    expect(analyticsSource).toContain('errorPatternLabel(item.code)');
  });

  it('renders separate accessible trends for score, duration and hint count', () => {
    expect(trendSource).toContain("title: '得分'");
    expect(trendSource).toContain("title: '用时'");
    expect(trendSource).toContain("title: '提示次数'");
    expect(trendSource).toContain('role="img"');
    expect(trendSource).toContain('prefers-reduced-motion: reduce');
  });
});
