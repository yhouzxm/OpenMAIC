# 原生整课视频导出与教师控制的课堂共享

沿原 P3／P4 资源与完整课堂包实施；复用本仓库 OpenMAIC 1.2.1 的编译、导出、播放与独立 render-service，不新造视频引擎或正式成绩链。实际验收与剩余边界见 [本包证据](evidence/course-live/closeout.json)。现有 dirty 候选、冻结身份语义、已应用 migrations 和旧 Native 隔离保留。

## 使用入口

首次在 Ubuntu Linux x64 准备独立渲染依赖、固定 Chromium 151 headless shell（官方下载 ZIP 按 SHA256 校验）；需要 Node 22、Python 3、npm、FFmpeg／ffprobe。低内存渲染配置要求至少 4 GiB，单任务／单捕获 worker。本轮未改系统包，渲染浏览器位于本人私有数据目录。

```sh
pnpm trial:zhiban:render:prepare
pnpm trial:zhiban:live --upgrade-local
# 正常停止并保存课程和账号；组合入口随后关闭其自建 renderer：
pnpm trial:zhiban:stop
```

`--upgrade-local` 用于原 LOCAL 快照核对、接入当前源码；不修改生产或跳过 provider 检查。后续源码一致时用 `pnpm trial:zhiban:live`。默认 `pnpm trial:zhiban` 仍不自动启动渲染或跑专项验证。也可单独运行 `pnpm trial:zhiban:render`，应用以受限主机配置 `RENDER_SERVICE_URL=http://127.0.0.1:9016` 接通；`.env.local` 已允许读取此配置。配置内容不送浏览器。

组合入口仅自建／复用 loopback 9016 上返回 owner-bound 标记的兼容服务，不接管其他进程。自建 renderer 的进程组只含自己的 Node／Chromium／FFmpeg，停止时一并释放。Docker 继续使用上游独立服务及私有容器网络；浏览器不直接访问渲染端口。

- 教师从课程已发布课件或原生工作台的「归档与恢复」进入「整课视频导出」；可选 720p／1080p、烧录字幕，查看本人任务、进度、取消及下载。没有兼容服务时仍可下载原生视频工程 ZIP。
- 教师进入已启用的固定版本「原生 AI 课堂」，填写公开板书文字／课堂小结并点「开始课堂共享」。开始后持续共享当前位置和播放状态；另一控制页或任教教师可显式接管／停止。
- 学生看到自动展开的共享面板，主动选择「跟随教师」；可退出跟随，刷新后须重新选择。停止／撤权／失联时暂停跟随并清除公开内容显示。

## 视频边界

直接复用 `buildExportZip → compileVideoTimeline → emitHyperframes → collectVideoAssets → packageVideoZip`，输入为课程授权下读出的固定归档；显式文档与便携资产模式不读取另一个浏览器文档的 Stage 或 Dexie 媒体。原生设计／已有讲授音频／字幕／固定媒体进入视频；没有音频不会偷偷调用 TTS。私人聊天、动态讨论、学生自测／PBL过程不进入视频，不把固定课件视频称为课堂录像。

任务 API 绑定当前租户／教学班／教师本人。上传前、登记任务、提交完成后及状态／取消／下载均核对当前任教和源访问；发布源另核对当前固定 publication。上游 owner 和 admission identity 由服务端派生，客户端不能提交它们。服务端核对源访问和上传工程摘要，不把客户端编译 ZIP 认定为已验证的学习事实或画面来源证明。提交命令与项目 SHA256／参数绑定，重放不重复提交；并发任务仍受上游每 owner 限额。提交后授权失效会尝试取消上游任务，不签成功结果。

上传限 64 MiB 并有读取时限；沿用原生压缩包展开／HTML／网络约束。下载只代理 owner-bound 服务的 MP4 流，不向浏览器泄露服务地址／内部路径或跟随任意重定向。教师导出文件属于导出制品，不构成可信学习完成或成绩证据；下载完成的文件不能撤回。

任务索引写入三库中的 native lesson 数据库，但渲染服务使用上游临时任务与文件生命周期：成品默认保留 30 分钟，服务重启或过期后明确返回过期，须人工重新生成，不自动重复付费／渲染。需要永久视频资源库或分布式持久队列时另配对象存储和生命周期，不能据此宣称生产 HA 已验收。

## 共享范围与并发

只接受严格公共投影：固定 sceneId、动作位置、播放／暂停、教师明确公开的板书文字和小结。不接受私人 chat、messages、answers、PBL、成绩、工具或 owner 字段；不复制 AI 隐藏推理、私有白板结构或个人会话。公开文字经 React 文本渲染，不执行 HTML。

状态按 tenant／offering／resource／publication 独立保存；版本 CAS、控制页 UUID 与当前任教者共同约束 UPDATE。START 是显式接管，STOP 清空共享文字；旧控制页／旧版本并发返回 409。当前 Identity、任教／Enrollment、publication 与 AI policy 的锁覆盖短写提交；事件追加审计仅记操作者／版本／状态摘要，不复制私人消息。

每两秒发送／读取最新完整快照，服务端 15 秒心跳期限；失联后不继续显示旧板书。它是可重连的近实时状态同步，不承诺跨终端逐帧／采样级音频同步。客户端复用原生 PlaybackEngine 的位置与播放接口；无法重建的互动进程、私人现场 AI 对话不强行重放。学生的私人记录和正式成绩不因此更改。

## 本地验收

定向入口（不是默认启动流程）：

```sh
pnpm trial:zhiban:render
# 另一个终端：
RENDER_SERVICE_URL=http://127.0.0.1:9016 pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts \
  --unified-trial --classroom-ai-focus --course-live-focus
```

使用专用 disposable PG16、真实 Identity／课程授权和两浏览器，检查共享开始／翻页／移动端／刷新／停止、私有字段与学生越权拒绝、CSRF、并发 CAS／接管、失联和撤权。视频从真实发布课件与存储 PCM 提示音，经原生编译和 Chromium／FFmpeg 渲染，再实际下载并以 ffprobe 检查 H264 与音轨。提示音只验证音频资产管线，不冒充 TTS 生成验收；不重复模型／多模态调用、无关课堂回归或 GitHub CI。

PG18 全应用、阿里云生产部署、旧 Native 维护授权及真实仪器仍保留原边界；本包不签收它们。
