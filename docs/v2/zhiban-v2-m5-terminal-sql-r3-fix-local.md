# M5 终态候选 TSQL-01–03 修复与本地定向证据

日期：2026-10-12。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；工作区仍有既有未提交修改。状态：`R3_CANDIDATE_REVIEWED / 1_P3_TEST_EVIDENCE / KEEP_ALL_FENCES`。候选在现有开发数据库仍 UNAPPLIED，receipt UNISSUED；本轮只在独立临时 PG16 cluster 编译和验证，没有访问 55432/55433、现有凭据或启动 host。

## 修复对应关系

| 问题 | 候选改动 | 定向验证 |
| --- | --- | --- |
| TSQL-01 接管 ACK 查证 | controller-only read_takeover_result 精确 deployment/old/new/request/backend capability；service→epoch→window→claims 锁序，返回历史交接与当前占用；无表 SELECT/写入重放。恢复计划在条件写入前后查证 | NOT_OBSERVED 不赋予重放；真实接管提交；同接管重试拒绝；新 backend 查证；successor 再被接管后历史结果仍可查；错 deployment/window/request/new/secret 和 runtime 调用拒绝 |
| TSQL-02 live 权限覆盖 | 09 Business collector 新增双库 ACL/owner、有效 CONNECT/CREATE/TEMP 矩阵、observer pg_control_system/subscription 表列权限；10 Native collector 采 public schema/全部关系列 ACL/defaults 和有效表列权限；verify-profile.py 封闭两部组合与精确预期比对 | Native 整表 UPDATE、PUBLIC 表/列 UPDATE、撤销必要 UPDATE(id)、observer 整表 SELECT/显式函数 ACL 漂移、跨库 CONNECT/PUBLIC CREATE 和缺失 collector 均拒绝 |
| TSQL-03 lookup 生命周期审计 | issue/revoke 与许可同事务写 LOOKUP_ISSUED/LOOKUP_REVOKED；绑定作用域、身份、DB 时间、provenance；revoke 新签名 (uuid,uuid,text,text)，第三参数 provenance，第四 controller secret；重复撤销 no-op | 事件精确绑定、无 secret；无效签发 provenance 拒绝且无许可残留；撤销审计错误时回滚；撤销因结果读取 FOR SHARE 锁超时（55P03），释放后成功；重复撤销仅一条事件；事件 UPDATE 拒绝；撤销后/错 tenant 查询拒绝 |

实际测试另发现新 v7 domain 的 CHECK 拒绝初始窗口合法 NULL takeover_request_id，已在未应用 01-schema.sql 修正为 `VALUE IS NULL OR is_uuid_v7(VALUE)`。必填列仍有 NOT NULL；NULL domain 可用、非 v7 拒绝、必填 window_id NULL 以 23502 拒绝。原 applied domain/migrations 字节未变。

PG16 实际 catalog 中 subscription 的非敏感列有既有 PUBLIC SELECT，pg_control_system() proacl 也有既有 PUBLIC EXECUTE。collector 如实采集，精确 expected/actual 比较绑定这些事实；不修改系统默认 ACL，不声称 observer 仅有三个有效列读权。敏感 subconninfo/整表权限继续拒绝，新增的显式授权另行绑定。

## Hash 和 receipt 边界

- Business 0002 候选 aggregate：`e1e7ea9517462edd855fb8715f49346db4c467c01aac43e8a370c39eebf7184a`。
- inventory SHA256：`855ac6019326fdd4a56c4a231fa64364dff3f0b5cee85748a2b9952cb6ac8e5d`。
- 两份 UNISSUED receipt 模板已派生更新；安装模板新增 combinedTerminalProfile/reviewedExpectedProfileSource 待绑定项，仍为空。现有技术安装 receipt、当前 implementation binding 与旧 content 0001 aggregate 未重签/更改。

未来 installer 必须使用另行评审、来源绑定的 expected profile；不能在签发时把 actual 复制为 expected。当前 verify-profile.py 只比较候选快照，不证明 expected 来源可信，也不是安装 receipt issuer/loader。测试中的 baseline 是独立临时 fixture，只用于确认 collector 能观察并拒绝具体漂移。

## 验证及适用范围

[静态 R3 证据](evidence/m5-terminal-candidate-r3-static-local.json)：**12 组 STATIC_PASS**；pglast v6.16 / PG16.1 grammar，116 条 SQL、34 个 PL/pgSQL 函数解析通过。候选、prerequisite 原字节、聚合、receipt 模板、helper/ACL 签名、恢复顺序与局部边界通过。

[独立 PG16 定向证据](evidence/m5-terminal-sql-r3-directed-local.json)：**26/26 PASS**。验证器 [verify-local-pg16.cjs](candidates/m5-terminal/verify-local-pg16.cjs) 使用唯一 0700 临时目录、Unix socket、listen_addresses=''、host authentication reject；编译既有 Business migrations、Content 0001 和本批候选。完成后停止并删除自己创建的 cluster，未连接或调整现有 cluster。

Business 对象只为 lookup scope 构造 synthetic fixture，管理员 replica 初始化绕过无关产品 FK/trigger 建链；Native 是最小五表 ACL fixture。实际候选 helper、RLS/权限拒绝、控制事件、SQL 锁等待、接管与 collector 在 PG16 执行，但这不证明完整产品数据来源、Native 公共 Storage worker、full finalize 或真实维护执行器已验收。新 backend 查证模拟 ACK 丢失后的数据库查证，不冒充真实网络 COMMIT 丢包/进程崩溃故障注入。

完整终态结算、真实 proof worker、HBA/凭据轮换/耐久 journal/启动阻断、完整 crash driver、新 live installer/issuer/loader 和受影响 host 回归仍待完成。原 9 组静态证据及旧 LOCAL/CI 证据保留原 hash 和范围，不能扩展为新 terminal 或 enabled gate signoff。无 commit/push/CI dispatch。

下一步对 R3 的查证锁序、collector/expected 信任来源和 lookup 审计做定向复评，通过后实现实际维护执行器与 receipt loader；不要直接在现有开发库应用候选或执行终态。建议复评使用 GPT-6 Astra / high，后续实现使用 GPT-6.1 Sol / high。

2026-10-12 [R3 定向复评](zhiban-v2-m5-terminal-r3-review.md)：原三项 P2 关闭，无新增 P1/P2；R3-01/P3 指出签发 NULL provenance 用例并未触发审计 INSERT，已收窄本报告表述。允许继续实现，不等于安装或终态启用批准。
