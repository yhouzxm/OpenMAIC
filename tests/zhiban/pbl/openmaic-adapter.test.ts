import { describe, expect, it } from 'vitest';
import { buildOpenMaicPblPlannerInput } from '@/lib/zhiban/pbl';

describe('Zhiban OpenMAIC PBL adapter', () => {
  it('maps a course project definition to the existing PBL v2 planner input', () => {
    const input = buildOpenMaicPblPlannerInput({
      id: 'project-1', courseId: 'course-1', code: 'P01', title: '制作课程成绩分析表',
      description: '使用电子表格整理并分析课程成绩。', learningObjective: '掌握公式、排序和图表。',
      targetSkills: ['Excel公式', '数据排序', '图表制作'], deliverable: '成绩分析工作簿',
      scenarioRoleplay: false, scenarioBrief: '',
    });
    expect(input.outline.type).toBe('pbl');
    expect(input.outline.pblConfig).toMatchObject({
      projectTopic: '制作课程成绩分析表',
      targetSkills: ['Excel公式', '数据排序', '图表制作'],
      scenarioRoleplay: false,
    });
    expect(input.outline.pblConfig?.projectDescription).toContain('成绩分析工作簿');
    expect(input.courseContext.languageDirective).toContain('简体中文');
  });

  it('preserves scenario configuration without changing OpenMAIC types', () => {
    const input = buildOpenMaicPblPlannerInput({
      id: 'project-2', courseId: 'course-1', code: 'P02', title: '技术支持情境',
      description: '帮助同伴解决文件共享问题。', learningObjective: '练习问题诊断。',
      targetSkills: ['问题诊断'], deliverable: '解决方案', scenarioRoleplay: true,
      scenarioBrief: '学习者扮演技术支持人员。',
    });
    expect(input.outline.pblConfig?.scenarioRoleplay).toBe(true);
    expect(input.outline.pblConfig?.scenarioBrief).toContain('技术支持');
  });
});
