import { describe, it, expect } from 'vitest';
import { csvField, gradebookCsv } from '../../../lib/zhiban/application/assessment/gradebook-csv';
import type { GradebookPage } from '../../../lib/zhiban/application/assessment/gradebook';
describe('gradebook CSV text and bounds', () => {
  it('quotes commas, quotes and line breaks; neutralizes formula prefixes including whitespace', () => {
    expect(csvField('陈,"同学\n')).toBe('"陈,""同学\n"');
    for (const value of ['=1+1', '+SUM(A1)', '-1', '@cmd', ' \t=1', '\rtext', '\ntext'])
      expect(csvField(value)).toBe('"\'' + value + '"');
    expect(csvField('普通中文')).toBe('"普通中文"');
  });
  it('uses header-only empty export and enforces row and column limits', () => {
    const page: GradebookPage = {
      mode: 'TEACHER',
      offeringId: 'offering',
      asOf: 0,
      activities: [],
      rows: [],
      next: null,
      activityNext: null,
    };
    expect(gradebookCsv(page).startsWith('\ufeff')).toBe(true);
    expect(gradebookCsv(page).split('\r\n')).toHaveLength(2);
    expect(() => gradebookCsv({ ...page, rows: Array(51).fill({}) })).toThrow();
    expect(() => gradebookCsv({ ...page, activities: Array(11).fill({}) })).toThrow();
  });
  it('exports exactly the bounded complete matrix, rejecting truncation and duplicate cells', () => {
    const activities = Array.from({ length: 20 }, (_, id) => ({ id: String(id), title: '活动' }));
    const cells = activities.map((a) => ({ activity_id: a.id, state: 'NOT_STARTED' }));
    const page: GradebookPage = {
      mode: 'TEACHER',
      offeringId: 'offering',
      asOf: 0,
      activities,
      rows: Array.from({ length: 500 }, (_, n) => ({
        membership_id: String(n),
        display_name: '=formula',
        cells,
      })),
      next: null,
      activityNext: null,
    };
    const csv = gradebookCsv(page, 'FILTER');
    expect(csv.split('\r\n')).toHaveLength(10002);
    expect(csv).toContain('"\'=formula"');
    expect(() => gradebookCsv({ ...page, next: 'more' }, 'FILTER')).toThrow('EXPORT_LIMIT');
    expect(() => gradebookCsv({ ...page, activityNext: 'more' }, 'FILTER')).toThrow('EXPORT_LIMIT');
    expect(() => gradebookCsv({ ...page, rows: [...page.rows, page.rows[0]] }, 'FILTER')).toThrow(
      'EXPORT_LIMIT',
    );
    expect(() =>
      gradebookCsv({ ...page, activities: [...activities, { id: 'extra' }] }, 'FILTER'),
    ).toThrow('EXPORT_LIMIT');
    expect(() =>
      gradebookCsv({ ...page, activities: Array(101).fill({}), rows: [] }, 'FILTER'),
    ).toThrow('EXPORT_LIMIT');
    expect(() =>
      gradebookCsv({ ...page, rows: [{ cells: cells.map(() => cells[0]) }] }, 'FILTER'),
    ).toThrow('UNAVAILABLE');
    const large = {
      ...page,
      activities: activities.map((a) => ({ ...a, title: '中'.repeat(1000) })),
    };
    expect(() => gradebookCsv(large, 'FILTER')).toThrow('EXPORT_LIMIT');
  });
});
