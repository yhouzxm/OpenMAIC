# M6 管理员学生目录搜索与分页

2026-10-15；分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。已有 M1–M6 未提交候选保留。NO COMMIT / PUSH / CI DISPATCH。

## 可用功能

管理员工作台 → **学生目录**，按姓名包含搜索或完整成员 ID 精确查找，支持每页 10/20/50 人、上一页/下一页、无匹配空态。目录显示姓名（可为空）、成员 ID、Membership 状态与当前学生授权是否有效。

名册导入页“从已有学生生成 CSV”已改用相同分页组件，不再读取整份 AcademicSnapshot。支持跨页、跨搜索保留勾选、50 人上限、清空选择、生成 CSV，然后继续原有预览/确认/逐行审计流程。当前结果里 Membership 非 ACTIVE 或没有当前学生授权的行不可勾选；已经选择但后来撤权的学生仍须在导入预览/提交中被重新核验，目录不授入班权限。

- “当前学生”：本空间 ACTIVE Membership 且有当前有效、未撤销的 STUDENT/SELF grant。
- “包含历史学生”：本空间历史上具有 STUDENT/SELF grant 的 Membership，包含停用、已离开、授权撤销/过期/未生效的成员；不把仅教师或仅管理员列成学生。
- 不读取、推断或返回 User 登录状态、密码、凭据、私有 grant 标识。当前目录状态不等于学生可以登录或入班；精确 User/Membership/角色资格由既有导入屏障验证。
- 无档案姓名的学生仍出现在普通列表，并可用完整成员 ID 查找。姓名搜索自然不包含没有姓名的档案。
- 列表是实时目录，不是跨页冻结快照；不返回虚构总数。新增、撤权或姓名变化后可以重新搜索刷新。

## API 与分页边界

GET `/api/zhiban/directory/:tenant`：`q`（至多 120 字符）、`state=CURRENT|ALL`、`limit=10|20|50`、`cursor`。默认空关键词、CURRENT、20 人。禁止写方法、未知或重复 query 字段。姓名包含按参数绑定的 `strpos(lower(...),lower(q))` 查询，`%`、`_` 和 SQL 样式文本都是普通文本；完整 ID 可规范为小写。

所有列表按固定 Membership UUID 升序，使用严格大于上页位置的 keyset，不使用 offset。游标绑定 tenant、当前管理员 Membership、关键词、范围和页大小；条件变化需回第一页。Base64url + 查询指纹只是规范的继续位置，**不是签名、权限票据或名单完整性证明**；每页始终经真实 Session/当前管理员授权。游标既不授予额外权限，也不保证跨页数据不变。

继续复用 AcademicStore 的当前管理员身份与 grant 锁，不增加 related participant 数。读取使用两个原有受限连接：

1. 空关键词/完整 ID 先从 tenant-scoped Identity Membership/RoleGrant 查询最多 limit+1 行，再向 Academic 查询这一页的姓名。
2. 姓名搜索先查本 tenant 最多 201 个匹配档案位置，用前 200 个 ID 经 Identity 筛选学生，最多返回 limit 行与继续位置。

不跨连接增加表访问权限、不扩大角色、不引入 migration/helper/ACL/receipt。姓名搜索若本次候选大多是非学生，可能返回空页但仍有下一页；页面明确允许继续，不能将它误报成整份目录无匹配。姓名继续位置可能是已扫描的非学生档案位置，不能根据游标把某成员认定为学生。两域查询属于实时、可变化的目录投影，不宣称共享同一 MVCC snapshot；它不参与写入授权。

普通页与完整 ID 查询不受旧 500 项 AcademicSnapshot 限制。旧教务快照超限时，工作台通过独立的目录授权请求保留管理员入口；其他旧教务列表的 500 项上限本轮不扩写。名册导入的 metadata、选择器、预览与写入全部避开整租户快照，所以目录大于 500 时仍可使用。

网关原 percent/query 限制只为新增的只读目录搜索 query 开放编码，保证中文/字面百分号可用；路径的 percent、反斜线、重复斜线、父目录限制保留，其他旧接口的 query percent 限制不变。相同纯函数同时用于常规 launcher 与独立验证 host。

## 本地使用与证据

```bash
pnpm verify:zhiban:m6:directory
pnpm verify:zhiban:m6:directory --serve
```

独立 PG16 56504 / `zhiban_m6_directory_disposable`，owner-only mkdtemp/Unix socket，无 TCP 监听且 host auth reject；HTTPS `https://127.0.0.1:3448/zhiban`。使用现有受信开发证书并核验 receipt/CA hash，浏览器不绕过证书检查。合成身份通过原仓库/领域实体创建；不接真实学生数据。

演示的管理员账户仅写在本次私有 accounts.json（0600）。地址、目录与导入入口、实际状态、逐源文件/执行产物 hash 和验证项见[演示记录](evidence/m6-student-directory-demo-local.json)。演示为 RUNNING_DISPOSABLE，不冒充已停止/移除；待机阶段 SIGTERM/Ctrl-C 正常结束后只清理本次 owned PG 根，并将最终生命周期写入 `m6-student-directory-demo-close-local.json`。实际运行非 serve 验证后才生成独立停机的 `m6-student-directory-local.json`。运行产物 `.zhiban-directory-run-*` 不属于 checkpoint 候选。

本地验证使用 620 名具名普通学生、空姓名/字面百分号/多授权历史/失效成员等额外场景及 201 个姓名匹配的非学生档案，验证超出 500 的实际分页、姓名跨页、稀疏空页继续、精确 ID/字面搜索、当前/历史筛选、租户/角色与游标绑定、旧快照超限后的目录/入班、真实浏览器翻页/选择/50 人上限、390px、管理员撤权与 logout 清屏。

真实 PG16/HTTPS **15/15 PASS**，相关单元回归 **55/55 PASS**，新增和受影响入口的定向 TypeScript/ESLint 通过；不宣称全仓 build、负载容量或 CI signoff。

[内置浏览器截图](evidence/m6-student-directory-iab-local.png) 已实际验证受信 HTTPS 正常管理员登录、中文姓名搜索、每页 10 人和第二页；[目录浏览器截图](evidence/m6-student-directory-local.png)、[分页选择并入班截图](evidence/m6-student-directory-roster-local.png) 记录隔离浏览器旅程。

本轮不连接或改变 55432/55433，不启动真实旧 launcher，不操作 Native、维护 control/HBA/凭据 staging 或“保留待补”隔离。此前教师、学生概览、名册导入及 PNG 证据保持各自原 hash 和范围；本轮共享 store/launcher/导入 UI 的新候选不回填旧证据。

## 下一步

建议下一产品包为 **教务工作台的大名单分页（教学班与 Enrollment）**，逐步去掉其他整表快照的上限，避免大目录时课程/教学班管理仍不可用。导入历史与跨重启查证仍保留后续待办。建议模型 GPT-6.1 Sol / medium。
