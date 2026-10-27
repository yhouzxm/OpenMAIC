> 旧 Office 整包已完成 LOCAL：DOC／PPT／XLS隔离转现代格式、双向扫描、AliDocMind真实解析、教师正文核对编辑／新建原生课件／采用发布及学生固定版本查看通过。原件保留，仍限1MiB，不承诺无损版式。见[旧 Office 收口](zhiban-v2-legacy-office-local.md)。

# 现有服务配置接入与收口（LOCAL）

本轮使用操作者在 `.env.local` 新增的豆包 TTS、Seedance 和 AliDocMind 凭据。复用原生适配器，没有复制密钥进源码、浏览器或公开证据，没有修改已应用 migrations。前一轮图像／ASR／FFmpeg验收仍在其原范围内有效；本轮不重新打P7源码交接包。

| 能力 | 本轮实际结果 | 当前边界 |
| --- | --- | --- |
| 豆包 TTS | 真实生成MP3→可信扫描→资产保存→同命令取回→新课件采用发布→学生原生播放器实际解码播放，通过 | 使用标准语音端点及现有单Key；GLM旧429仅是旧提供者历史结果，不再代表当前TTS状态 |
| Office | DOCX、PPTX、XLSX逐一真实AliDocMind解析，正文命中校验内容，教师读取，学生私有资料读取403 | 当前原始资料限1MiB；本轮不声称旧DOC/PPT/XLS已支持；样本是非个人测试课件 |
| OCR | PNG文字图片真实AliDocMind识别，正文命中校验内容，教师读取，学生私有资料读取403 | 支持格式按原生manifest；不等同于扫描精度或任意复杂版式验收 |
| 视频生成 | 操作者确认模型开通后，真实生成5秒H.264视频→可信扫描→保存→新课件采用发布→学生原生播放器实际解码播放，通过 | 使用标准Seedance API及白名单模型；原生播放器视频绑定已修复，不把旧失败记录改写为成功 |

## 配置入口

`.env.local`只提供凭据；当前主机有锁定的`openmaic.yml`，后者的槽位才决定实际启用。`lock: all`、`allowUserKeys: false`及原GLM文字、Agent、课堂、图像、ASR分配保持。新增主机别名：

- `local-doubao-tts`：`preset: doubao-tts`，`apiKey: ${TTS_DOUBAO_API_KEY}`，标准地址`https://openspeech.bytedance.com/api/v3/tts`，`slots.tts`指向它。
- `local-document`：`preset: alidocmind`，`credentials.accessKeyId: ${ALIDOCMIND_ACCESS_KEY_ID}`、`credentials.accessKeySecret: ${ALIDOCMIND_ACCESS_KEY_SECRET}`，`slots.document`指向它。复用原生区域默认地址。
- `local-video`：`preset: seedance`，`apiKey: ${VIDEO_SEEDANCE_API_KEY}`，标准地址`https://ark.cn-beijing.volces.com`，模型白名单仅`doubao-seedance-1-0-pro-fast-251015`；`slots.video: local-video:doubao-seedance-1-0-pro-fast-251015`。

使用教师课程「原生备课工作台 → 资料与多模态服务」上传资料、查看抽取正文或合成语音。语音可取回已保存结果，再创建新课件副本、核对采用、发布。普通教师不能改提供者、模型、凭据或出网地址。配置诊断：`pnpm exec tsx scripts/zhiban-local/check-multimodal-config.ts`，该命令只检查配置，不代表真实服务成功。

不要凭Key前缀自动判断套餐：本次先按形态尝试套餐端点得到401；标准视频只读查证返回资源不存在，标准模型目录200；标准TTS空文本探测返回参数错误且无音频，随后正常合成成功。最终绑定按真实协议结果确定，未改写用户Key、未将其自动当作其他服务凭据。首次标准视频提交因模型未开通而失败；操作者随后确认已开通，使用新的明确命令成功生成，未隐式重提旧UNKNOWN命令。

## 实际修复与验证

真实视频已保存并发布后发现，编辑数据通过`src`记录视频，而原生只读播放器通过`mediaRef`读取媒体表；发布投影未绑定该字段，导致只显示不可用占位。现对已克隆的授权快照补齐绑定，仅限本快照内MIME为video的资产；正文、原始快照、来源digest及发布ID不变。补src／已有mediaRef兼容、外部／外人／图像不绑定的定向检查，再以同一视频、同一发布版本复验实际像素尺寸、播放时间推进和206媒体响应，没有重新生成视频。

AliDocMind在Node原生ESM宿主中外部加载CommonJS SDK时，默认导入是包装对象，原`new Client`在联网前报`Client is not a constructor`。现同时兼容原生ESM包装与Next／Vitest已解包形态；不改签名、鉴权、SDK网络或解析合同。加入真实SDK包的离线ESM构造测试；该测试替换查询方法，不接网络，不冒充真实解析。另隔离既有legacy YAML测试与操作者私有配置，并将冷模块导入放到fixture准备中；测试正文仍保留原默认超时。

本机Clash Fake-IP对新增服务域名产生198.18地址。按已有操作方式，仅补标准TTS、Ark API、DocMind API及官方视频结果存储域名的精确DNS排除，保留原过滤项，基础／代理／TUN配置前后相同；原配置和回退材料保留在owner-only私有目录。没有放宽项目SSRF、DNS pin或TLS。

证据在`evidence/service-provider-final/`：`application.json`记录真实生成及四种解析；`tts-published.json`与`video-published.json`分别记录学生实际音频／视频播放、206媒体响应及固定发布版本；`readback.json`记录重启后的原结果、权限及桌面／手机页面；`closeout.json`记录最终运行状态、检查、配置hash和备份边界。首轮错误和SDK修复前结果保留在私有诊断；公开证据只写固定分类，不复制签名URL、云账号号、Key或原始提供者响应。

样本解析已验证目标文本，不声称任意文档可无损还原版式。原生成请求UNKNOWN记录保留，不删除或重写为成功；成功语音使用修正端点后的独立命令，并验证重复取回不再请求提供者。旧成绩、完成证明和已发布图像只读核对，未重跑完整课堂或CI。

最后保留当前实例的PG16物理快照与素材，并校验文件／hash闭包。私有配置另存于本机受限验收目录，不进入Git或旧P7归档；恢复到另一台主机仍须安全交付相应配置及凭据，不能只靠公开源码包。

官方合同：[豆包HTTP流式语音](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)、[Seedance模型与生成说明](https://docs.volcengine.com/docs/ark/video-generation-tutorial?lang=en)、[阿里云文档解析](https://help.aliyun.com/zh/document-mind/developer-reference/document-parsing-large-model-version)。文档不代替本轮实调；视频的账号模型开通状态由真实`ModelNotOpen`响应确认。

本包现有服务接入完成。后续若需提高1MiB资料上限、增加旧二进制Office格式或提高复杂文档保真度，应按新的明确产品范围处理；不重做已完成入口或逐格式重复P7。常规后续产品接线建议GPT-6.1 Sol / medium。
