# M5 跨表状态矩阵定向复评

2026-10-09；branch `refactor/zhiban-v2`；HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。工作区包含既有未提交业务实现，不是 CLEAN。本轮不改候选 SQL、冻结 migration、业务实现或原 30 项证据。

结论：**REVIEW_BLOCKED，1 项 P1（SM-01）**。F1/F3/F4 在本轮定向范围内未发现新问题；F2 的已登记引用检查有效，但 activation 反向绑定仍不完整，不能把此前四项修复解释为整个状态矩阵已通过。

后续：[SM-01 修复与本地验证](zhiban-v2-m5-sm01-fix-local.md)已完成，更新候选 hash，PG16 53/53 PASS。本文及其证据保留修复前快照；当前该项状态为 SM01_FIXED / DEV_UNAPPLIED。

候选 migration SHA-256：`17150c198cb72c7cfd23ddea4bd22e162fe6677ade9b5de84fab255991241e1d`。
inventory SHA-256：`de54a4f88779c06d9e4e5a8bd9c67babf63fcd72efae4eb61ec9d4541bbc0256`。

## SM-01 / P1：未登记的 activation 可以绕过未决发布 fence

位置：[02-helpers-and-guards.sql](candidates/m5-content/02-helpers-and-guards.sql:238) 与 [FAILED 状态检查](candidates/m5-content/02-helpers-and-guards.sql:288)。反向关联只遍历 `PREPARE_CONTENT`；FAILED 检查只检查 `co.bridge_operation_id` 指向的 activation。generation 尚为 PENDING 时，ACTIVE generation 的反向检查也不会触发。

在真实 Bridge runtime 连接、原 RLS/trigger 全部启用的临时 PG16 中，两个变体均已成功 COMMIT：

1. 建立合法 content reservation，登记 prepare，令 prepare SUCCEEDED。
2. 使用 shipped BridgeRepository 为相同 slot/generation 创建 ACTIVATE_GENERATION，但不登记 content 的 `bridge_operation_id`；分别保持 RESERVED，或记为 OUTCOME_UNKNOWN。
3. 将 content operation 标为 FAILED 并写匹配 audit，COMMIT 成功。
4. SAVE_CONTENT 将资源从 revision 1 改为 2，COMMIT 成功；该 activation 仍为原未决状态。

这使“存在未决发布结果时保持草稿 fence”的约束失效，并遗留与已失败 content 操作脱节的 activation。本次没有证明学生可读取未发布内容；ACTIVE 指针与完整 publication 的提交检查仍在。

最小修复方向：为内容资源的 ACTIVATE_GENERATION 增加从 Bridge 到 content PUBLISH 的反向唯一归属，要求对应 prepare/slot/generation 一致，并维持终态不可替换引用。取消时验证所有关联 activation 均已安全终结，不能只检查一个可空字段。允许在同一事务完成 reservation、登记与原子激活；不修改冻结 Bridge migration 或放宽 UNKNOWN 的重新授权要求。

修复后的定向验收：未登记 RESERVED/UNKNOWN activation 在 COMMIT 拒绝并回滚；已登记 RESERVED/UNKNOWN activation 阻止 content FAILED；已登记 FAILED activation 的安全终结可行；既有完整发布、撤回与 UNKNOWN 原子结算保持可行。评审确认该项修复后再进入 installer/composition。

## 状态矩阵与证据

以下 R/U/S/F 分别指 RESERVED / OUTCOME_UNKNOWN / SUCCEEDED / FAILED；“无”指没有相应 operation，区别于“有 operation 但没有 content 引用”。

| Content publish / 动作 | Bridge prepare | Bridge activation | 期望及实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| R，尝试标 F | R，已 dispatch | 无 | 拒绝，保持 fence | 原用例重跑 |
| R，尝试标 F | U | 无 | 拒绝，保持 fence | 原用例重跑 |
| R → F | U → F，同事务 | 无 | 允许；随后 SAVE 可提交 | 原用例重跑 |
| R → F | S | 无 | 允许安全取消 | 原用例重跑 |
| R → F | S | 已登记 R | 拒绝 | 新增实测 |
| R → F，再 SAVE | S | **未登记 R** | **应拒绝，实际都允许：SM-01** | 新增实测 |
| R → F，再 SAVE | S | **未登记 U** | **应拒绝，实际都允许：SM-01** | 新增实测 |
| R → U | S | 无 | 允许；SAVE 被 fence 拒绝 | 新增实测 |
| U → S | S | 同事务建立并成功 | 允许：publication、两侧指针与 audit 原子提交 | 新增实测 |
| U，尝试标 F | U | 无 | 拒绝 | 新增实测 |
| U → F | U → F，同事务 | 无 | 允许已知失败结算 | 新增实测 |
| R → S / 首次发布 | S | S | 完整结算允许；缺 content audit 或仅 Bridge 激活拒绝 | 原用例重跑 |
| WITHDRAW / 已发布资源 | 历史 S | 历史 S；另有成功 SUSPEND | WITHDRAWN / SUSPENDED，保留 ACTIVE generation/history | 原用例重跑 |

UNKNOWN 成功恢复不需要放宽 `UNKNOWN → UNKNOWN`：本轮将 activation 引用和 SUCCEEDED/result fields 放在同一终态 UPDATE，再更新 resource 与 audit，提交成功。原 harness 先单独登记引用的普通激活顺序不适用于 content UNKNOWN；未来实现须明确这一区别。此测试只证明 SQL 允许该事务形状，不提供 reconciliation 授权。

未实测的组合仍包括：已登记 UNKNOWN activation 的取消拒绝、已登记 FAILED activation 的安全取消、多轮发布/再撤回以及实际并发撤权。不能由本表推导全矩阵或产品集成 signoff。

## LOCAL 验证及边界

[本轮证据](evidence/m5-state-matrix-review-local.json)：PG16 `160015`，独立 Unix socket fixture，数据库 `zhiban_m5_disposable`，port 55439，无 TCP listener。原 30 项保持通过；新增 12 个观测中，6 个正确正负向检查通过，6 个观测复现同一 SM-01。证据总状态为 `REVIEW_BLOCKED`；不能称为“42 项安全验证通过”。

在原 harness 的临时派生 runner 中插入复评探针，仅调整测试 helper 的 UNKNOWN 终态登记顺序。证据内嵌完整 `reviewRunnerSource`，并保存原 runner 与实际派生 runner hash；可将内嵌源码恢复到 `scripts/zhiban-local/.review-m5-state-matrix.mts` 后用 `pnpm exec tsx` 重现。终端 PASS 表示预期观测复现，包括预期复现缺陷；证据明确把这 6 项标为 REPRODUCED_DEFECT。原 runner 与原证据 bytes 保留。

静态检查 42 项通过，候选 hash 未变，pglast 未运行；实际 SQL 由本轮 PG16 执行。所有连接关闭、临时 cluster 停止、精确临时目录删除。未连接 55432/55433；Native provider 调用为 0；synthetic actor 不覆盖真实 Session/Role/Scope/owner、授权并发撤回、Native outcome、HTTPS/CSP/editor 旅程。

receipt 仍 LOCAL / UNISSUED / UNAPPLIED，Bridge 未启用；无 commit/push/CI dispatch。

下一步：只修 SM-01、刷新候选 hash 并补上述定向验收，随后推进本地文本闭环。建议模型：GPT-6 Astra high（跨表安全约束修复）；常规页面实现再用 GPT-6.1 Sol medium。
