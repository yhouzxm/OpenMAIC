/* eslint-disable @typescript-eslint/no-explicit-any -- read-only capability/native material views */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { v7 } from 'uuid';
const q = new URLSearchParams(location.search),
  tenant = q.get('tenant'),
  offering = q.get('offering');
if (![tenant, offering].every((v) => /^[a-f0-9-]{36}$/.test(v ?? '')))
  throw Error('Invalid course context');
const base = `/api/zhiban/authoring/${tenant}/offerings/${offering}`,
  workbench = `/zhiban/native-workbench?tenant=${tenant}&offering=${offering}`;
let csrf: Promise<string> | undefined;
async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-zhiban-request', 'identity-v1');
  if (!['GET', 'HEAD'].includes(init.method ?? 'GET')) {
    csrf ??= fetch('/api/zhiban/identity/csrf', {
      headers: { 'x-zhiban-request': 'identity-v1' },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw Error('请重新登录');
        return (await r.json()).csrfToken;
      })
      .catch((e) => {
        csrf = undefined;
        throw e;
      });
    headers.set('x-zhiban-csrf', await csrf!);
  }
  const r = await fetch(base + path, { ...init, headers, cache: 'no-store' });
  if (!r.ok) {
    let code = '';
    try {
      const v = await r.json();
      code = v.error?.code ?? v.errorCode ?? '';
    } catch {}
    throw Error(
      (
        {
          MEDIA_SERVICE_UNAVAILABLE: '此服务尚未配置或已关闭，未发起生成。',
          MATERIAL_SERVICE_UNAVAILABLE: '此格式需要解析服务，请先完成主机配置。',
          SCANNER_REQUIRED: '可信扫描器不可用。',
          FILE_NOT_CLEARED: '文件未通过可信扫描。',
          MEDIA_BUSY: '本课程本人已有生成在运行，请先查证原结果。',
          MEDIA_OUTCOME_UNKNOWN:
            '上次生成的结果尚不确定，未再次调用服务。请由主机查证，勿连续重试。',
          COMMAND_CONFLICT: '该请求内容已变化，请重新发起。',
          MEDIA_CANCELLED: '请求已取消或超时；不自动重试，服务商任务可能仍在结算。',
          FORBIDDEN: '当前课程授权已变化，请返回课程。',
        } as Record<string, string>
      )[code] ?? `操作未完成（${code || r.status}）`,
    );
  }
  return r;
}
function Root() {
  const [status, setStatus] = useState<any>(null),
    [materials, setMaterials] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [notice, setNotice] = useState('正在核对当前任教与主机服务…'),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [prompt, setPrompt] = useState(''),
    [result, setResult] = useState<any>(null),
    [text, setText] = useState(''),
    [conversion, setConversion] = useState<any>(null),
    [copy, setCopy] = useState('');
  const [command, setCommand] = useState(v7());
  const [controller, setController] = useState<AbortController | null>(null);
  const load = async () => {
    setStatus(await (await api('/media/status')).json());
    setMaterials((await (await api('/native/api/materials')).json()).materials);
    setJobs((await (await api('/media/jobs')).json()).items);
  };
  useEffect(() => {
    void load()
      .then(() => setNotice('资料与素材先在本人课程工作区保存；学生可见内容须另行审核发布。'))
      .catch((e) => setNotice(e.message));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice(
        (e as Error).name === 'AbortError'
          ? '已停止等待；请先查证结果，不自动重试生成。'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setController(null);
    }
  };
  const upload = () =>
    act(async () => {
      if (!file) return;
      if (file.size > 1048576) throw Error('资料每文件最多 1 MiB。');
      await api('/native/api/materials', {
        method: 'POST',
        headers: {
          'content-type': file.type || (/\.md$/i.test(file.name) ? 'text/markdown' : 'text/plain'),
          'x-material-filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      await load();
      setNotice('原件已扫描保存，原生抽取正在处理。点击刷新查看状态；失败可重试或删除。');
    });
  const uploadMedia = () =>
    act(async () => {
      if (!file) return;
      setCopy('');
      if (file.size > 25 * 1024 * 1024) throw Error('素材最多 25 MiB');
      const r = await (
        await api('/media/upload', {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        })
      ).json();
      setResult(r);
      setCommand(v7());
      setNotice('本地素材已扫描保存，未调用AI。可创建新课件并审核发布。');
    });
  const generate = (kind: string) =>
    act(async () => {
      const c = new AbortController();
      setController(c);
      setResult(null);
      setCopy('');
      let path = '/native/api/generate/' + kind,
        body: BodyInit;
      const headers: Record<string, string> = { 'x-zhiban-command': command };
      if (kind === 'asr') {
        if (!file) throw Error('请选择音频文件');
        if (file.size > 5 * 1024 * 1024) throw Error('语音文件最多 5 MiB');
        const input = status.kinds.asr.audioInput;
        if (
          input &&
          !input.mimes.includes(file.type.split(';')[0].replace('audio/x-wav', 'audio/wav'))
        )
          throw Error(`当前转写模型只支持 WAV／MP3，单段最多 ${input.maxSeconds} 秒。`);
        const form = new FormData();
        form.set('audio', file);
        form.set('language', 'zh-CN');
        body = form;
        path = '/native/api/transcription';
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(
          kind === 'tts' ? { text: prompt, audioId: 'narration' } : { prompt, aspectRatio: '16:9' },
        );
      }
      setNotice('正在调用主机选定服务。取消只停止本次接收，不保证服务商停止计费。');
      const value = await (
        await api(path, { method: 'POST', headers, body, signal: c.signal })
      ).json();
      if (kind === 'asr') {
        setText(value.text);
        setConversion(null);
        setNotice('语音转写已返回，请核对后再用于备课。');
      } else {
        setResult(value);
        setNotice(
          value.reused
            ? '已取回上次素材，未再次调用服务。'
            : '素材已通过扫描并保存。可创建新的课件编辑副本，再采用发布。',
        );
      }
    });
  const adopt = () =>
    act(async () => {
      const r = await (
        await api('/media/adopt', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zhiban-command': command },
          body: JSON.stringify({
            assetId: result.assetId,
            title: prompt.slice(0, 120) || '多模态教学素材',
            ...(result.audioId ? { text: result.speechText ?? '' } : {}),
          }),
        })
      ).json();
      setCopy(r.stageId);
      setNotice('已创建新课件，未覆盖原文档。请打开核对、采用为课程草稿并发布。');
    });
  return (
    <>
      <header>
        <a href={`/zhiban/content?tenant=${tenant}&offering=${offering}`}>← 返回课程</a>
        <h1>资料与多模态服务</h1>
        <a href={workbench}>原生备课工作台</a>
      </header>
      <main>
        <p role="status" className="status">
          {notice}
        </p>
        {status && (
          <>
            <section className="card">
              <h2>当前可用服务</h2>
              <p>
                “已配置”表示主机已指定服务，实际效果需真实调用验收。密钥、地址和模型由主机配置，普通教师无法修改。
              </p>
              <div className="service-grid">
                {Object.entries(status.kinds).map(([k, v]: any) => (
                  <article key={k}>
                    <strong>
                      {
                        (
                          {
                            image: '图像生成',
                            video: '视频生成',
                            tts: '语音合成',
                            asr: '语音转写',
                          } as any
                        )[k]
                      }
                    </strong>
                    <p>
                      {v.available
                        ? '已配置 · 尚未真实验收'
                        : v.state === 'DISABLED'
                          ? '主机已关闭'
                          : '服务未配置／不可用'}
                    </p>
                    <small>{v.provider ?? '需主机配置'}</small>
                  </article>
                ))}
              </div>
              <p>
                资料本地可解析：TXT／MD／CSV、文本 PDF。Office／图片
                OCR／音视频解析依据主机文档服务；当前文档服务：
                {status.materials.documentProvider ?? '未配置'}。扫描器：
                {status.scanner ? '已配置' : '不可用'}。
              </p>
              <p className="muted">
                资料最多 1 MiB；语音转写最多 5 MiB；生成素材最多 25
                MiB。语音使用主机默认音色，未开放声音克隆；本页不产生正式成绩或完成记录。
              </p>
              {status.kinds.asr.audioInput && (
                <p>
                  当前语音转写模型支持 WAV／MP3，单段最多 {status.kinds.asr.audioInput.maxSeconds}{' '}
                  秒。
                </p>
              )}
            </section>
            <section className="card">
              <h2>课程资料库</h2>
              {status.materials.mimes.includes('application/msword') && (
                <p>
                  旧 DOC／PPT／XLS
                  将先在本地隔离转换，再交给当前解析服务；原件保留，发布前请核对正文与版式。
                </p>
              )}
              <p>
                上传后复用原生抽取和 Agent
                引用。外部解析／生成会向主机选定服务发送相应内容。原件保留在本人课程资料库，学生发布仍走课程资源入口。
              </p>
              <input
                aria-label="选择资料或音频"
                type="file"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setCommand(v7());
                }}
              />
              <div className="actions">
                <button disabled={busy || !file || !status.scanner} onClick={upload}>
                  扫描上传资料
                </button>
                <button disabled={busy || !file || !status.scanner} onClick={uploadMedia}>
                  导入已有图片／音视频素材
                </button>
                <button disabled={busy} onClick={() => void act(load)}>
                  刷新资料状态
                </button>
                <a className="link" href={`/zhiban/content?tenant=${tenant}&offering=${offering}`}>
                  课程资源审核发布
                </a>
              </div>
              <ul>
                {materials.map((m) => (
                  <li key={m.materialId ?? m.id}>
                    <strong>{m.originalName ?? m.materialId ?? m.id}</strong> ·{' '}
                    {m.extraction?.status ?? 'idle'}
                    <div className="actions">
                      {['failed', 'idle'].includes(m.extraction?.status ?? 'idle') && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api(
                                `/native/api/materials/${m.materialId ?? m.id}/extraction`,
                                { method: 'POST' },
                              );
                              await load();
                            })
                          }
                        >
                          重试抽取
                        </button>
                      )}
                      {m.extraction?.status === 'ready' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const v = await (
                                await api(
                                  '/media/material-result?id=' +
                                    encodeURIComponent(m.materialId ?? m.id),
                                )
                              ).json();
                              setText(v.text);
                              setConversion(v.legacyConversion ?? null);
                              setCopy('');
                              setNotice(
                                `已读取抽取正文，${v.images} 张图片；${v.truncated ? '本页节选' : '请核对'}。`,
                              );
                            })
                          }
                        >
                          查看抽取正文
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            if (!confirm('删除本人资料原件与抽取结果？已采用的课件资产不删除。'))
                              return;
                            await api(`/native/api/materials/${m.materialId ?? m.id}`, {
                              method: 'DELETE',
                            });
                            await load();
                          })
                        }
                      >
                        删除资料
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <h2>生成与采用</h2>
              <label htmlFor="media-prompt">教学素材描述／朗读文本</label>
              <textarea
                id="media-prompt"
                maxLength={8000}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setCommand(v7());
                }}
                disabled={busy}
              />
              <div className="actions">
                {['image', 'video', 'tts', 'asr'].map((k) => (
                  <button
                    key={k}
                    disabled={
                      busy || !status.kinds[k].available || (k === 'asr' ? !file : !prompt.trim())
                    }
                    onClick={() => void generate(k)}
                  >
                    {
                      (
                        {
                          image: '生成图片',
                          video: '生成视频',
                          tts: '合成语音',
                          asr: '转写所选音频',
                        } as any
                      )[k]
                    }
                  </button>
                ))}
                {controller && <button onClick={() => controller.abort()}>停止等待</button>}
              </div>
              {result && (
                <>
                  <p>
                    {result.source === 'LOCAL_UPLOAD'
                      ? '来源：本地上传，未调用AI'
                      : '来源：主机生成服务'}
                  </p>
                  {result.speechText && (
                    <pre aria-label="本次语音对应讲稿">{result.speechText}</pre>
                  )}
                  <p>
                    素材 SHA256：<code>{result.sha256}</code>
                  </p>
                  {result.mime?.startsWith('image/') ? (
                    <img className="preview" src={result.result.url} alt="本次教学素材" />
                  ) : result.mime?.startsWith('video/') ? (
                    <video className="preview" src={result.result.url} controls />
                  ) : (
                    <audio
                      controls
                      src={`${base}/native/api/persistence/assets/${encodeURIComponent(result.assetId)}/content`}
                    />
                  )}
                  <button disabled={busy} onClick={adopt}>
                    创建新课件编辑副本
                  </button>
                </>
              )}
              {copy && (
                <a className="link" href={workbench + '&course=' + encodeURIComponent(copy)}>
                  打开课件 → 核对／采用／发布
                </a>
              )}
            </section>
            <section className="card">
              <h2>最近生成请求</h2>
              <p className="muted">
                刷新或断连后先查证。结果待查的请求不会自动重放；服务商可能已计费。待绑定素材过期后需明确新建请求，不会静默重新生成。
              </p>
              <button disabled={busy} onClick={() => void act(load)}>
                刷新生成记录
              </button>
              <ul>
                {jobs.map((j) => (
                  <li key={j.id}>
                    {j.kind} · {j.id.slice(0, 8)} ·{' '}
                    {({ READY: '已保存', RUNNING: '处理中', UNKNOWN: '结果待查' } as any)[
                      j.status
                    ] ?? j.status}
                    {j.status === 'READY' && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const value = await (await api('/media/job?id=' + j.id)).json();
                            if (value.text) {
                              setText(value.text);
                              setConversion(null);
                            } else {
                              setResult(value);
                              setCommand(v7());
                            }
                            setNotice('已查证本人保存结果，未再次调用外部服务。');
                          })
                        }
                      >
                        取回结果
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            {text && (
              <section className="card">
                <h2>抽取／转写正文（待教师核对）</h2>
                {conversion ? (
                  <>
                    <p>
                      旧 Office
                      已在本地隔离转换，原件保留。请核对表格、公式与段落；这里创建的是可编辑正文讲义，不承诺还原原版式。
                    </p>
                    <details>
                      <summary>转换来源与校验信息</summary>
                      <p>原件 SHA256：{conversion.sourceSha256}</p>
                      <p>转换件 SHA256：{conversion.outputSha256}</p>
                    </details>
                    <label>
                      核对后的讲义正文
                      <textarea
                        aria-label="核对后的讲义正文"
                        value={text}
                        maxLength={40000}
                        onChange={(e) => setText(e.target.value)}
                        rows={12}
                      />
                    </label>
                    {text.length > 40000 && <p>请精简到40000字以内，原抽取内容与原件仍保留。</p>}
                    <button
                      disabled={busy || !text.trim() || text.length > 40000}
                      onClick={() =>
                        void act(async () => {
                          const title = '旧 Office 核对讲义';
                          const stage = (
                            await (
                              await api('/native/api/stages', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ name: title }),
                              })
                            ).json()
                          ).stage;
                          const escaped = (value: string) =>
                            value
                              .replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;');
                          const chunks = text.match(/[\s\S]{1,400}/g) ?? [];
                          const now = Date.now();
                          const scenes = chunks.map((chunk: string, index: number) => ({
                            id: stage.id + '-review-' + index,
                            stageId: stage.id,
                            title: title + ' ' + (index + 1),
                            order: index,
                            type: 'slide',
                            createdAt: now,
                            updatedAt: now,
                            actions: [],
                            content: {
                              type: 'slide',
                              canvas: {
                                id: stage.id + '-slide-' + index,
                                viewportSize: 960,
                                viewportRatio: 9 / 16,
                                background: { type: 'solid', color: '#ffffff' },
                                elements: [
                                  {
                                    id: 'text-' + index,
                                    type: 'text',
                                    left: 50,
                                    top: 45,
                                    width: 860,
                                    height: 450,
                                    rotate: 0,
                                    defaultFontName: 'Arial',
                                    defaultColor: '#111827',
                                    content:
                                      '<p style="font-size:18px;white-space:pre-wrap">' +
                                      escaped(chunk) +
                                      '</p>',
                                  },
                                ],
                              },
                            },
                          }));
                          await api('/native/api/persistence/documents/' + stage.id, {
                            method: 'PUT',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              stage,
                              scenes,
                              outline: {
                                outlines: [],
                                generationComplete: true,
                                producer: 'client',
                                createdAt: now,
                                updatedAt: now,
                                requirement:
                                  '教师核对编辑正文；原件 SHA256 ' + conversion.sourceSha256,
                              },
                            }),
                          });
                          setCopy(stage.id);
                          setNotice('已创建本人课程中的新课件；打开检查后，按原流程采用并发布。');
                        })
                      }
                    >
                      以核对正文新建课件
                    </button>
                    {copy && (
                      <a className="link" href={workbench + '&course=' + encodeURIComponent(copy)}>
                        打开课件 → 核对／采用／发布
                      </a>
                    )}
                  </>
                ) : (
                  <pre>{text}</pre>
                )}
                <a className="link" href={workbench}>
                  返回原生工作台引用资料备课
                </a>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById('native-services-root')!).render(<Root />);
