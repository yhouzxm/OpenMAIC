# P3／P6 原生 Quiz 生成与教师采用发布（LOCAL）

2026-10-23。复用已集成的 OpenMAIC v1.2.1 durable generation run、outline 确认、Quiz 内容生成与任务存储；不创建第二套生成器。教师在课程“AI 备课”选择“测验”，输入要求，确认大纲，审核题干／参考答案／分值，采用为独立草稿。采用后自动打开现有测验编辑器，教师保存并显式发布，再用现有目录编排供学生学习。发布、固定版本 Attempt、评分与成绩回看沿原服务。

## 产品与数据边界

- 当前生成采用限原生 `single`、`multiple`、`short_answer`；判断可通过原单选编辑器表达。已交付填空／匹配／排序仍可手工编辑，不宣称原生模型已支持生成这些类型。
- 大纲和最终场景均须全为 Quiz；混合场景拒绝采用。现有原生 `normalizeQuizContent` 负责选项 label/value 规范化，智伴严格合同校验答案、分值、数量等；不绕过非法生成内容。
- 采用仅创建 `ASSESSED` 草稿，默认无截止时间、不允许重交、最多一次尝试；教师可按现有规则编辑。不会自动发布、不创建 Attempt、不替教师发布成绩。生成时的大纲确认与采用后的审核发布是两个明确步骤。
- 教师可在可读预览中检查题目与答案；采用后编辑器保持独立，刷新任务列表或重复采用不会覆盖未保存输入。原讲义备课入口保留。
- 来源记录使用 Native run ID、整个服务端文档的 canonical SHA256 和固定 adapter `native-quiz-adopt-1`；题目 ID 按 run／场景／题序确定，不沿用外部 Native ID。媒体、Agent 和讲解动作不随采用进入正式测验。

## 授权、事务与并发

`/api/zhiban/content/:tenant/offerings/:offering/ai?kind=quiz` 仍走原 Content HTTPS／CSRF／命令头与当前教师授权；POST 仅 AI 分支允许该固定 query。讲义和测验使用不同服务器 owner namespace，均绑定 tenant、offering、membership。所有 Native run 读写先验证当前课程资格及服务端 owner/run 绑定；不开放原始 Native API，也不接受客户端 owner、题目内容或发布状态。

采用进入现有 AcademicStore 事务，持有冻结 Identity 当前授权守锁，取得教学班 progress barrier，再读取当前任教关系 `FOR SHARE` 和开放状态；随后才加载服务端已完成、无待处理媒体的 Native 文档并校验预览 hash。调用原 CREATE_QUIZ 扩展，活动、Quiz 定义、命令和带来源的审计同事务提交；没有新 SQL 或迁移。Content 来源异常在进入 Academic 错误边界时显式映射，hash 冲突返回 409，不被包装成 503。

每个 owner/run 使用服务端稳定命令 key；并发采用／丢 ACK 重试返回同一草稿，审计只写一次。已确认 receipt 在当前授权检查后读取，无需再次读取已取消／删除的源；hash 或 adapter 不同则冲突，不能重用 receipt 改写来源。撤权后即使已有 receipt 也不能重放。原草稿编辑／发布继续使用 revision CAS。

Native 源与 Academic 是独立数据库：本包不承诺分布式写事务。采用只读服务端源，正式写入完全在 Academic 一侧；原生文档原子快照读取是来源捕获点，后续取消不撤销已捕获／已采用的草稿。真正撤销教学授权仍受 Identity／关系锁屏障控制，不由取消生成替代。

## 本地验证与证据

[真实生成](evidence/ai-quiz/generation.json)、[采用发布旅程](evidence/ai-quiz/journey.json)、[最终源码及范围](evidence/ai-quiz/final-closeout.json)。均为 LOCAL，`githubActions=false`；非生产部署或 GitHub signoff。

- 真实配置使用现有受限 `.env.local` 的模型项注入本地 launcher，不输出密钥；原生 `glm:glm-5.3` 实际生成 2 单选＋1 多选。当前最终实例使用新 run；此前诊断 run 及其数据已私有备份，不混作最终源码证明。
- 浏览器实走：生成／确认大纲→审核→采用并保留未保存标题→保存／发布→目录编排发布→学生正式作答／确认提交→教师确认评分／发布→学生回看。未开放答案前学生响应不含答案和解析。
- 负向：学生／管理员禁止访问；讲义 owner 不可读 Quiz run；未绑定 run、缺 hash、变更 hash、客户端内容注入均拒绝。
- 真实 disposable PG16 插入故障验证父活动回滚；两个独立教师会话并发只生成一份草稿和一条来源审计。取消源后 receipt 仍可重放；任教撤权后拒绝，恢复后返回原 ID。
- PG advisory lock 人为延迟采用到教学班屏障，确认请求实际等待后，由原管理命令提交撤权；解除锁后采用须拒绝。这验证排队请求不会仅凭早先预检放行。
- 纯转换与原测验合同定向检查、受影响 TypeScript／ESLint；不跑无关全课堂、扫描／导出或 CI。

默认入口仍为受信任 HTTPS `https://127.0.0.1:3461/zhiban`，当前账号路径见 owner-only runtime metadata。该 launcher 启动时只核验／seed；本包两个验证脚本是显式专项命令，不加入默认启动。生成脚本会真实调用模型；采用脚本会写入当前 disposable、取消其生成源并临时撤权恢复，不能当作真实库日常检查。

启动收据保留启动时 hash。最终 UI 文案是请求时从工作区读取的 live 静态文件，旅程实际下载 `/zhiban/lesson.js` 比较 SHA256；closeout 分开列编译业务文件匹配、live asset 和后续文档／验证脚本变化，不改写启动收据来伪造全文件相同。临时实例非持久交付；私有 dump 未作跨主机恢复验收。

## 仍保留的范围

AI 简答建议与正式评价治理尚未接入，不直接把原生 `/api/quiz-grade`（含失败半分回退）接为可信成绩。完整 Runtime／互动完成、PBL／EMA／Peer、更多解析服务及真实运营输入的门禁不变。本包在上一 P7 源快照之后，未重打 P7，也未提交、推送或 dispatch CI。

下一完整包建议：固定正式提交的简答 AI 评分建议→教师采用／拒绝→原正式评分发布，先集中明确失败策略、建议来源与治理，建议 GPT-6.1 Sol / high；不将模型建议自动计入成绩。
