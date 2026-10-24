# P3 填空题编辑、判分与成绩闭环

2026-10-23。沿原 P1–P7 的 P3，承接[测验复用包](zhiban-v2-quiz-reuse-local.md)。分支 refactor/zhiban-v2，基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留 dirty 候选。本包为智伴差额，不冒称原生 OpenMAIC 已支持填空题。

## 已确认并实现的规则

每题1–10空，按顺序对应输入；每空独立正分值（最多两位小数）及1–20个可接受答案，单个答案／输入最多200字。草稿可暂缺答案，发布必须有非空答案；去掉首尾空白后重复的答案被拒绝。题目总分等于各空分值之和，单卷仍不超过100题／1000分及原快照容量限制。

仅用 JavaScript trim 去掉首尾空白后精确匹配，区分大小写，不进行 Unicode／全半角／数字／标点归一化、模糊、正则、数值容差或 AI 匹配。空白输入始终零分。各空全对得该空全分，否则零分；用整数分百分位相加，不进行浮点比例分摊。

正式成绩仍由教师确认、显式发布和更正。教师更正客观得分时须提供该题覆盖原因和公开更正理由，仍沿原更正管线，不反改旧发布答案或旧自动判分。

## 页面与复用

教师测验编辑增加“添加填空题”、题干、每空提示／分值／逐行可接受答案、增删空位、解析和删除题目。总分自动汇总；已有题目／整卷复制支持填空题，深复制答案与空位并生成新题ID。原生三型编辑、呈现、判分继续复用，公开包与既有扩展文件 hash 不变；新增 `quiz-fill.tsx` 为本地受控宿主差额。

学生按空位顺序输入，沿原草稿保存、未保存保护、固定 Attempt 提交及历史回看；提交确认将有空白未填项的填空题计入未答题。客户端不作正式判分。教师显示自动客观分，可按原流程确认发布；学生发布前无正式成绩，封卷／练习的答案与解析开放策略沿原规则。

## 数据、算法、授权与版本

原 Quiz JSON 合同增加 `type: fill_blank` 与 blanks（label、points、accepted），答案按 questionId 对应定长字符串数组。拒绝未知题号、长度错误、非字符串、超长值、额外 content／score 等伪造字段；非填空题不接受 blanks。公开投影只含题干、分值、空位提示及每空分值，绝不含 accepted／analysis／commentPrompt。

新本地算法标识 `zhiban-quiz-fill-1` 用于含填空题的整卷；纯原生题型仍用 `zhiban-quiz-1`。填空计分由本地纯函数补充，原生题仍调用原 DSL。服务端发布快照保存算法，提交保存同一版本算法、quiz hash、answers hash 与结果；读取核对算法与内容种类。source_pin 仍表示原生基础能力来源 pin，新填空算法另以本包 source hash 和独立算法标识记录，不能把该 pin 解释为上游填空实现证明。

新增 `0003_fill_blank.sql` 只扩展 quiz_versions／quiz_evaluations 的算法 CHECK 允许值，不改旧迁移、数据、ACL、RLS 或不可变屏障。仅在本轮 fresh owned disposable PG16 安装；未向55432／55433或生产安装。历史卷／Attempt 不重标算法、不回算。换版后，已有 Attempt 始终用旧版本空位／答案／分值判分；草稿并发仍走原 revision CAS。原 Identity、任教、Enrollment、progress barrier、命令幂等及评分发布授权保持。

本地 M3 setup／receipt loader 已增加新迁移 source hash 和精确三版 ledger 绑定；旧两版环境拒绝作为本版本启动，未提供自动升级旧实例或重签旧 receipt。本轮实际产品启动与旅程使用统一 fresh installer；独立 M3 安装命令未另跑产品旅程。

## 预期 profile 与本地证明

首次安装因旧固定 profile 不匹配而拒绝。随后使用既有 `run-m5-png.ts --joint-classroom-reference-only` 在独立新PG16重建预期目录。这里只构建参考，不运行 PNG、扫描、完整课堂或模型旅程；不能当作这些模块重签验收。

前后 enabledProfile 差额仅为 zhiban_learning 指纹；共享角色／ACL extra 完全相同，所有原已应用 migration 字节一致。旧 joint reference／build 文件保存在本包 `prior-*` 文件中，新固定参考用于新 schema；旧 P7 与各模块证据继续保留原范围。

`node scripts/zhiban-local/verify-quiz-fill.cjs` 已通过真实HTTPS3461／PG16旅程：编辑两空（1.25＋2分）、答案变体、保存发布、学生草稿刷新继续、固定旧版提交得1.25/3.25、教师发布、更正至3.25/3.25及学生封卷回看。教师在 Attempt 开始后把016补入新版本，旧 Attempt 仍只认16；封卷后学生看到旧版本答案键。两个教师会话并发修改只成功一个。

负向覆盖空位长度、非文本／超长、额外 score、给自动题注入人工评分、无理由覆盖、学生／管理员改卷、发布前答案隔离。合同单测覆盖大小写、首尾空白、多答案、位置、空输入、部分得分、总分和无效答案。原判断题／复制包浏览器旅程亦在本轮宿主下通过，独立保存为 legacy-reuse-journey；旧包 journey 文件保持原件。

定向类型、ESLint、格式及来源绑定通过。一次类型检查与包重建并发时读到临时缺失 dist，待包构建完成后通过；不作为源码成功／失败结论。

默认[3461](https://127.0.0.1:3461/zhiban)已刷新，合成试用数据重新初始化，当前账号见 `pnpm trial:zhiban:info`。旧三库逻辑备份及私有输入位于本机 `~/.local/share/zhiban-backups/before-fill-blank-20261023-214904/`，未演练恢复。当前本地证据见[旅程](evidence/quiz-fill/journey.json)和[来源记录](evidence/quiz-fill/final-closeout.json)。没有Git提交、推送、CI或P7重新打包。

## 剩余范围与下一包

不包含数值容差、正则、AI填空判分、每空人工覆盖、自动改判旧成绩、题库随机抽卷或原生AI采用填空题。教师仍可按整题公开原因更正得分。

下一完整产品包建议为匹配题编辑、作答、判分与成绩闭环；先明确配对和计分口径，再复用原正式评分管线。建议 GPT-6.1 Sol / high，涉及正式答案与评分合同；普通页面接线用 medium。
