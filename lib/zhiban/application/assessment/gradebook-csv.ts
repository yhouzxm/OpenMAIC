import { requireAcademic } from '../../domain/academic/model';
import { GRADEBOOK_EXPORT_LIMITS, type GradebookPage } from './gradebook';
/** Text remains text in spreadsheet software; quoting alone does not prevent formulas. */
export function csvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function gradebookCsv(page: GradebookPage, scope: 'PAGE' | 'FILTER' = 'PAGE'): string {
  const limits =
    scope === 'FILTER'
      ? GRADEBOOK_EXPORT_LIMITS
      : { students: 50, activities: 10, records: 500, bytes: 2 * 1024 * 1024 };
  requireAcademic(
    page.rows.length <= limits.students &&
      page.activities.length <= limits.activities &&
      page.rows.length * page.activities.length <= limits.records &&
      (scope !== 'FILTER' || (!page.next && !page.activityNext)),
    'EXPORT_LIMIT',
  );
  const lines = [
    [
      '查询时间UTC',
      '教学班ID',
      '成员ID',
      '学生姓名',
      '活动ID',
      '活动标题',
      '活动发布版本',
      '尝试次数',
      '提交版本',
      '状态',
      '得分',
      '满分',
      '成绩版本',
    ]
      .map(csvField)
      .join(','),
  ];
  const states: Record<string, string> = {
    NOT_STARTED: '未开始',
    IN_PROGRESS: '已开始未提交',
    AWAITING_GRADE: '已提交待发布成绩',
    PUBLISHED: '已发布成绩',
  };
  for (const student of page.rows) {
    const cells = student.cells as Record<string, unknown>[];
    requireAcademic(cells.length === page.activities.length, 'UNAVAILABLE');
    requireAcademic(
      new Set(cells.map((cell) => cell.activity_id)).size === cells.length,
      'UNAVAILABLE',
    );
    for (const cell of cells) {
      const activity = page.activities.find((a) => a.id === cell.activity_id);
      requireAcademic(!!activity && Object.hasOwn(states, String(cell.state)), 'UNAVAILABLE');
      const score = cell.state === 'PUBLISHED' ? (Number(cell.score_points) / 100).toFixed(2) : '',
        max = cell.state === 'PUBLISHED' ? (Number(cell.max_points) / 100).toFixed(2) : '';
      lines.push(
        [
          new Date(page.asOf).toISOString(),
          page.offeringId,
          student.membership_id,
          student.display_name,
          cell.activity_id,
          activity!.title,
          cell.activity_version,
          cell.attempt_no,
          cell.submission_version,
          states[String(cell.state)],
          score,
          max,
          cell.grade_version,
        ]
          .map(csvField)
          .join(','),
      );
    }
  }
  const csv = '\ufeff' + lines.join('\r\n') + '\r\n';
  requireAcademic(Buffer.byteLength(csv, 'utf8') <= limits.bytes, 'EXPORT_LIMIT');
  return csv;
}
