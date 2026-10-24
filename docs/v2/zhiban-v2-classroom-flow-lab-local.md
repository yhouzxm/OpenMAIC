> 2026-10-24后续：[原生课堂复用与演示整包](zhiban-v2-native-classroom-reuse-local.md)已将普通PPT／互动／正式Quiz／PBL与旧维护链分开；课堂原生共享页、跟随及上下文返回不依赖旧链。下文旧“Native”只读作受隔离chat Runtime／真实维护目标，自动实验还缺独立执行合同；原证据与历史下一包不追改。

# P4 固定教案编排与实验报告：LOCAL 交付

2026-10-24，沿原 P1–P7 的课堂与实验包实施。复用现有 Content／Curriculum 固定发布、原生播放器、Classroom、Learning Attempt 和 Assessment；新增独立 `zhiban_flow/0001`，未修改原有已应用迁移。Git 分支仍 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；成果包含未提交候选，不能只检出 HEAD 复现。

## 可以实际使用什么

教师在课程工作区“课堂教案”配置 1–32 步的讲义、作答、互动＋作答、实验报告；引用本教学班已发布的确切内容／活动版本。保存草稿与显式发布分开，开课固定该教案版本。按顺序开始、推进、暂停／恢复、完成或取消；暂停拦截新进入，恢复沿用原派发与 Attempt。完成仅在最后一步，完成／取消同步关闭原课堂，保留已有作答、提交和成绩。运行中关闭手工派发入口，原课堂结束也会同步终止教案。

每步可要求之前的正式提交或达到阈值的已发布成绩；服务器查证真实来源并在进入审计中记录依据。不从翻页、聊天或 iframe 消息推断完成。已有进入不会因后来更正先修成绩而被锁死，原截止／重交／历史访问规则继续有效。

实验支持教师定义参数及测量字段、学生填写多行测量和结论、保存／刷新恢复、明确提交、教师原评分发布／更正、学生成绩及历史报告回看。测量来源明确为 **LEARNER_REPORTED（学生填写）**。每次正式提交固定参数、测量、结论及摘要，后续重交不改旧报告或旧成绩。成绩待评分列表直接打开完整报告；普通文字提交接口不能绕过实验结构。报告／实验记录历史分页读取。

当前任教关系和 Enrollment、租户与本人范围仍由现有 Identity／Academic 事务校验；教案转换、进入、Attempt、联合绑定及实验记录使用同一事务，CAS／幂等与撤权屏障保留。新增表 FORCE RLS；发布版本、事件和报告不可更新。

## 默认试用

`https://127.0.0.1:3461/zhiban` 正在使用本机持久化三库。原三个演示账号不变，密码仍只在 `pnpm trial:zhiban:info` 指向的私有文件中。

新增独立合成课程 **“课堂与实验演示”／“课堂与实验演示班”**，不修改原课程目录或作答。教师从课程“教案与实验”打开 **“电路观察与测量课堂”**：固定互动观察 → 实验前预测 → 电路测量实验报告 → 实验后测验。教案已发布但尚未开始，教师可直接开课。教师／学生确切 URL 见 [`evidence/flow/default-entry.json`](evidence/flow/default-entry.json)，页面见 [`default-teacher.png`](evidence/flow/default-teacher.png)。种子工具仅通过原受限 API 添加独立合成课程，核对原 15 张教学表中 26 条既有记录及账号文件逐字节保持。

`pnpm trial:zhiban` 恢复现有快照；`pnpm trial:zhiban:stop` 正常停库、保存下一代后才清理临时 root。当前增量已经显式本地升级／receipt 重新绑定，新增三库物理备份与独立 hash 闭包验证见 [`evidence/flow/closeout.json`](evidence/flow/closeout.json)。本轮不重复 P7 源码打包；此前交接归档仍只证明其当时 source。

## 验证及证据范围

- `pnpm verify:zhiban:flow`：独立 owned PG16、真实 Identity／受限数据库角色、受信 HTTPS／Native 固定内容与浏览器。实际走通教师配置发布、观察、暂停恢复、先修拒绝／放行、实验报告与正式 85/100 发布、重交和原测验／结束历史。相应负向包括竞争转换、重复进入、跨学生／非教师／RLS、伪造来源／普通提交绕过、后段 SQL 失败完整回滚、报告 ACL 漂移拒绝。见 [`zhiban-flow-local.json`](evidence/zhiban-flow-local.json)、[`zhiban-flow-journey-local.json`](evidence/zhiban-flow-journey-local.json)。
- `tests/zhiban/flow/model.test.ts`：闭合输入、字段范围、版本及规范化摘要。定向 TypeScript／ESLint 结果和源绑定范围见 closeout，不宣称全仓检查。
- 80 个既有 migration／候选 SQL 与上一交接归档一致，见 [`zhiban-flow-frozen-source-local.json`](evidence/zhiban-flow-frozen-source-local.json)。只有新 schema 追加，未改已应用 SQL。
- 全部证据标记 LOCAL／`githubActions=false`，没有 GitHub CI、提交或推送。早期失败及修正后通过日志并存于 `evidence/flow/`；默认3461只补入口／数据保持核对，不重复专项旅程。

## 尚未交付的边界

这次完成固定教学编排与**人工填写实验报告**的完整教学闭环，不是原生自动实验、完整 Native Runtime 或可信自动测量。Native CREATE／APPEND／COMPLETE 实际生产组合仍未接上；当前 runtime root 继续 DENIED。真实维护 control、独立 pgpass staging、受信 Ed25519 公钥／pin 尚缺，即使补齐输入，也仍需完成实际组合及其生命周期验证。UNKNOWN／RESERVED 等隔离不解除。

原生 DSL 的 slide／quiz／interactive／PBL 不提供独立 VirtualLab 执行合同；不能把 HTML 表单或学生自报升级成自动实验事实。本包也没有自动正式 AI 评分。Office／OCR／音视频解析服务仍未配置，只阻塞对应真实解析。

下一整包按原 P6 推进 **PBL 小组协作：固定项目、成员、协作修订、提交与教师评价**；复用原生 PBL v2，新增组员／并发授权边界建议 GPT-6.1 Sol / high。真实 Runtime 依赖部分保留集中待办。
