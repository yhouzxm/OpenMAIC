# M5 SM-01 activation 反向绑定修复

2026-10-09，branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。状态 **SM01_FIXED / LOCAL_PG16_FOCUSED_VERIFIED / DEV_UNAPPLIED**。

[状态矩阵复评](zhiban-v2-m5-state-matrix-review.md)中的 SM-01 已修复并定向验证；原缺陷复现证据保留旧 SHA 和 REVIEW_BLOCKED 结论，不改写历史结果。本结论仅解除该项 SQL 缺陷阻塞，不代表 enabled Bridge、D08 或 M5 产品闭环已完成。

## 变更

`02-helpers-and-guards.sql` 的 deferred `link_consistency` 增加资源下所有 ACTIVATE_GENERATION 的反向检查：每个 activation 必须在提交时恰好归属一个同 tenant/resource 的 PUBLISH_CONTENT，其 `bridge_operation_id` 精确匹配，且该 content operation 的 PREPARE_CONTENT 与 activation 属于相同 slot/generation。检查涵盖所有 activation 状态，不依赖 generation 已成为 ACTIVE。

既有引用不可替换、prepare 唯一归属和 FAILED 终态检查继续生效。因此不能隐藏第二个 activation，也不能通过空引用释放未决发布 fence。允许在同一事务预留、登记并激活；Content UNKNOWN 的成功恢复在终态 UPDATE 中同时登记 activation 与结果，不放宽 UNKNOWN → UNKNOWN，也不增加 reconciliation 权限。

仅更新 docs 下未应用候选 helper、inventory 生成器/产物及 receipt 模板绑定；01 schema、03 ACL、旧 migration 和 runtime repository 未变。验证脚本补充上述事务顺序及负向场景，输出新的 SM-01 证据文件，不覆盖旧 30 项或旧复评证据。

当前 logical migration SHA-256：`e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324`。

当前 inventory SHA-256：`28ecc1458d682a3a57b6ebf9bb6aaa3fd57f0dce748c9e66afe28b2216443851`。

## 本地定向验证

命令：`python3 docs/v2/candidates/m5-content/refresh-inventory.py`；`python3 docs/v2/candidates/m5-content/verify-static.py`；`pnpm exec tsx scripts/zhiban-local/verify-m5-sql.mts`。

[PG16 证据](evidence/m5-sm01-fix-local.json) **53/53 PASS**：原 30 项重新验证，加 23 项 SM-01 状态矩阵检查。

| 场景 | 实际结果 |
| --- | --- |
| 未登记 RESERVED / UNKNOWN activation，含同事务标 content FAILED | COMMIT 以 `23514 / Unbound Bridge activation` 拒绝；两种状态各验证两种取消方式 |
| 拒绝后的回滚 | 无 activation ledger 残留，slot revision 未变，content 仍 RESERVED |
| 已登记 RESERVED / UNKNOWN activation | 拒绝 content FAILED、拒绝 SAVE、拒绝替换 activation 引用 |
| 已登记 activation 从 RESERVED / UNKNOWN 结算 FAILED | 与 content FAILED/audit 同事务提交成功，随后 SAVE 成功 |
| activation 指向另一轮 prepare 的 generation | 精确反向绑定拒绝；回滚后正确 generation 仍可发布 |
| Content RESERVED → UNKNOWN → SUCCEEDED | 保留 prepare/fence，原子登记 activation、publication 和指针成功 |
| Content UNKNOWN → FAILED | prepare 未知时拒绝；prepare 精确结算失败后允许 |
| 原完整发布、缺审计回滚、Bridge-only 激活拒绝、撤回 | 全部继续通过，撤回保留 SUSPENDED/ACTIVE 历史 |

[静态证据](evidence/m5-sm01-fix-static.json) **42 项通过**，包括来源/hash、冻结 migration bytes、receipt 未签发边界。pglast 仍 NOT_RUN；SQL 实际由 PG16 fixture 执行，未将静态检查称为语法或 live ACL 签收。

## 证据边界与下一步

PG16 `160015`，Node `v22.23.3`，pnpm `10.28.0`；仅使用独立 Unix socket cluster，port 55439 / `zhiban_m5_disposable`，无 TCP listener。执行完成关闭连接、停止 cluster、删除精确临时目录；55432/55433 未连接或应用。Native provider 调用为 0，未知结果结算使用受控 fixture 事实，不证明真实 Native outcome 检查。

receipt 继续 LOCAL / UNISSUED / UNAPPLIED，live catalog/Native/TLS 未签发。真实 Session/Role/Scope/owner 与并发撤权、Native provisioning/outcome、installer/issuer/loader、M1–M4 新 profile 回归、editor/API/HTTPS/CSP 旅程仍待实现与验证。无 commit/push/CI dispatch。

下一步：实现本地 installer 与精确 receipt issuer/loader，再接入 M5-A/B enabled composition 和文本编辑、保存、发布；继续按受影响范围本地验证。建议 GPT-6.1 Sol medium 承担实现，涉及权限边界的独立复评使用 GPT-6 Astra high。
