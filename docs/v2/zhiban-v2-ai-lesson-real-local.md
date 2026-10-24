# 教师 AI 备课真实发布旅程（LOCAL）

2026-10-20，沿原 P6，已完成一次真实供应商“生成 → 确认大纲 → 审核采用 → 编辑保存 → 显式发布 → 学生阅读”。上游 v1.2.1 / `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`；分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。未提交、推送或触发 CI。

## 实际结果

使用本机 `.env.local` 已有 GLM 凭据与默认 `glm:glm-5.3`，没有调用其他供应商或使用 Native 完成结果夹具。仅向模型发送欧姆定律的合成备课要求，不含真实学生资料。真实任务为 `run-75tKWXVzt21rTGuo`，三页大纲经审核后确认，原生任务完成 3/3 页。调用用量与逐阶段时间见 [receipt](evidence/zhiban-ai-lesson-real-local.json)。

浏览器以合成教师账号审核、采用、编辑、保存及显式发布。资源 `01a1596d-b1d5-72d4-bd95-a08cbffc0a26`，发布 ID `01a15970-195b-774e-980d-faf6274c456b`，标题“真实AI备课：欧姆定律”。采用后学生发布预览返回 409；教师发布后学生读取返回 200，真实浏览器已查看全部三页，例题为 `I = 12V ÷ 6Ω = 2A`。这是经教师复核的生成讲义，不是未经改动的模型结果。

[教师发布截图](evidence/ai-lesson-real/teacher-published.png)、[学生例题截图](evidence/ai-lesson-real/student-page2.png)、[学生发布响应](evidence/ai-lesson-real/student-published-response.json)保留各自证据。浏览器未报告 console error；没有重复全课堂、扫描、导出、PG16 基础套件或 GitHub CI。

## 配置与耗时

本机密钥保留在 `.env.local`（权限已收紧为 0600），仅把所需 GLM 变量注入子进程。私有配置位于 `/home/zxm/.local/state/zhiban-model-trial/openmaic.yml`，仅引用环境变量，不含实际 key；搜索／网页读取、Agent、图片、音视频及外部解析槽位关闭，用户不能新增供应商 key。已配置的供应商端点沿用原生受信部署配置；未设置 `ALLOW_LOCAL_NETWORKS`、自定义 DNS 或关闭 TLS 验证。API 验证显式使用原有开发 CA，并核对 CA pin。

同一任务从 20:50:29 到 21:07:32 约 17 分钟，包含教师确认等待；正文默认推理较重。第二页动作遇到 3 次原生 60 秒超时，第 4 次在原配置下成功；已完成正文保留，没有重建任务或改写其状态。

核对项目元数据发现 GLM-5.3 默认 `max`，前两页正文分别约 2 万／1.7 万 reasoning tokens。21:06:07 仅对当前合成课堂的 Native model owner 配置 `course.actions → glm:glm-5.3 / effort:low`，通过原生 `applyModelSettingsChange` 与 `saveWorkspaceModelConfig` 执行配置校验、owner fence 和 revision CAS，写入 revision 1。先核对当前教师 authoring 与 run/tenant/offering/member 的精确绑定；操作使用 owned Native 配置角色，不授予 Identity／Bridge 权限，也没有开放原生模型设置 API。该操作是 LOCAL 维护配置，不代表新增了教师配置页面。

第三页动作随后约 12.5 秒完成；只有一次观察，不能声称已稳定修复延迟。初次加载的私有配置另存 `openmaic-generation-baseline.yml`；当前私有 YAML 及 `start.cjs` 已保存相同的动作 low 配置，供下一次新实例启动。运行进程仍使用原启动配置缓存＋当前 workspace revision 1；未重启或丢弃本次结果。正文和大纲依旧为原默认推理配置，不能承诺所有生成已提速。

从仓库根目录运行 `node /home/zxm/.local/state/zhiban-model-trial/start.cjs` 可在停止旧实例后重建新合成课堂；不能据此恢复旧教学数据。它沿用 `pnpm trial:zhiban` 的 disposable 三库生命周期，启动前应核对 info／备份，不能同时再起第二个 3461 实例。无需把 key 贴到聊天中。

## 本次发现的两项体验差额

1. **公式投影**：原生结果用了 LaTeX 元素；当前纯文字投影明确列为未采用，例题中计算公式因此缺失。本次教师在草稿中补齐纯文本公式、恒温等适用条件并去除重复标题后发布；没有把手工修订冒充自动投影修复。下一产品收尾应保留可安全转为纯文本的公式。
2. **采用后的入口**：“打开已采用草稿”只改变当前页 hash，没有自动更新列表并选中资源。本次通过“刷新列表 → 编辑草稿”继续，未丢失生成结果。下一收尾应让采用后直接打开对应编辑器。

这两项先作为原 P6 的完整体验收尾处理，随后继续 P4 原生课堂差额；不再重复本轮真实供应商调用或无关回归。建议 GPT-6.1 Sol / medium。

## 证据与数据边界

最终 [LOCAL receipt](evidence/zhiban-ai-lesson-real-local.json)与[三库备份](evidence/ai-lesson-real/backup.json)记录源码／配置、用量、发布引用与备份 hash。默认 3461 为 owned disposable PG16，运行核对 `sourceMatches=true / drift=0`。启动 metadata 中 `realGenerationVerified:false` 是启动时快照；本次后续真实结果由独立 receipt 证明，不重签旧启动／夹具证据。

备份包含三库、账号及成员控制输入，已验证 dump 可列出目录，**未执行恢复演练**；供应商凭据仍需本机 `.env.local`，不复制到公共证据。没有读取或改动真实 55432／55433、已应用 migrations 和冻结 Identity 策略。本次只采用文字，原生布局／LaTeX 渲染／动作／动画／音视频不随之发布；完整 Runtime、Interactive、Tutor／Agent 与维护 deferred gates 保持隔离。
