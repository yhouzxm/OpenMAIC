# P4／P6 课堂语音与课件视觉收口（LOCAL）

本包范围是固定发布版本内的麦克风提问、ASR 转写、原生课堂 Agent 识图及 TTS 回答播放。复用 OpenMAIC 录音、Pi 课堂、工具图像消息及语音队列；不引入新正式成绩来源。2026-10-27 最终本地旅程已通过，见[收口 receipt](evidence/classroom-voice-vision/closeout.json)和[真实调用记录](evidence/classroom-voice-vision/application.json)。

## 实际接线

- 当前 GLM-ASR 录音在浏览器从 MediaRecorder 容器转换成单声道 PCM WAV，显示倒计时并在 25 秒自动停止；服务端按 WAV 内容校验 PCM、采样率、长度和不超过 30 秒。畸形、超长、客户端 provider／URL 指定不能绕过服务端配置。
- 停止后保留识别锁；取消会中断本机请求并忽略迟到的转写，离页释放音轨、定时器和浏览器识别。权限请求迟到时也会释放音轨。非全屏语音／文字按钮及停止按钮有可访问名称，停止事件不再冒泡触发外层取消。
- 新增仅配置使用的 `classroom.chat` 子槽，继承 `classroom`。只将 `chat-adapter` 映射到该子槽，保留测验正式评分和 PBL 的原槽。本机私有 `openmaic.yml` 以原有环境变量引用配置 `glm-classroom-vision:glm-4.6v`，不交付密钥。免费 Flash 模型曾真实返回访问过载，未把失败标成成功。
- 导演及原生子 Agent 的 `inspect_classroom_image` 只读取服务器选定当前幻灯片、当前发布快照中的 PNG／JPEG／WebP；最多两张、每张 1 MiB。工具只接受索引，不能指定网络 URL、其他课件或任意资产。Tutor 的现有图片工具复用同一对话模型子槽；本包课堂验收不自动扩大为全部 Tutor 场景验收。
- 资源字节读取先完成自己的授权与快照 hash 检查，再在返回图像前复查当前 Identity、Enrollment、启用状态和固定发布版本。避免嵌套事务持有 SHARE 后经另一连接申请 UPDATE 造成自等待；不延长锁超时、不缓存授权、不放宽撤权屏障。

语音与图像能力约束依据：[GLM-ASR 接口](https://docs.bigmodel.cn/api-reference/模型-api/语音转文本)、[GLM-4.6V 官方说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v)。

- 原生讨论返回的 `data:` 音频地址原先被课堂 CSP 拦截，现改用 Blob URL，结束、取消、静音取消预取和迟到响应均有释放边界；保留原 CSP。过滤分片输出中的工具标记，不朗读、不冒充工具执行。

## 验收与边界

真实浏览器已完成“点击麦克风→点击停止→GLM-ASR 中文转写→当前发布图片工具→识别蓝色方形、红色圆形及 7284→豆包语音→实际解码播放（9.864 秒）”。另有 25 秒自动停止的真实转写记录。桌面／390px 图片实际解码宽度为 800px；截图在布局与图片加载完成后采集。取消与再次录音没有发出 ASR 请求；畸形／31 秒 WAV、伪造 provider 和已撤权请求均被拒绝，启用状态已恢复。原 92/100 成绩、证明、完成判定及演示账号 hash 已核对保留。

相关单元、原生作用域类型检查通过。默认堆全项目类型检查曾 OOM，未算通过；提高至 6 GiB 的原生作用域检查通过。定向 lint 无错误，保留原有快捷键 effect 依赖警告。证据均为 LOCAL，不扩大旧 CI／P7 包适用范围。


采用本地非个人合成声音及自制图形／数字图片；真实 Chromium 麦克风 API、真实服务请求与浏览器播放分别记录，合成输入不等于 mock 服务成功。仅验证本包及新增授权／并发边界，不重复完整课堂、Office、导出或 GitHub CI。

这是逐句录音问答和已发布课件图片理解，不承诺全双工打断式通话、持续摄像头或屏幕监控。图片正文／工具结果始终是非可信参考材料。旧 Native 维护链、UNKNOWN／RESERVED 隔离及真实仪器可信完成保持。没有修改已应用 migrations 或冻结生产授权语义，没有 Git 提交、推送或 CI。

下一完整包为近期增量的一次性持久化／Ubuntu＋PG18 交付；跨版本数据迁移和目标主机验收单独授权。建议 GPT-6.1 Sol / high（迁移与授权并发）；普通页面复用用 medium。
