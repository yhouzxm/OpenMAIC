# P3 判断题与测验复用 LOCAL 产品包

2026-10-23，基线分支 refactor/zhiban-v2／HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；保留既有 dirty 候选。沿[原迁移计划](zhiban-v2-migration-completion-plan.md)，承接[新版能力核对](zhiban-v2-quiz-capability-gap.md)。

## 实际完成

现有测验编辑页增加“添加判断题”，生成两选项（正确／错误）的 single 草稿；正确答案不默认勾选，教师须填写题干并选定答案才能发布。作答呈现和客观评分继续复用原生组件／DSL 算法，存储合同仍为原三类题型。

“复制当前草稿中的题目”按序展示复制按钮，复制在源题后插入独立新 ID，保留题干、选项、答案、解析、分值与提示；嵌套内容独立。满100题禁用新增／复制，现有服务端总分和容量校验仍有效。保留原编辑器，其既有扩展来源 hash 未修改；本包只在智伴受控宿主增加便捷操作。

“复制已保存草稿为新测验”与“复制已发布版本为新测验”在当前教学班内工作，有未保存编辑时禁用。调用成功自动打开新草稿，可编辑、保存与显式发布；副本可从原教师活动列表重新打开，并经原目录编排加入教学单元。复制不会自动添加目录单元。

副本继承模式和题目内容，所有题目重新生成 ID；新建活动为 DRAFT、发布版本0，默认无截止时间、不允许同次重交、最多尝试1次。截止时间、尝试次数、Enrollment、Attempt、提交、成绩、进度／先修规则、总评权重及课堂派发不复制。源卷之后变化不修改副本。已封卷源仍可复制成独立新草稿，不会重新开放原卷。

## API、审计与事务

原 `POST /api/zhiban/learning/:tenant/offerings/:offering/quizzes` 增加精确命令：

```json
{"type":"COPY_QUIZ","sourceId":"源活动ID","sourceRevision":"当前revision","sourceVersion":null}
```

sourceVersion 为 null 时取明确 revision 的已保存草稿；正整数字符串时取该固定发布版本。两者均核对源活动当前 revision，冲突需重新读取后决定；旧发布版本可在新 revision 下显式选取。拒绝额外的客户端 content、mode 或 offering 等字段，源内容只从服务端读。

沿原 Identity／Academic run、教学班 progress barrier、教师资格、开放状态、命令锁、payload digest 与持久命令 receipt。源受 tenant＋当前 offering 条件和行锁限制，来源 hash 读回核对后才写副本；不允许跨班复制或只凭 Native ID 取内容。源检查和新活动／quiz definition 写入均在原事务中，失败回滚。命令相同重试返回原 ID；撤权后的重试仍先拒绝。

命令结果及原审计 facts 记录 source activityId／revision／version／hash，不在泛审计中拷贝题目答案。来源引用与副本独立 ID 随原持久 receipt 保存；无需新增 schema 或修改任何已应用 migration。发布、作答、封卷和正式评分的冻结语义不变。

## 本地验证与交接

- 定向浏览器／真实 PG16：`node scripts/zhiban-local/verify-quiz-reuse.cjs`。从现有课程学习与评分页面操作判断题创建、选正确键、题目复制、保存发布、整卷复制自动打开、编辑发布副本、学生作答提交、教师发布2/2分、学生重新进入历史查看结果。源发布版与后续草稿变化独立已核对。
- 受影响负向：未保存禁复制、草稿学生不可见、学生／管理员无复制权限、额外内容字段拒绝、源 revision 冲突、固定旧版取用、同 key 两教师会话返回同一副本、源修改后原 key 仍返回原结果、已撤销任教的新复制与重试均拒绝，原管理命令恢复任教；不存在源／版本时父活动也回滚。
- 定向合同单测、类型检查与受影响 ESLint／格式通过。未重跑无关全课堂、扫描、真实模型或 GitHub CI。旅程脚本首轮修正了合成 fixture 的草稿目录发布、UUID 格式、数据库时间类型与历史回看定位；不把这些失败轮次当作通过证明。

默认3461已用本轮代码刷新至新的 owned disposable PG16，合成试用数据重新初始化；旧三库逻辑备份和私有输入保存在本机 `~/.local/share/zhiban-backups/before-quiz-reuse-20261023-213325/`，未演练恢复。账号使用当前 `pnpm trial:zhiban:info` 指向的私有账号文件，不沿用旧临时目录。验证创建的副本和历史保留为 LOCAL 合成数据。

[旅程记录](evidence/quiz-reuse/journey.json)与[最终来源记录](evidence/quiz-reuse/final-closeout.json)限定本包；旧 P7 归档及旧业务证明保留原 source／root 范围，没有重打 P7。前一轮源码核对文档中的建议状态是历史，本文件记录当前交付。无提交、推送或生产写入。

## 剩余范围

未增加跨班题库、随机抽卷、匹配／排序、AI 正式判分或原生 Quiz 自动采用。下一完整产品包建议为填空题：明确每空答案与可接受变体、计分规则，再集中接编辑／提交／判分／发布与回看；建议 GPT-6.1 Sol / high，因为会扩展正式答案和评分合同，普通页面接线可用 medium。
