import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = process.argv[2];
if (!outputDir) throw new Error('output directory is required');

const workbook = Workbook.create();
const definitions = [
  [
    '学生',
    ['学号*', '姓名*', '登录账号*', '手机号', '班级编码', '初始密码*'],
    ['20260001', '示例学生', 'student001', '13800000001', 'CLASS-001', 'Student2026!'],
  ],
  [
    '教师',
    ['工号*', '姓名*', '登录账号*', '手机号', '角色', '初始密码*'],
    ['T001', '示例教师', 'teacher001', '13800000002', '任课教师', 'Teacher2026!'],
  ],
  [
    '学期',
    ['学期编码*', '名称*', '开始日期*', '结束日期*'],
    ['2026-S1', '2026春季学期', new Date('2026-03-01'), new Date('2026-07-31')],
  ],
  [
    '班级',
    ['班级编码*', '名称*', '学期编码*', '班主任工号', '人数上限'],
    ['CLASS-001', '计算机应用基础1班', '2026-S1', 'T001', 50],
  ],
  [
    '课程',
    ['课程编码*', '名称*', '学分', '负责人教师工号'],
    ['COURSE-001', '计算机应用基础', 3, 'T001'],
  ],
  [
    '开课班',
    ['开课编码*', '课程编码*', '学期编码*', '班级编码', '任课教师工号', '容量'],
    ['OFFER-001', 'COURSE-001', '2026-S1', 'CLASS-001', 'T001', 50],
  ],
  ['选课', ['开课编码*', '学生学号*'], ['OFFER-001', '20260001']],
];

for (const [name, headers, example] of definitions) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 2, headers.length).values = [headers, example];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: '#0F766E',
    font: { bold: true, color: '#FFFFFF' },
    borders: { preset: 'outside', style: 'thin', color: '#0F766E' },
  };
  sheet.getRangeByIndexes(1, 0, 1, headers.length).format = { fill: '#F0FDFA' };
  sheet.getRangeByIndexes(0, 0, 2, headers.length).format.rowHeight = 24;
  sheet.getRangeByIndexes(0, 0, 2, headers.length).format.autofitColumns();
  for (let col = 0; col < headers.length; col++) {
    const range = sheet.getRangeByIndexes(0, col, 2, 1);
    if (range.format.columnWidth < 14) range.format.columnWidth = 14;
    if (range.format.columnWidth > 28) range.format.columnWidth = 28;
  }
  if (name === '学期') sheet.getRange('C2:D2').format.numberFormat = 'yyyy-mm-dd';
  sheet.freezePanes.freezeRows(1);
  const preview = await workbook.render({
    sheetName: name,
    autoCrop: 'all',
    scale: 1,
    format: 'png',
  });
  await fs.mkdir(path.join(outputDir, 'previews'), { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'previews', `${name}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, 'zhiban-bulk-import-template.xlsx'));
const inspection = await workbook.inspect({
  kind: 'sheet,table',
  maxChars: 5000,
  tableMaxRows: 3,
  tableMaxCols: 8,
});
console.log(inspection.ndjson);
