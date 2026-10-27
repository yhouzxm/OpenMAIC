import React, { useCallback, useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import { v7 } from 'uuid';
import type { AppDocument } from '@/lib/document-store/persistence-types';
import { buildExportZip } from '@/lib/video-export-app/build-export-zip';
import { sanitizeFilename } from '@/lib/video-export-app/export-options';
type Api = (path: string, init?: RequestInit) => Promise<Response>;
export function CourseVideo({
  api,
  source,
  load,
}: {
  api: Api;
  source: URLSearchParams;
  load: () => Promise<{ document: AppDocument }>;
}) {
  const [cap, setCap] = useState(false),
    [accepting, setAccepting] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('正在检查渲染服务…'),
    [job, setJob] = useState<{ id: string; status: string; progress?: number } | null>(null),
    [jobs, setJobs] = useState<{ id: string; status: string }[]>([]),
    [resolution, setResolution] = useState<'720p' | '1080p'>('720p'),
    [subtitles, setSubtitles] = useState(true);
  const refresh = useCallback(async () => {
    const c = await (await api('/video/capability?' + source)).json();
    setCap(c.enabled === true);
    setAccepting(c.enabled === true && c.accepting !== false);
    setJobs(await (await api('/video/jobs?' + source)).json());
    setNotice(
      c.enabled
        ? '原生渲染服务已连接；可导出固定课件为 MP4。'
        : '渲染服务未连接；可下载原生视频工程 ZIP，接通服务后再渲染。',
    );
  }, [api, source]);
  useEffect(() => {
    void refresh().catch((e) => setNotice(e.message));
  }, [refresh]);
  const jobId = job?.id,
    jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || ['succeeded', 'failed', 'cancelled', 'expired'].includes(jobStatus))
      return;
    let closed = false,
      running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const v = await (await api('/video/jobs/' + jobId)).json();
        if (!closed) {
          setJob(v);
          if (v.status === 'failed')
            setNotice('视频渲染失败；请检查渲染服务诊断，或下载视频工程在配置完整的主机渲染。');
        }
      } catch (e) {
        if (!closed) {
          setNotice((e as Error).message);
          setJob((previous) =>
            previous?.id === jobId ? { ...previous, status: 'failed' } : previous,
          );
        }
      } finally {
        running = false;
      }
    };
    const t = setInterval(() => void check(), 2000);
    void check();
    return () => {
      closed = true;
      clearInterval(t);
    };
  }, [api, jobId, jobStatus]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const build = async (mp4: boolean) => {
    setNotice('正在读取固定课件并编译原生视频工程…');
    const { document } = await load();
    const result = await buildExportZip({
      resolution,
      locale: 'zh-CN',
      burnInSubtitles: subtitles,
      document,
    });
    if (result.missingCount || result.errorCount)
      throw Error(
        `课件有 ${result.missingCount} 份缺失资产／${result.errorCount} 项编译提示，请核对课件后再导出。`,
      );
    await api('/archive/access?' + source);
    if (!mp4) {
      saveAs(result.zipBlob, sanitizeFilename(result.stageName) + '.video.zip');
      setNotice('已下载完整视频工程；该文件尚未渲染为 MP4。');
      return;
    }
    const r = await api('/video/jobs?' + source + '&fps=24&quality=draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'x-zhiban-command': v7() },
      body: result.zipBlob,
    });
    setJob(await r.json());
    setNotice('渲染已排队，可留在本页查看进度；下载前仍核对当前任教资格。');
  };
  return (
    <section className="card" aria-label="整课视频导出">
      <h2>整课视频导出</h2>
      <p>
        按固定课件的场景、已有讲授音频和字幕生成视频；不录制师生私人 AI
        对话，不将视频作为正式成绩证据。
      </p>
      <label>
        视频分辨率{' '}
        <select
          aria-label="视频分辨率"
          value={resolution}
          onChange={(e) => setResolution(e.target.value as typeof resolution)}
        >
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
        </select>
      </label>{' '}
      <label>
        <input
          type="checkbox"
          checked={subtitles}
          onChange={(e) => setSubtitles(e.target.checked)}
        />
        烧录字幕
      </label>
      <div className="actions">
        <button disabled={busy || !cap || !accepting} onClick={() => void run(() => build(true))}>
          生成整课 MP4
        </button>
        <button disabled={busy} onClick={() => void run(() => build(false))}>
          下载视频工程 ZIP
        </button>
        <button disabled={busy} onClick={() => void run(refresh)}>
          检查服务与历史任务
        </button>
      </div>
      <p role="status">{notice}</p>
      {job && (
        <div>
          <p>
            当前渲染：
            {(
              {
                queued: '排队中',
                running: '渲染中',
                succeeded: '已完成',
                failed: '失败',
                cancelled: '已取消',
                submitting: '提交中',
                expired: '已过期',
              } as Record<string, string>
            )[job.status] ?? job.status}{' '}
            · {Math.round((job.progress ?? 0) * 100)}%
          </p>
          {['queued', 'running'].includes(job.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api('/video/jobs/' + job.id, { method: 'POST' });
                  setJob({ ...job, status: 'cancelled' });
                })
              }
            >
              取消当前渲染
            </button>
          )}
          {job.status === 'succeeded' && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await api('/video/jobs/' + job.id + '/download');
                  saveAs(await r.blob(), '课堂视频.mp4');
                  setNotice('MP4 已下载。');
                })
              }
            >
              下载整课 MP4
            </button>
          )}
        </div>
      )}
      {jobs.length > 0 && (
        <details>
          <summary>本人的本课件任务</summary>
          {jobs.map((j) => (
            <p key={j.id}>
              <button
                onClick={() =>
                  setJob({
                    id: j.id,
                    status: j.status === 'SUBMITTED' ? 'queued' : j.status.toLowerCase(),
                  })
                }
              >
                查看任务 {j.id.slice(0, 8)}
              </button>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
