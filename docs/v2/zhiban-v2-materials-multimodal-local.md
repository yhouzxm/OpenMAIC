# 原 P3／P6：资料与多模态服务整包（LOCAL）

2026-10-26。沿原计划第 6 节资源与附件大包，复用 OpenMAIC 原生资料库、extractor registry、图像／视频生成、TTS／ASR、owner asset store、编辑器和固定采用发布。本包交付课程接线及无外部依赖的实际旅程；用户确认外部服务**未配置**，不把配置／拒绝检查写成真实解析或生成成功。

## 教师入口与完整流程

课程 → 原生备课工作台 → **资料与多模态服务**。默认地址 `https://127.0.0.1:3461/zhiban`；专项在独立 3468 运行，不重置原账号。

- **资料备课**：查看当前解析服务 → 扫描上传资料 → 原生后台抽取 → 刷新状态／查看正文／失败重试／删除 → 回原生工作台引用资料备课 → 原有核对、采用草稿、显式发布。课程资料库按 tenant／offering／教师 owner 隔离；私有原件不因上传自动向学生开放。学生可见资源沿课程资源审核发布入口交付。
- **已有媒体**：上传本人图片／音视频 → 容器检查与真实扫描 → 原生 owner asset 保存 → 创建新的课件编辑副本 → 核对、采用、发布 → 学生查看。页面明确标记 `LOCAL_UPLOAD`，不是 AI 生成，也不声称模拟素材是服务成功。
- **配置后的媒体服务**：描述 → 原生图像／视频生成或主机默认音色 TTS → 受控取回、扫描、保存 → 新课件编辑副本 → 原有采用发布。ASR 对本人选择的音频先扫描，再调用主机服务，返回正文供教师核对。所有提供者／模型／密钥／地址由主机决定。
- **故障恢复**：最近生成请求只读查询、取回已保存结果；相同请求复用结果，结果不确定时拒绝付费重放。未认领素材沿原 Native pending GC 处理，过期结果明确拒绝，不能静默重新生成。每 owner 最多 100 个持久请求记录，达到上限须运营者受控归档／清理；本页不提供任意路径清理。

## 配置交付与当前状态

本机私有 `openmaic.yml` 的 image／video／tts／asr／document 槽仍关闭，GLM 文字与课堂配置未改。常规 `TXT／MD／CSV` 和文本 PDF 不依赖这些服务；新页面的“已配置”也只表示配置可解析，不是供应商可用性证明。

| 能力 | 复用与配置 | 当前真实验收边界 |
| --- | --- | --- |
| Office／图片 OCR | 原生 document provider、对应 MIME registry 和受限凭据 | 未配置，拒绝不支持格式，不产生假正文 |
| 音视频资料抽取 | 原生 media registry；配置的 AliDocMind，或具备 ffmpeg／ffprobe 与 ASR 时的本地路径 | 本机无相关服务／二进制，真实转写与关键帧待验 |
| 图像／视频生成 | 原生 image／video 槽及 provider 实现 | 接线已补，实际生成待服务；不借用现有文字模型密钥擅自启用 |
| TTS／ASR | 原生 tts／asr 槽、朗读与转写实现 | 接线已补，真实语音待服务；使用主机默认音色，不开放声音克隆 |
| 本地资料／已有媒体 | 原生本地抽取、扫描与资产／课件采用发布 | 以本包 LOCAL 证据为准，与 AI 服务成功分列 |

配置时合并既有私有配置，**不要用示例覆盖原 GLM／课堂设置**。原生完整模板为仓库根 `openmaic.example.yml`；给相关 provider 配置 preset、凭据环境变量引用及模型授权列表，再显式指定 slots。保持 `lock: all`／`allowUserKeys: false`；不允许普通教师添加付费模型或写主机配置。

`.env.local` 必须 owner-only。默认及专项 launcher 现在可交付 provider 凭据／服务变量与 `OPENMAIC_CONFIG`，仍拒绝从该文件覆盖 PG／DATABASE、NODE_OPTIONS、PATH、HOME 或公开前端变量。也可由进程管理器注入变量。配置文件只在启动加载，改变后走受控重启；本包没有热改当前私有配置或外部服务。

离线配置检查（不调用模型／供应商、不打印密钥或 endpoint）：

```bash
pnpm exec tsx scripts/zhiban-local/check-multimodal-config.ts
# 已有受限文件可显式指定绝对路径；本机提供者变量仍须配置到环境
pnpm exec tsx scripts/zhiban-local/check-multimodal-config.ts --config /absolute/private/openmaic.yml
```

课程资源解析默认复用同一主机 document／ASR 配置。为兼容已有部署，显式 `ZHIBAN_MATERIAL_PARSER_CONFIG`＋SHA256 仍优先，只覆盖原课程资源解析，不改变原生槽；文件须 owner／0600／无 symlink／≤16 KiB。私有配置损坏、权限或 pin 不符均拒绝，不降级为假成功。

## 数据、调用与并发边界

- 不改已应用 migrations 或冻结 Identity／Bridge 合同。复用 `Content.authoring` 当前任教授权；原请求绑定在 AsyncLocalStorage 中，短读／写重新检查原 Session，不能用另一个会话更新的 owner 缓存代替授权。
- 图像／视频／TTS／ASR 接口投影允许字段，拒绝请求凭据、provider、endpoint 与设置预览。图像所属 stage 须本 owner 有效；原生 TTS UI 的音色／克隆偏好不向服务转发，使用主机默认音色。
- 不在模型／扫描等待期间持有长 Identity 事务。单进程最多两个媒体重任务、每 owner 一个；另有 PG owner advisory try-lock 防跨进程重入。取消／超时只停止本次等待和未完成的结果交付，不保证服务商取消任务或退费；底层 producer 未结束前不释放执行槽。
- 当前幂等范围为本机／共享同一持久字节根；跨副本部署须共享结果存储和统一账本，分布式场景未验。本人请求记录保存在既有持久 `owned/native-materials` 的 `media-jobs/<owner-hash>/` 下，原子文件写入，随原物理备份恢复；不保存请求密钥、远端 URL 或图像／视频原始提示正文；ASR正文及TTS对应讲稿作为本人结果保存。RUNNING／UNKNOWN 不自动重放；READY 只读回本人保存结果并检查资产摘要。对应TTS讲稿与已生成音频绑定，修改页面描述不会悄悄替换旧音频的讲稿。
- 资料每文件仍 **1 MiB**；ASR 上传 **5 MiB**；生成／本地媒体 **25 MiB**。输出流按字节累积检查；图片只接受 PNG／JPEG／WebP／GIF，音视频只接受明确容器与 MIME。容器头不等于编解码保真。扫描沿原可信 profile、hash、新鲜度和执行前后核对；大素材复用独立受控扫描参数，未放宽原作业附件边界。
- 远端生成结果只接受 provider 返回的 URL，服务端严格 public SSRF 校验、DNS pin 和逐跳重验；没有向浏览器开放 URL 代理。私网返回地址拒绝，局域网服务应通过原生 provider 返回内联字节。新 API 不返回供应商密钥、地址或上游原始错误。原生返回的裸base64没有MIME时，按受支持的实际容器识别；声明与容器矛盾时拒绝，未知类型不猜测为图片。
- 创建副本使用当前 owner 的真实资产，原生 aggregate 原子保存并认领 pending assets；不覆盖打开的编辑器。同资产、同命令重试查证，标题／讲稿变化拒绝；更换资产使用独立副本键；提交后丢 ACK 不删除已保存文档。不会自动发布、计成绩、完成、证书或学分；旧 Native 维护链仍隔离。

## 定向验证与证据

```bash
pnpm exec vitest run tests/zhiban/multimodal tests/zhiban/material/formats.test.ts
pnpm exec tsc -p scripts/zhiban-local/tsconfig.native-authoring.json --noEmit
pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --classroom-ai-focus --multimodal-focus
```

新增 lifecycle 单测使用注入 provider／scanner／store，仅证明撤权、取消守槽、未知结果及防重放，**不是实际供应商或真实扫描成功**。真实扫描／资料抽取／已有素材采用发布与学生读取使用独立 disposable PG16、本机 HTTPS 和真实 ClamAV；未知服务保持拒绝。原资源格式测试一次因同时进行重型编译触发 5 秒测试上限，随后单文件复验通过，实际正文 2.54 秒，未抬高测试超时或修改解析生产时限。

实际结果以 `evidence/zhiban-multimodal-local.json`、`zhiban-multimodal-services-local.json` 及本包 closeout／默认入口证据为准。外部服务真实成功单列待验；历史 P7、原模型和原生归档证明不改写为本包证据，不重打 GitHub CI。

本包可用范围签收：独立 PG16 旅程通过真实 TXT 扫描抽取、安全正文显示、本地图片扫描／真实预览、新文档、采用发布、学生访问、命令重放／冲突／CSRF、标准 EICAR 拒绝及终止任教屏障；未调用外部供应商。默认 3461 沿原账号，新增资料与课件在重启后读回，原两份 PBL 完成报告保留。最终运行源码与检查清单见本包 closeout；不覆盖旧 P7／归档／模型证据范围。

下一完整工作建议沿原 P4／P6 推进可信执行与正式完成的课程侧桥接；旧维护链仍保持隔离，需对应可信输入才启用。复杂跨 Identity／执行并发建议 GPT-6.1 Sol / high；服务配置实调具备输入后一次集中验收，不逐提供者续批。

收尾差额与证据范围：disposable 旅程之后，仅补生成记录的精确运行标识／时间、TTS原讲稿绑定、页面来源标注，以及原生适配器可省略MIME的容器识别。对应行为以最后一轮定向单测／类型检查和默认持久入口核对为准；依赖外部提供者的成功仍未验证，不将注入测试重新标为真实服务成功。

最终默认入口：3461运行中，`sourceMatches=true`、源码漂移0；原账号SHA256未变，新资料正文与课件／资产在重启后读取通过，原两份PBL完成报告仍为completed。最新三库热备份已保存本包资料与课件。未提交、推送、调度CI或部署生产；外部解析／生成／语音真实成功仍未验。
