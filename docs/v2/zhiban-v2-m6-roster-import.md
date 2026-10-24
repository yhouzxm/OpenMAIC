# M6 管理员受控名册批量导入

2026-10-15；分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。本轮交付教学班学生名册导入的最小完整闭环，已有候选保留。NO COMMIT / PUSH / CI DISPATCH。

## 管理员使用路径

管理员工作台 → 教学班 → **批量导入学生名册**。

1. 从已有学生列表生成 CSV，或选择 UTF-8 CSV 文件、粘贴 CSV 文本；可下载空模板。
2. 预览：显示物理行号、成员 ID、服务器查询的姓名、可新增/已在班/需处理及具体原因。此阶段没有 Enrollment、命令或业务审计写入。
3. 全部错误处理完、容量足够且至少一名可新增学生时，管理员点击“确认导入 N 名学生”。
4. 查看逐行结果：已导入、已跳过、未成功、结果待核验、尚未执行。编辑输入会废弃旧预览；文件异步读取不会替换正在提交的 CSV。

CSV 严格只接受 **membershipId** 一列，最多 50 行、8 KiB，允许 UTF-8 BOM、CRLF 和单字段引号。成员必须已经属于本空间，User/Membership ACTIVE，且有当前有效 STUDENT/SELF grant。姓名由现有目录查询，不从文件覆盖。角色、权限、密码、账户创建、转班和删除均不属于这个导入器。

已在班者不重复占位或写审计；曾退班者标记“请在工作台单独恢复”，不借批量导入恢复已撤销关系。错误 ID、重复 ID、非学生、外租户或不存在成员都阻止本次确认。空模板不能提交。

## 提交、授权与并发

冻结的 Bridge 身份屏障仍最多两名 related participants，不增加 bulk helper、不修改冻结 Identity/Bridge 或已应用 migrations。每行使用原 AcademicStore + ENROLL 的事务、User/Membership/actor grant 屏障、目标资格、教学班/课程锁、席位校验、CAS、命令键和不可变审计。

**整批不原子，逐行原子**：每行成功即提交；首个失败后停止后续行，之前成功行保留。不同批次/普通管理操作竞争时仍按原 Offering 锁和当前容量检查，不能超额入班。Offering revision 与预览不一致拒绝剩余新写入，不自动接受改名、容量或状态变化。

本轮额外锁定目标当前 STUDENT/SELF grant（在既有 Identity runtime 受限连接上 FOR SHARE，无新 ACL），持锁至业务提交完成；有限期限的目标 grant 在提交前检查过期。User/Membership 继续由现有 related 身份屏障锁定。目标 grant 过期时业务、command、audit 一起回滚。旧单人命令的语义没有扩写。

每行重新授权；进程内预览 token 不替代管理员权限、CSRF 或目标资格。HTTP GET 仅查看目标教学班元数据；POST PREVIEW/COMMIT 均检查 Origin、CSRF、精确字段，拒绝 query 和其他方法。进程内最多 64 个预览、有效期 5 分钟，绑定精确 tenant、管理员 Membership 和 Offering。token 不持久化、不签发部署/生产权限。每次提交最多处理约 8 秒的行，预算耗尽或请求断开后不启动新行；已经开始的一行仍可能提交，须核验原批次结果。

## 部分失败与提交结果未知

批次编号是服务器随机 ID，每个新行的命令键固定为 `roster_<batchId>_<物理行号>`。不可变 command/audit 与真实入班事务一起提交，可按批次编号关联查证；成功跳过不伪造新 ENROLL 事件。

数据库已提交但响应丢失时保留 **UNKNOWN**。在同一进程和有效期内使用原 token 核验/继续，先通过当前权限，再用同一原始 command key 和规范 payload 查证已有命令，不创建第二条入班或审计。UNKNOWN 的后续核验被拒绝或失败时仍是 UNKNOWN，不能误报成未导入。

这不是持久整批账本：进程重启或 token 过期后不能恢复内存批次，必须先查看当前名单与原批次关联审计，再重新预览。已有 ACTIVE 行会跳过，WITHDRAWN 行始终阻止自动恢复；不声称支持跨重启自动重放。页面在超时后保留原批次核验入口，不自动生成新批次。

## 本地证据与启动

```bash
pnpm verify:zhiban:m6:roster
pnpm verify:zhiban:m6:roster --serve
```

独立 PG16 56503 / `zhiban_m6_roster_disposable`，owner-only 临时根、Unix socket、无 TCP 监听且 host auth reject。HTTPS `https://127.0.0.1:3447/zhiban` 使用现有受信开发证书并核验 CA/receipt hash；不绕过浏览器证书检查。独立合成管理员/学生、课程/教学班及真实 Identity/Academic API，不使用模拟导入 API。

演示账户和示例 CSV 仅在本次私有 accounts.json / sample-roster.csv（0600）；路径在启动输出与[演示 metadata](evidence/m6-roster-import-demo-local.json)。运行状态、精确代码/执行产物 hash、逐项结果见 metadata.validation/sourceHashes。待机阶段 SIGTERM/Ctrl-C 后仅停止并移除本次 owned PG 根；结束状态记入 `m6-roster-import-demo-close-local.json`。运行产物 `.zhiban-roster-run-*` 不属于 checkpoint 候选。

独立停机模式只有实际运行后才生成 `m6-roster-import-local.json`。演示 RUNNING_DISPOSABLE 不冒充已清理；本轮确实验证过先前一次相同独立生命周期正常停止/清理，保留其旧 source hash，不把它回填为后来 UNKNOWN 核验保护的证据。

真实 PG16/HTTPS 参考候选 **14/14 PASS**，实际覆盖：预览无写入、重复/非法/退班/不合格/外租户、正常入班及逐行审计、重复请求、token 主体/班级绑定、CSRF/Origin/字段伪造、过期/重启、部分提交、丢 COMMIT 响应与核验失败、容量竞争、目标 grant 撤销/到期、请求断开、真实浏览器入口/编辑失效/错误禁用/确认及结果、小屏与 logout。

最终仅补显示层的结果姓名与独立人数刷新，未修改后端。原 14 项 metadata 的 hash 保持原范围；[内置浏览器增量证据](evidence/m6-roster-import-ui-close-local.json) 绑定唯一变化的 JS、原参考证据摘要和[完整截图](evidence/m6-roster-import-iab-local.png)，实测 CSV 文件选择及两人入班，再从目录生成“新增 + 已在班”名单，完成后显示姓名、跳过结果和服务端实际 3/20 人数；人数刷新失败不覆盖已经确认的入班结果。未对刷新失败另做故障注入，不宣称重跑完整 14 项。

相关单元回归 **51/51**，定向 TypeScript/ESLint 通过。不宣称全仓 build、生产迁移或 CI signoff。普通 launcher 的新增入口与 API 只有现有 Academic loader 验收后可用；实际运行证明来自独立 host，未运行现有 55433 launcher。

不连接或改变 55432/55433，不操作 Native、维护 control/HBA/认证 staging，不改变“保留待补”和隔离状态。无新 migration/helper/ACL/数据库 receipt；此前教师/学生/PNG 证据各保留原 source 范围，本轮改动共享 store/launcher 不回填旧 hash。

## 下一步

建议下一产品包为 **管理员学生目录的搜索与分页**，让实际名册查找和导入 ID 获取更方便；不附带账户或角色批量开通。建议模型 GPT-6.1 Sol / medium。
