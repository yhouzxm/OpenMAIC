# 课程学习与测验：本地产品包

2026-10-18，原 P2＋P3；当前为未提交 LOCAL 候选。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，必须连同 dirty 源码及本轮 receipt 使用，不能仅以 HEAD 复现。最终交付实例以 receipt 的 `sourceMatches`、checks 和运行状态为准。

## 已交付的完整流程

- 教师从原课程“课堂与互动”新建测验，采用新版题卡、题型编辑、选项排序和撤销／重做；支持单选、多选、简答。设置截止、重交和次数，保存、预览、发布，并通过原章节返回入口加入目录。
- 学生在原学习中心学习文本／PNG并进入测验，恢复固定版本作答，保存、提交、查看个人尝试及提交历史。取消离开保留输入；确认放弃只提示一次，重新进入恢复最后确认保存的答案。
- 服务端在同一事务写入 Submission、结构化答案及选择题精确判分；浏览器不提供正式分数。简答由教师评分，全客观题也由教师确认后发布。
- 教师原待评分页增加课程测验／文字作业筛选及“待简答评分”，使用原 Grade 发布和带公开理由的更正，保留每个精确 Submission 的分项快照。
- 正式成绩可先发布，正确答案／解析须在教师不可逆封卷后才向本人已发布成绩的提交释放。练习提交后可看反馈，不进入正式待评分列表、成绩簿或成绩统计。

默认入口仍为 **https://127.0.0.1:3461/zhiban**。启动／状态／停止使用 `pnpm trial:zhiban`、`pnpm trial:zhiban:info`、`pnpm trial:zhiban:stop`。演示账号文件位置由 info 返回；每次重建生成新的合成数据与账号文件。未连接真实 55432／55433。

## 新版复用和扩展身份

官方基础仍固定 OpenMAIC 1.2.0 / `a9da60b3b4adb429369c0da13d5637a904ead2b0`。复用实际新版 QuizView 呈现、QuizForm／QuestionCard 与纯编辑操作、选择题算法、公式处理；原生页面与智伴使用同一抽取实现，没有另建播放器。

新增受支持公开面：

| 入口 | 职责 |
| --- | --- |
| `@openmaic/dsl/quiz` | 题型、公开投影、规范化／结构提示和纯选择题算法 |
| `@openmaic/renderer/quiz` | 无网络、无原生 store 的受控答题／回看组件；可选语音槽由原生宿主注入，智伴不启用 |
| `@openmaic/renderer/quiz/math` | 无 React 客户端标记的纯公式 helper，保留服务端 HTML／视频导出调用 |
| `@openmaic/editor/quiz` | 受控题卡、排序、撤销／重做和纯编辑操作 |

扩展独立标识为各包 `zhibanExtensions.quiz = 0.1.0`，与 `zhiban-quiz-1` 判分／规范化合同配对。核心 provider 版本号保留原值，不把纯 UI 扩展伪装为新官方发行或借机放宽冻结 deployment tuple。相对集中设计的调整是以独立扩展版本＋源码／dist hash 标识局部版本，不改原生 provider 合同版本；三个包已不再是官方逐字节原样包。

[局部源码 pin](evidence/zhiban-quiz-extension-source-local.json)列出精确允许差异；启动仍校验其余上游源码和新增文件。SDK 构建 receipt 只证明包构建，不替代数据库或产品旅程证据。Quiz 工具样式从共享源码编译并限定在 `.quiz-product`；公式复用本地 KaTeX 样式，沿既有边界使用系统字体回退，不加载远端字体或放宽 CSP。

## 数据与权限边界

新增两个 successor migration，**只在 owned disposable PG16 应用**：

- Learning `0002_quiz.sql`：扩展 Activity 类型，增加定义／发布版本、Attempt 答案、Submission 答案和客观评价；复合 FK 绑定精确版本与 hash，封卷不可撤销。
- Assessment `0002_quiz_details.sql`：Grade revision 分项和 publication 分项。分项归 Assessment schema，避免 Learning 安装依赖尚未创建的评分表；对应集中设计中侧表的领域归属细化。

沿用 Activity→Attempt→Submission→Grade/publication，原文字命令拒绝对 QUIZ 写入；普通 SAVE_GRADE／CORRECT_GRADE 拒绝跳过测验分项。父 Submission 文字字段只存固定摘要，结构化答案单独保存。原历史 migration 字节未改。

每次操作仍检查真实 Session、Tenant、Membership、当前任教／Enrollment 和业务状态；管理员身份不能直接代任教或代答。沿用父资源锁、CAS 和命令幂等账本；超时不换命令号，未知结果期间锁住编辑。冲突可明确读取服务器版本并保留本地输入，比较后再操作。

文本／PNG Native profile 没有加入 Quiz 写权限。新业务表改变组合 catalog，因此独立生成 [组合参考](evidence/m5-png-profile-reference-quiz-local.json)；[参考构建证明](evidence/zhiban-quiz-profile-build-local.json)仅证明 fresh PG16 catalog 与 Native schema 构建，未冒称重跑整套 PNG 故障测试。旧 OpenMAIC 1.2 PNG 参考及旧 CI／LOCAL 证据保留原范围。

## 本地验证及适用范围

- 三个受影响 SDK 构建与实际 dist 消费；相关 Native 编辑／判分接口类型检查。
- 7 个定向测试文件，80 项通过：新业务校验、公开题目投影、选择题算法、原纯编辑／公式、分页及学习中心路由。
- 原统一教学旅程保留：文本／PNG、课堂派发、扫描附件、人工 92/100、学生反馈、CSV、越权拒绝及既有窄屏检查。
- 新测验旅程：教师发布 v2，已有 Attempt 固定 v1；学生保存／取消离开／确认放弃／干净刷新恢复／提交；教师发布 9/10，更正为 9.5/10，学生查看封卷后的历史成绩和答案。
- 负向：草稿与 key 不泄露；别角色／课程拒绝；并发开始只恢复同一 Attempt；文字／旧评分命令不能越过类型屏障；练习不能进入正式评分；封卷和次数限制拒绝后续写入；真实 Enrollment 撤回后提交拒绝。
- 故障切点：在父 Submission 插入后、评价写入前注入失败，确认无半提交；撤掉故障后按同命令号重试／重放只产生一个提交，换 payload 拒绝。

最终记录见 [产品包 receipt](evidence/zhiban-course-quiz-local.json)。所有证据为 LOCAL、`githubActions=false`；没有 commit／push／CI dispatch。TypeScript 为受影响依赖闭包检查，本轮不冒称重跑全仓 Next 生产构建或完整 Identity PG／PNG CI。

## 保留的限制和下一顺序

本包不启用原生 Runtime、Interactive／PBL、AI 简答评分、课程总评／学分、强制先修／完成或新增题型；读取和提交不等于课程完成。截止／次数沿原规则，不新增作废 Attempt 或重置计次。脏页原生刷新／关闭的人工签收仍按此前用户决定 deferred；本轮证明的是 SPA 离开和干净刷新恢复。

原 P1–P7 继续；下一步在默认入口按真实课堂试用，处理具体使用阻碍，再推进 P3 课程讨论与原生聊天的实际差额。无需重复 GitHub 验证。
