> 本轮服务收口：豆包TTS已通过真实生成／扫描／采用发布及学生播放；DOCX／PPTX／XLSX／PNG OCR已通过AliDocMind真实解析。用户开通模型后，Seedance真实生成／扫描／采用发布及学生播放已通过，视频已启用。见[最新服务收口与配置](zhiban-v2-service-provider-final-local.md)。旧证据和P7归档保持各自来源范围。

# 已有服务商集中接入与真实验收（LOCAL）

2026-10-26。用户要求集中接入本机已有服务并确认没有其他受限配置。只发现项目 GLM 标准 API 凭据；其他专用凭据为空。复用现有原生适配器，已接图像生成和 ASR。实际最终状态及恢复证据认 `evidence/service-provider-acceptance/closeout.json`；本包不重新打 P7，8f09fd093eba 保留其冻结源码范围。

| 能力 | 当前真实状态 | 下一依赖 |
| --- | --- | --- |
| 图像生成 | CogView-3-Flash 实际生成、受控取回／转码、真实扫描、资产保存、新课件、采用发布及学生浏览通过；同命令读回未再次生成 | 已启用，可在教师课程「资料与多模态服务」使用 |
| ASR 语音转写 | GLM-ASR-2512 通过已有 OpenAI 兼容传输；真实应用上传、扫描与转写通过，样本为本地非个人合成语音 | 已启用；该服务 WAV／MP3、≤30秒限制按智谱合同；页面说明及服务端格式拦截已补，宿主另限5MiB |
| TTS 语音合成 | 网络修复后真实请求返回 HTTP429；已登记提供者，槽位保持关闭 | 智谱侧确认模型开通／额度／限流后再单次验收，不声称已可用 |
| 音视频资料解析 | 用户已安装FFmpeg／ffprobe；短音频、36秒视频真实扫描→入库→GLM分段转写→关键帧保存→教师正文查看通过 | GLM按25秒切片，其他模型保持600秒；当前原始资料上传仍限1MiB，合成视频样本不代表AI视频生成服务 |
| Office／OCR | 当前 MinerU／AliDocMind 等支持的提供者未配置；现有 GLM 凭据不能自动注册文档解析适配器 | 提供受支持解析服务，或另补智谱文档／OCR适配并实调 |
| 视频生成 | 当前支持的提供者无凭据／配置；没有现成智谱视频适配器 | 提供受支持服务，或补智谱视频适配并实调 |

## 配置和使用

管理员 → 服务与运行中心查看状态；教师 → 原生备课工作台 → 资料与多模态服务生成图片或上传音频转写。配置仍由主机 `openmaic.yml` 管理，`lock: all`、`allowUserKeys: false` 保持，原文字／Agent／课堂槽位和模型白名单未改。新增别名均引用既有 `${GLM_API_KEY}`、`${GLM_BASE_URL}`，未复制密钥或新增账户：

- `glm-image`：preset `glm-image`，仅授权 `cogview-3-flash`，`slots.image` 指向它。
- `glm-recognition`：preset `openai-whisper`，仅授权 `glm-asr-2512`，`slots.asr` 指向它。这里复用的是兼容传输，实际请求仍发送到智谱标准 API。
- `glm-speech`：preset `glm-tts`，仅授权 `glm-tts`；`slots.tts: null`，等待429问题处理。

修改私有配置后先执行 `pnpm exec tsx scripts/zhiban-local/check-multimodal-config.ts`，再正常保存／停止与重启。源代码变化时仅用既有显式本地升级入口，不改已应用 migrations。图片示例只验证服务链路，教材内容／电路结构仍须教师审核，验收不代表生成图具有教学正确性。

## 实际阻碍与修复

本机 Clash Fake-IP 将智谱 API 和生成图片存储域名解析到198.18.*。初次图片生成已返回 URL，但取回被SSRF检查拒绝；TTS在联网前也被拒绝。仅为 `open.bigmodel.cn` 和实际使用的 `maas-watermark-prod-new.cn-wlcb.ufileos.com` 加入真实DNS排除，保留原过滤项。控制器前后基础／代理／TUN设置一致，持久化到本机 Clash 全局 Merge；完整原配置与回退材料只在私有验收目录，不写入Git。项目SSRF、DNS pin、私网拒绝及HTTPS证书验证没有放宽。其他生成存储域名若仍被Fake-IP影响须逐个核验，不使用全域放行。

智谱水印结果实际为JPEG，但CDN声明image/png。新增受限处理仅对主机选定的glm-image、该特定矛盾组合生效：按JPEG严格解码、输入≤25MiB／≤4194304像素／边长64–2048，保持像素及metadata后重新编码为真正PNG，再按原策略校验、扫描和保存。结果保留原始字节SHA256、声明／实际类型和变换记录。其他提供者与损坏／超限内容继续拒绝，未将原JPEG简单改名冒充PNG。

本机已安装FFmpeg／ffprobe。实际36秒视频发现原生 `material-analysis` 将媒体资产列表写成空数组，导致关键帧未随资料保存；现保留内嵌图片及其ID、尺寸和描述，外部URL不混入图片通道。GLM-ASR资料切片设为25秒，其他模型保持原600秒。对应转换、切片、MIME归一化及拒绝路径检查已通过。重复合成语音的视频转写存在冗长重复，教师须核对正文；本次签收链路、时序与资产保存，不签收转写准确率。初次普通恢复因源码receipt不匹配正确拒绝，随后使用既有 `--upgrade-local` 入口接纳本轮源码变化，未绕过来源核验或修改已应用迁移。

## 证据及边界

`media-extraction.json`记录音视频资料真实抽取和学生私有资料拒绝；`media-fixtures.json`保留本地样本来源及二进制hash；`media-ready.png`为教师抽取正文展示。首次视频转写成功但关键帧丢失，修复转换后以同内容重新封装的新样本验证，因此视频实际ASR共四个25秒以内请求（初次两段、修复后两段），未将初次零图片结果签收。

`application.json`：真实 Identity／CSRF、当前任教、图片生成→扫描→采用发布→学生固定版本显示；ASR上传扫描／转写；同命令图片回放及学生生成拒绝。`qualification.json`保留真实失败和网络／MIME原因；`targeted-checks.json`记录相应单元、类型及lint。没有用 mock 冒充服务成功；ASR本地合成测试样本不构成GLM-TTS成功。

主机配置及原账号／历史保留，新增合成示例资源和媒体结果随owned私有持久化备份保存。原Identity／Bridge合同和Native维护隔离不变；没有提交／推送、CI或生产部署。配置文件不进入源码包；私有快照如含已保存的加密提供者凭据及实例密钥，仍按敏感材料保管。

官方接口合同：[图像生成](https://docs.bigmodel.cn/api-reference/模型-api/图像生成)、[文本转语音](https://docs.bigmodel.cn/api-reference/模型-api/文本转语音)、[语音转文本](https://docs.bigmodel.cn/api-reference/模型-api/语音转文本)；本机DNS排除依据[Mihomo DNS配置](https://wiki.metacubex.one/config/dns/)。接口文档不代替本包实际验收结果。

下一步集中处理剩余文档／OCR、视频生成提供者和TTS429；常规配置接入建议GPT-6.1 Sol / medium，新增解析／视频适配和出网／并发边界可用high。
