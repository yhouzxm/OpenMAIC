# M3 活动发布、Attempt 与文字提交

基线：`refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。2026-10-08 用户在逐页 V1 保留审计后明确要求：可设置截止时间、重交和尝试次数限制，落实数据模型、API、页面及本地验证。候选状态：`LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`，仅 LOCAL 环境，不提交/推送/CI。

## 本轮产品范围与规则

- 唯一启用类型为 `TEXT_RESPONSE`。教师手工建草稿、编辑、发布新版本、撤回；学生开始/恢复 Attempt、保存文字草稿、最终提交/按规则重交；教师查看任教范围的提交版本和时间。文件、评分、完成进度、OpenMAIC Runtime/AI/完整课堂仍在各自里程碑。
- 教师可设置截止时间，或明确留空不设；浏览器按本机时区输入/展示，API/数据库存 UTC 毫秒。服务器在资格及活动锁后读取真实时间，截止为排他边界 `now < deadline`。到期拒绝新开 Attempt、保存草稿和提交；原 Attempt 仍可恢复为只读，不重新消耗次数。过期草稿不得发布。
- 可设置允许/禁止重交。重交是同一 Attempt 中追加不可变 Submission 版本，保留全部已提交文字；不消耗新的尝试次数。不允许重交时，提交后的该 Attempt 只读，但可在尚有次数时新开 Attempt。
- 最多尝试次数为正整数 1–1000，留空明确表示不限；按 Activity + Membership 跨发布版本计数。发布新版本不重置次数。已有 `IN_PROGRESS` Attempt 必须恢复，不能重复扣次数；提交后可以新开 Attempt。只有最新 Attempt 可写，旧尝试保持只读；本轮不开放 abort/撤销提交。
- 活动发布版本不可变。编辑只改教师草稿，学生继续看已发布版本；每个 Attempt 固定其开始时的要求、截止和重交规则。发布新版本只改变后续新开 Attempt 的规则。撤回停止所有新开/保存/提交，历史不删除；重新发布须经过显式新版本发布。
- 教师须有当前有效 TEACHER scope 与该 Offering 的 TeachingAssignment；学生须有当前 STUDENT SELF grant 与 Enrollment。租户管理员无隐式作者/个人作答读取权限。当前资格撤销后，下一次读写拒绝；历史保留不是绕过当前资格的入口。
- 教师 API 隐去学生未提交的作答草稿，只读取正式 Submission 内容。浏览器以 `textContent` 呈现用户文字；不持久化 Session/CSRF/密码到浏览器存储。后台刷新遇到未保存编辑时保留输入，实际读写仍重新授权。

## 数据与入口

`zhiban_learning` 独立 schema：`activities` / `activity_versions` / `attempts` / `submissions` / `events`，另有不可变 migration ledger。Attempt 的复合 FK 绑定 tenant、Offering、Enrollment 和 Membership；Membership 的不可变 User 关系提供身份绑定，不重复复制 User 身份属性。LearningEvent 仅记录 server-accepted `ATTEMPT_STARTED` / `SUBMISSION_RECORDED`，源版本 `learning-v1`；这些不是学习正确性、Completion 或成绩证据。

新文件 `lib/zhiban/infrastructure/learning/postgres/migrations/0001_learning.sql` 追加 schema 和 academic Enrollment 复合唯一索引，不改任何已应用迁移文件。复用专用 `zhiban_academic_runtime` 连接当前 Course 与 Learning 工作流，新增 Learning schema 使用和有限表/列权限；现有 Identity roles/catalog/生产 migration 0001–0013 不变。所有业务表 FORCE RLS；版本、Submission、Event 无 UPDATE/DELETE 权限；Identity 安全锁、Offering/资格/Activity 锁及 CAS 覆盖授权与变更。跨域授权锁保持至业务提交；没有新增假资源/假 Runtime 或异步 outbox。

入口：`GET|POST /api/zhiban/learning/:tenantId/offerings/:offeringId`。复用真实 Session、Origin/CSRF、当前 Membership/Grant 与服务器关系检查；GET 返回安全活动/Attempt/Submission DTO；POST 为严格字段闭集命令：

| 命令 | 输入 |
| --- | --- |
| `CREATE_ACTIVITY` | `title`、`prompt`、`deadlineAt: number|null`、`allowResubmit: boolean`、`maxAttempts: number|null` |
| `EDIT_ACTIVITY` | 上述字段加 `id`、`revision` |
| `PUBLISH_ACTIVITY` / `WITHDRAW_ACTIVITY` | `id`、`revision` |
| `START_ATTEMPT` | 活动 `id` |
| `SAVE_DRAFT` / `SUBMIT` | Attempt `id`、`revision`、`answer` |

标题最多 120 字符、要求 2000、作答 4000；允许合法换行，不接收控制字符/畸形 UTF-16。HTTP body 最多 32768 字节。命令使用 `x-zhiban-command` 幂等键；同 actor/Offering/payload 重放返回同一结果，不追加 Submission/Event；不同内容同 key 冲突。审计只存操作及稳定引用，不记录 prompt/作答正文。

页面接在 M2 每个教学班下的“学习活动与提交”区域，展开时按需加载，提供显式刷新/失败重试，避免一次同时拉取全部教学班触及并发上限；管理员继续管理课程/名册，任教教师与学生各有实际操作。不是静态独立演示数据。

## 本地启动与证据

开发环境固定 Node 22、pnpm 10.28.0、独立 PG16 `55433/zhiban_m1_dev`。受限 disposable 测试 cluster `55432/zhiban_pg16_test` 不被修改。

```sh
pnpm setup:zhiban:m3
pnpm dev:zhiban
pnpm verify:zhiban:m3
pnpm exec tsx scripts/zhiban-local/verify-m3.ts --persistence
pnpm exec vitest run tests/zhiban/learning/model.test.ts tests/zhiban/academic/model.test.ts tests/zhiban/academic/session-authentication.test.ts
```

setup 只对本机拥有的独立开发 cluster 生效，核对 M1/M2 receipt、PG16、现有 ledger，再追加迁移；不重置、不重播或伪造课程/活动/学生作答。web startup 仅校验来源/hash、政策、ledger、实际 RLS/ACL，缺 M3 receipt 时 Learning 关闭。`learning.json`、`learning-receipt.json`、验证 receipt 和合成测试账号均在 `~/.local/share/zhiban-m1`（0700/0600），不进入 Git。验证时按正常管理员/教师/学生 API 建合成教学班，并保留该本地课程供体验。

最终本地结果：M3 真实 API/PG16/教师及学生页面 **26/26 PASS**；Learning 边界与受影响 academic/session-authentication **32/32 PASS**；M2 回归 **20/20 PASS**；HTTPS 新进程重启后精确活动/最终提交保留 **PASS**；重复 setup 只核验 ledger/ACL、不重播 **PASS**。TypeScript（8 GiB）、定向 ESLint、Prettier 与 diff-check 通过。

私有证据 `m3-verification.json` 保存 LOCAL、基线 SHA、UNCOMMITTED_CANDIDATE、Node/PG/端点、26 项场景名和精确源码 hash；`m3-persistence.json` 引用对应验证 receipt hash；`m3-final-checks.json` 汇总本轮结果与 174 个当前运行/相关测试文件的 hash，最终核对两份场景 receipt 来源均无 mismatch。图片为 `m3-teacher-activity.png` / `m3-student-activity.png`。内置浏览器正常读取真实教务工作台，无证书告警。隔离 Playwright profile 只接受本机当前证书的 SPKI；HTTPS API 使用开发 CA 正常验证；Codex 内置浏览器另行正常受信任访问，不通过安全告警绕过。证据声明 LOCAL、精确工作区源码 hash 与基线 HEAD，不把未提交候选结果当提交 SHA 或生产签收。

## 已知修复与边界

首轮发现教师 snapshot SQL 的占位参数为 2 个而绑定 3 个，导致 PG `08P01` / HTTP 503；已修复为按教师/学生查询分支匹配绑定参数，重新执行受影响场景。失败保留在本地 operation 日志，不改写为 PASS。

本轮只签收启用的通用文字路径。旧分支功能保留范围见[逐页审计](zhiban-v2-v1-page-retention-audit.md)，M4 评分/成绩发布/更正与 approved completion 尚未交付；M5/M7 的文件、Runtime、AI、完整课堂/实验仍需各自契约及 gate。没有生产部署、真实 V1 数据迁移或 GitHub CI 证据。
