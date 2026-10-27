# 原 P6：原生自主 PBL（LOCAL）

2026-10-25。沿主计划第 6 节的完整课堂与实验包，复用 OpenMAIC v1.2.1 原生 `PBLV2Container`、Hero／Workspace／Submission／Completion、Instructor／Simulator／Evaluator 和 package-owned 任务／里程碑算法。既有课程小组、全员确认、共同提交及教师正式评价保持独立。

## 使用入口

默认 `pnpm trial:zhiban`，入口 `https://127.0.0.1:3461/zhiban`，沿用原账号及课程数据。

1. 任教教师在课程「原生备课工作台」生成或编辑含 PBL 的完整课件，采用为独立草稿并显式发布。
2. 从「讲义与图片」打开该版本的「原生 AI 课堂」，先开启 AI 课堂，再单独「开启自主 PBL」。两项均按发布版本默认关闭；换版不继承启用。
3. 学生打开相同发布课件的 PBL 场景，开始／继续项目；导师交流、文字／安全 HTTPS 链接／本地文本成果、任务评价、本人确认完成、阶段反馈与结业报告沿用原生流程。情境项目使用原生 Simulator、角色对话和逐幕结束。
4. 返回项目首页、继续、刷新和退出全屏不会把个人状态写回教师课件。正式小组成果仍从课程 PBL 入口提交。

模型使用运营者配置的 `classroom` 槽。本机为 `glm:glm-5.3` 显式设置 `thinking.mode=disabled`；此前默认思考的两次情境准备说明均触发本包 180 秒上限，失败记录保留。原配置已作 0600 本地备份，私有配置不进入源码交接；目标主机须自行配置模型。浏览器不能指定模型、密钥、endpoint、项目提示词、角色脚本或伪造 AI 评价。当前本地真实模型已贯通普通项目结业报告及情境项目自动复盘／最终报告、刷新恢复；两种本地模型配置的范围在证据中分列。真实模型及页面证明见本包证据；原 P7 归档仍只覆盖其原 source。

## 数据及授权边界

- 来源：当前可访问的已发布完整文档／资产、resource／publication／sourceDigest；服务端清理为设计模板。教师后续修改原生工作区不会修改已发布项目。
- 个人状态：现有派生 `course-learner-*` owner／固定发布 stage 加 scene 分区，保存在专用 Native lesson 数据库 `zhiban_published_pbl_state`；不信任浏览器全量 project。只合并本人新增成果、`roleType=user` 消息、页面阶段及显式下一 reset epoch。设计、AI 消息／评价、任务与里程碑终态、待完成依据及熟练度由服务端原生执行产生。
- 开关：独立 `zhiban_published_pbl_policy`，只有当前任教教师可 CAS 启停；策略历史 append-only。当前课程资格、Identity Session、Enrollment／任教关系、Content／Bridge 活跃发布以及 AI 课堂／PBL 两个开关均要有效。
- 并发：个人场景写入先取 PG session advisory try-lock，再核对 revision；多窗口冲突返回 409，不自动重放。授权和双开关的 SHARE 屏障只包短读取／写入，模型调用期间不占 Identity／发布事务。策略读取与状态读取共用已租借连接，避免嵌套借连接耗尽连接池。单进程最多 2 个 PBL 写执行，模型执行限时 180 秒。
- 流终态：原生服务端 patch 作用于独立投影；成功 `done` 前先保存，并发出带 revision 的 `zhiban_commit`，然后交付原生 `done`。浏览器按流结束串行化后续写入。出错、断流、取消、撤权／停用阻止未完成投影写回，释放锁和槽位；已经进入数据库提交后丢失 ACK 属于结果待核对，重新打开查证，不自动再次执行模型。
- 不产生正式 Attempt、成绩、课程完成、六维分值或 Native 可信完成 receipt。AI 结业报告是本人练习反馈；不会替代教师小组评价、成绩更正或受限服务正式 AI 评分。

## 安装及恢复

新增 `lib/zhiban/infrastructure/classroom-ai/pbl-schema.sql`，只增量安装到受控 Native lesson 数据库；独立 hash receipt 核对源码、字段、owner／ACL 和不可变策略审计触发器。旧 schema receipt、已应用 migrations 及冻结生产身份／Bridge 语义未改。

默认持久恢复会保留该数据库内的本人状态。当前源码具备恢复接线，不代表历史 P7 源码／密文包已经包含本轮增量。跨机与生产仍按其具体授权及交接版本验收。

## 本地验证与证据适用范围

- `docs/v2/evidence/zhiban-native-pbl-local.json`：独立 disposable PG16、真实 Identity／课程／发布、教师独立开关、CSRF／角色边界、个人分区、伪造设计／评价不生效、CAS／守锁、停用屏障、退课／终止任教／撤回、情境确定性进入、390／768／1440 页面及刷新。不调用模型，不把准备的课程数据称为真实教学数据。
- `tests/zhiban/classroom-ai/pbl-state.test.ts`：输入权限及原生完成依据。
- `tests/zhiban/classroom-ai/pbl-stream.test.ts`：注入 producer／DB double 的错误、取消、撤权、并发和提交前终态检查；只证明故障处理，不代表真实 PG 或模型成功。
- `docs/v2/evidence/zhiban-native-pbl-real-model.json`：3461 持久版本的实际模型／原生 UI 旅程，按固定 sample 续验；原始对话只在受限 `/tmp` 文件中，公共证据只记 scope、摘要、capture hash 和检查结果。恢复旧成功流只用于核对历史，不向页面回放假流，也不重复已经成功的模型调用。
- `docs/v2/evidence/zhiban-native-pbl-restart-local.json`：最终源码无漂移、账号原 hash、两个已完成报告随持久重启恢复；缺 CSRF 写入及未登录读取拒绝。不再次调用模型。
- `docs/v2/evidence/zhiban-native-pbl-closeout.json`：当前候选源码／SQL及上述证据 hash、检查结果与剩余边界。build cache 不是产品成功证明。

定向命令（默认启动不执行）：

```bash
pnpm exec vitest run tests/zhiban/classroom-ai/pbl-state.test.ts tests/zhiban/classroom-ai/pbl-stream.test.ts
pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --classroom-ai-focus --native-pbl-focus
# 显式真实模型开销；首次准备新的合成发布项目，--resume 续验同一个受限 sample
pnpm exec tsx scripts/zhiban-local/verify-native-pbl-real.ts --local-real-model
```

## 集中剩余边界

图片／PDF 二进制成果不从此入口绕过课程扫描／解析，使用既有资源与附件入口；自主 PBL 文本文件限 100 KB。语音、外部解析／工具服务配置仍单列。旧 Native CREATE／APPEND／COMPLETE 的可信正式完成、维护签名链及设备实测继续隔离，普通课程 PBL 不依赖它们。

下一完整功能为全格式课件归档／恢复差额，优先复用新版；之后集中更新持久化交接包。常规复用建议 GPT-6.1 Sol / medium，新增跨 Identity／并发边界用 high。
