import * as XLSX from 'xlsx';

export const IMPORT_SHEETS = ['学生', '教师', '学期', '班级', '课程', '开课班', '选课'] as const;
export type ImportSheetName = (typeof IMPORT_SHEETS)[number];
export interface ImportRow {
  sheet: ImportSheetName;
  rowNumber: number;
  key: string;
  values: Record<string, string | number>;
  errors: string[];
}
export interface ParsedImport {
  rows: ImportRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  summary: Record<string, number>;
}

const definitions: Record<ImportSheetName, { headers: string[]; required: string[]; key: string }> =
  {
    学生: {
      headers: ['学号*', '姓名*', '登录账号*', '手机号', '班级编码', '初始密码*'],
      required: ['学号*', '姓名*', '登录账号*', '初始密码*'],
      key: '学号*',
    },
    教师: {
      headers: ['工号*', '姓名*', '登录账号*', '手机号', '角色', '初始密码*'],
      required: ['工号*', '姓名*', '登录账号*', '初始密码*'],
      key: '工号*',
    },
    学期: {
      headers: ['学期编码*', '名称*', '开始日期*', '结束日期*'],
      required: ['学期编码*', '名称*', '开始日期*', '结束日期*'],
      key: '学期编码*',
    },
    班级: {
      headers: ['班级编码*', '名称*', '学期编码*', '班主任工号', '人数上限'],
      required: ['班级编码*', '名称*', '学期编码*'],
      key: '班级编码*',
    },
    课程: {
      headers: ['课程编码*', '名称*', '学分', '负责人教师工号'],
      required: ['课程编码*', '名称*'],
      key: '课程编码*',
    },
    开课班: {
      headers: ['开课编码*', '课程编码*', '学期编码*', '班级编码', '任课教师工号', '容量'],
      required: ['开课编码*', '课程编码*', '学期编码*'],
      key: '开课编码*',
    },
    选课: {
      headers: ['开课编码*', '学生学号*'],
      required: ['开课编码*', '学生学号*'],
      key: '学生学号*',
    },
  };

function cellValue(value: unknown): string | number {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return value;
  return String(value ?? '').trim();
}

export async function parseImportWorkbook(buffer: Buffer): Promise<ParsedImport> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const rows: ImportRow[] = [];
  for (const sheetName of IMPORT_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const definition = definitions[sheetName];
    for (const cell of Object.values(sheet)) {
      if (typeof cell === 'object' && cell && 'f' in cell && cell.f)
        throw new Error(`${sheetName}工作表不允许公式单元格`);
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
    });
    const actualHeaders = definition.headers.map((_, index) =>
      String(matrix[0]?.[index] ?? '').trim(),
    );
    if (actualHeaders.join('|') !== definition.headers.join('|'))
      throw new Error(`${sheetName}工作表标题不符合模板`);
    for (let index = 2; index <= matrix.length; index++) {
      const source = matrix[index - 1] ?? [];
      const values: Record<string, string | number> = {};
      definition.headers.forEach((header, column) => {
        values[header] = cellValue(source[column]);
      });
      if (Object.values(values).every((value) => value === '')) continue;
      const errors = definition.required
        .filter((header) => values[header] === '')
        .map((header) => `${header.replace('*', '')}不能为空`);
      rows.push({
        sheet: sheetName,
        rowNumber: index,
        key: String(values[definition.key]),
        values,
        errors,
      });
    }
  }
  if (rows.length > 5000) throw new Error('单次导入不能超过5000行');
  const keys = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = keys.get(row.sheet) ?? new Set<string>();
    if (set.has(row.key)) row.errors.push('文件内存在重复主键');
    set.add(row.key);
    keys.set(row.sheet, set);
    if (
      (row.sheet === '学生' || row.sheet === '教师') &&
      String(row.values['初始密码*']).length < 12
    )
      row.errors.push('初始密码至少12位');
  }
  const has = (sheet: ImportSheetName, key: unknown) => !key || keys.get(sheet)?.has(String(key));
  for (const row of rows) {
    if (row.sheet === '班级' && !has('学期', row.values['学期编码*']))
      row.errors.push('引用的学期不在文件中');
    if (row.sheet === '班级' && !has('教师', row.values['班主任工号']))
      row.errors.push('引用的班主任不在文件中');
    if (row.sheet === '课程' && !has('教师', row.values['负责人教师工号']))
      row.errors.push('引用的负责人不在文件中');
    if (row.sheet === '开课班') {
      if (!has('课程', row.values['课程编码*'])) row.errors.push('引用的课程不在文件中');
      if (!has('学期', row.values['学期编码*'])) row.errors.push('引用的学期不在文件中');
      if (!has('班级', row.values['班级编码'])) row.errors.push('引用的班级不在文件中');
      if (!has('教师', row.values['任课教师工号'])) row.errors.push('引用的教师不在文件中');
    }
    if (row.sheet === '选课') {
      if (!has('开课班', row.values['开课编码*'])) row.errors.push('引用的开课班不在文件中');
      if (!has('学生', row.values['学生学号*'])) row.errors.push('引用的学生不在文件中');
    }
  }
  const summary = Object.fromEntries(
    IMPORT_SHEETS.map((sheet) => [sheet, rows.filter((row) => row.sheet === sheet).length]),
  );
  const invalidRows = rows.filter((row) => row.errors.length).length;
  return {
    rows,
    totalRows: rows.length,
    validRows: rows.length - invalidRows,
    invalidRows,
    summary,
  };
}
