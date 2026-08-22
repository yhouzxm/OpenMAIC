import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
export const maxDuration = 120;

const run = promisify(execFile);
const MAX_PPT_BYTES = 100 * 1024 * 1024;

async function resolveSoffice() {
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  const candidates = [
    configured,
    process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe' : null,
    'soffice',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate === 'soffice') return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported installation location.
    }
  }
  return 'soffice';
}

export async function POST(request: Request) {
  let workDir: string | null = null;
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || !/\.ppt$/i.test(file.name)) {
      return NextResponse.json({ error: '请选择有效的 .ppt 文件' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_PPT_BYTES) {
      return NextResponse.json({ error: 'PPT 文件不能为空且不能超过 100MB' }, { status: 413 });
    }

    workDir = await mkdtemp(path.join(tmpdir(), 'zhiban-ppt-'));
    const inputPath = path.join(workDir, 'source.ppt');
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const soffice = await resolveSoffice();
    try {
      await run(
        soffice,
        ['--headless', '--convert-to', 'pptx', '--outdir', workDir, inputPath],
        { timeout: 110_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return NextResponse.json(
          { error: '服务器尚未安装 LibreOffice，暂时无法转换 .ppt；请安装后配置 LIBREOFFICE_PATH，或先另存为 .pptx' },
          { status: 503 },
        );
      }
      throw error;
    }

    const output = await readFile(path.join(workDir, 'source.pptx'));
    return new NextResponse(new Uint8Array(output), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-disposition': 'attachment; filename="converted.pptx"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? `PPT 转换失败：${error.message}` : 'PPT 转换失败' },
        { status: 500 },
      )
    );
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
