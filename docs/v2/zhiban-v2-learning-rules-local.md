# P2/P4 学习进度、先修与完成规则（LOCAL）

2026-10-23，沿原移植计划补教学班规则发布、学生进度和新进入门禁。首包采用用户确认范围：默认关闭；教师显式发布；正式提交或已发布成绩达到阈值；只限制新 Attempt 与新课堂任务进入；已有作答、提交和历史回看保留。复用既有目录、Learning、Quiz、Classroom 和 Assessment，不重写 OpenMAIC 运行器。

## 数据、发布与页面

规则存在既有课程目录 JSON 的 ACTIVITY 单元 `progress` 中：`kind=SUBMITTED|PUBLISHED_GRADE`、固定 `version`、`required`、整数百分比基点 `thresholdBps`、至多 8 个 `requires` 活动。无此字段的历史目录保持自由学习；无需新表、ACL或migration。LECTURE／MATERIAL不接受规则。规则作用于本教学班活动的所有正式进入路径，不只作用于目录链接。

教师在课程首页的“章节与单元 → 完成与先修规则”中开启、选择正式依据／阈值、计入必修、配置先修或清空先修；先给前置活动配置规则，再将其选择为先修。保存只改草稿，原 `PUBLISH_OUTLINE` 按revision CAS显式启用，课程发布审计保留完整规则快照。只允许原有效任教教师操作；管理员不因管理身份获得任教权限。移除／停用前置规则须先清除依赖；重复活动歧义、循环、自依赖、缺失规则、非法字段及上限在保存和发布校验。

发布规则时再次确认活动属于本教学班、仍正式发布且版本匹配；PRACTICE测验不能作为完成依据。换版不自动修改规则，当前规则显示过期并关闭新的进入；教师明确“绑定当前版本”、保存、发布后才生效，不能继承旧版本证据。删除规则或发布空规则恢复自由学习，历史记录不删除。

学生课程首页显示本人必修完成数、活动条件及阻拦的先修标题，学习中心单元页同样显示进度与阻拦原因。0必修分母不显示100%。进度是读取时的快照；目录“刷新学习进度”或单元刷新可取得新事实。服务端每次新进入重新判定，前端提示不作为授权依据。文本、原生测验和课堂入口均提供明确 `PROGRESS_BLOCKED` 提示；讲义／资源仍可浏览。

## 可信证据

只读取当前Identity主体、教学班和有效Enrollment下，自本次Enrollment.valid_from开始的当前活动固定发布版本Attempt。每活动只看该范围最新Attempt、该Attempt最新提交；成绩只看此最新提交最新不可变 `zhiban_assessment.publications`。未发布评分草稿、其他学生、旧选课窗口、旧活动版本、练习或浏览／聊天／iframe消息不作为依据。SUBMITTED只表示教师定义的课程进度条件满足，不更改冻结Learning和Assessment合同中的完成权威。

成绩用整数点数交叉相乘比较，不因百分比四舍五入放行。更正至阈值以下、重交、新Attempt、换版或Enrollment失效可使条件不再满足；不写永久完成标志，不自动发布成绩、证书、课程总评或掌握程度。`required`仅统计配置必修数，非课堂全部目录或课程学分。先修节点满足自身正式依据即可，已有历史作答的完成不追溯否定；规则只控制之后新进入。

新Attempt审计与首次课堂进入审计同时保存本次判定目录publicationNo及本人提交／成绩发布引用，不包含答案和评语；重试原命令回原receipt。规则发布审计快照可解释该次publicationNo。不将本地结果伪装为GitHub或Native Runtime证据。

## 并发与既有作答

所有Curriculum、Learning、Assessment、Quiz、Classroom命令在原Identity锁之后、业务行锁和命令锁之前取得同一tenant/offering事务 advisory barrier。嵌套Quiz／课堂调用原Learning或Assessment时重入同一事务锁。规则发布、活动发布／撤回、提交／新Attempt、评分发布／更正及课堂进入由此串行判定，不在一个动作中拼接不同发布版本的规则与证据。学生目录读取也先取同一屏障，原Enrollment／任教关系FOR SHARE仍与原管理写入协调；未改变Identity来源或增加跨人权限。屏障按教学班粗粒度串行，当前LOCAL规模下接受；高并发生产容量未签收。

START_ATTEMPT发现已有IN_PROGRESS时沿原路径恢复，不追溯检查新先修；SAVE_DRAFT／SUBMIT不检查先修。课堂首次ENTER_TASK即便能复用已有Attempt仍检查门禁，失败同事务回滚，不留下entries或Attempt。已有dispatch本人entries重入仍返回原绑定，不消费新次数。原截止、次数、发布／撤回、课堂窗口与资格仍独立有效：先修不会锁死已有作答，也不越过原停用／撤权／截止限制。

## 本地验证和证据边界

定向脚本：`node scripts/zhiban-local/verify-learning-rules.cjs`。使用默认3461 trusted HTTPS及owned PG16 socket56517、真实三角色会话与原业务命令；管理连接仅读取验证事实及持有测试advisory锁，不注入完成事实。以真实PG锁队列明确安排成绩更正在前、新Attempt在后，验证不达标拒绝和达标放行。退课／重新Enrollment使用原管理员命令，验证失权及旧窗口证据排除，历史仍可查。只验证受影响流程；不运行完整课堂、真实模型／扫描、P7重打包或GitHub CI。

证据位于 `evidence/learning-rules/`：原试用三库已作私有备份并验证归档目录，未做restore演练；本轮新owned实例记录LOCAL来源。旅程结束恢复验证前目录并结束验证课堂，测试作答／审计作为本地历史保留。最终检查及源hash见final-closeout；更早P7归档仍只代表其原source，本包未冒充包含于历史交接。

完整Native Runtime、互动可信完成／实验、PBL、课程总评／权重／申诉、跨班课程认证及生产运营仍未交付；REVIEW维度与已有维护输入门禁保持。后续按原P3集中确定课程总评／权重／申诉产品范围，真实Runtime输入可用时再做P4条件项。

最终LOCAL结果：教师浏览器配置／保存／发布、学生课程首页／学习中心、正式文字／Quiz／课堂新进入、已开始继续、成绩草稿／发布／更正、重交、旧Enrollment窗口、活动换版、规则图、练习排除及审计引用均通过。全量build类型检查及规则／目录定向单测、限定ESLint、格式和JS语法通过。当前3461源与运行实例匹配，漂移0，精确source及证据hash见[最终记录](evidence/learning-rules/final-closeout.json)。本包保留dirty候选，无提交、推送或CI。
