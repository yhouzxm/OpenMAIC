# M5-A/B Bridge gate、发布协调 ACL 与局部 CSP 增量评审

日期：2026-10-09（Asia/Shanghai）

STATUS: DESIGN_REVISED / SQL_CANDIDATE_GENERATED_UNAPPLIED

范围：[M5-A/B 精确设计](zhiban-v2-m5-ab-design.md)。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。本轮核对源码、修订设计及验证隔离 CSP；没有应用 migration、改动 frozen Identity helper、启用实际 Bridge、执行生产操作或 commit/push/CI。此结论不等于 SQL BUILD、D08 integrated 或 enabled Bridge gate 已完成。

## 1. 原设计评审发现与修订

| 优先级 | 原设计缺口 | 修订决定 |
| --- | --- | --- |
| P1 | ready 尚无精确谓词，若包含 PUBLISHED/ENABLED/用户可见条件，将阻止初始 SUSPENDED slot 创建、首次发布以及撤回后的审计/结算 | ready 仅为可桥接资源的结构判定，DRAFT/PUBLISHED/WITHDRAWN 都可结构就绪；实时主体权限、业务可写/可读与 deployment 验证另检 |
| P1 | 独立 content runtime 未解决 `bridge_identity_context` 的 `session_user='zhiban_bridge_runtime'` 限定；多客户端 guard/业务写入不满足冻结 Bridge 同客户端契约 | 内容用例与发布协调均使用现有 `zhiban_bridge_runtime` 的同一本地客户端；仅对新 content schema 增加精确列权限，不增加 LOGIN role、继承边或修改 helper 身份限定 |
| P1 | Academic 父表只读权限不足以做 FOR SHARE；新增 owner policy 又会使 M2 原有“唯一 tenant policy”核验失败 | 狭窄 SECURITY DEFINER business-lock helper、owner tenant SELECT/lock-only UPDATE policies；runtime 无 Academic DML。新增精确 receipt profile，保留旧 ledger/hash 与旧 profile，不用泛化 policy 检查 |
| P2 | “允许必要 inline style”范围不明确；现有 renderer 同时使用 CSSOM 几何和固定 `<style>`，整体 unsafe-inline 并非必要结论 | 从公开 renderer 的实际输出取固定样式 hash；候选 CSP 允许 renderer CSS 与空 style 初始化两个精确 hash，禁止 style attributes 与 inline script，局部页面单独验证 |
| P2 | 共任教作者与 frozen slot/generation owner 的关系未明，可能错误切换 owner 或使 inactive owner 后自动接管 | 审计 actor 为当前教师；slot/generation owner 保持创建资源的教师，co-author 不改 owner。owner 失效则 native 访问/发布拒绝，转移本轮不开放 |

上述修订收敛了设计选择；新 SQL 的约束/GRANT/函数实际行为及真实撤权竞态仍须在下一实现中证明，不用文档审查代替 PG 验收。

## 2. Bridge gate 精确职责

沿用 `business_resource_ready(uuid,uuid)` 的调用位置、签名、owner、SECURITY INVOKER、STABLE、受限 search_path 和 EXECUTE 边界。下一增量 migration 的函数体候选逻辑：

```sql
SELECT coalesce(
  session_user = 'zhiban_bridge_runtime'
  AND p_tenant_id = zhiban_identity.current_tenant_id()
  AND zhiban_identity.is_uuid_v7(p_tenant_id)
  AND zhiban_identity.is_uuid_v7(p_activity_id)
  AND EXISTS (
    SELECT 1 FROM zhiban_content.resources AS r
    WHERE r.tenant_id = p_tenant_id AND r.id = p_activity_id
      AND r.kind = 'SLIDE_CONTENT'
      AND r.policy_version = 'content-text-v1'
  ), false);
```

资源包含 `policy_version` 不可变 stamp；同租户 Offering FK、非空列、kind/policy CHECK、有效 draft DTO 约束由 content migration 保证。不会因客户端 DTO/type、未注册 ID、TEXT_RESPONSE ID、NULL、其他租户或缺失 TenantContext 返回 TRUE。该函数只查询 tenant-RLS 保护的真实资源，不查询外部 provider、不取 Session digest、不接受 environment/GUC enable switch 或 injected resource facts。

**结构 ready 不等于授权或可见：**

- `resource_gate_guard` 在业务/Bridge mutation 上验证资源结构；先创建 content row 再建立 slot，避免循环依赖。owner/mapping 相关变更继续遵守 frozen Bridge trigger/CAS/审计。
- `content-v1` use case 在同客户端锁定当前身份、角色 scope、assignment/enrollment、Course/Offering 状态；发布/编辑 require OPEN，已发布历史读取允许 CLOSED；ARCHIVED 拒绝正常业务访问。结构 gate 不因 CLOSED/ARCHIVED/撤回而阻止保留记录的安全结算；正常用户无资格时 Application 仍拒绝。
- 学生可读还必须 resource PUBLISHED、publication pointer 对应该资源、exact active Bridge generation、slot ENABLED、完整 scene bindings、有效 owner/current Enrollment。不能返回 draft/title，不能读取 WITHDRAWN/PENDING/ORPHAN。
- deployment VERIFIED、provider/source/ACL fingerprint、Native Database/byte 隔离和完整 receipt 在 server composition 验证。不能把 `ready(NULL,NULL)=FALSE` 当全局关闭证明或审批证明。

保持旧 foundation root 的 DENIED/UNAVAILABLE 实现不变。新 content composition 为独立 server-owned factory，直接消费受验证的私有配置及实际 loader，无 public enabled 参数、caller store/facts callback。新 catalog 会使旧 Bridge fingerprint 不再匹配；旧 receipt 不可用于开启新 composition。独立 disposable foundation 测试仍使用其原 migration/profile。

## 3. 角色与 ACL 的唯一选型

放弃未确定的 content LOGIN runtime/coordinator/helper 三选一方案。采用现有 `zhiban_bridge_runtime` 作唯一 content 业务/发布客户端，保持 NOINHERIT/NOBYPASSRLS/非 owner/零 role membership；独立 `zhiban_openmaic_runtime` 仍仅在 native database 的私有 provider 连接使用，两者不互授 CONNECT/credentials。Academic runtime 不增授 content/Bridge/native 能力。

新 `zhiban_content` 由既有 NOLOGIN `zhiban_identity_owner` 创建；PUBLIC、auth、control、普通 runtime、academic runtime 无 content 权限。精确 ACL inventory：

| 对象 | zhiban_bridge_runtime 权限 |
| --- | --- |
| content schema / ledger | USAGE；schema_migrations SELECT；无 CREATE/ledger 写入 |
| resources | SELECT、INSERT；仅 UPDATE `title,draft,state,revision,active_publication_id,last_publication_no,updated_by,updated_at`；tenant/id/offering/kind/policy/created_by/created_at 不可更新 |
| publications | SELECT、INSERT；无 UPDATE/DELETE/TRUNCATE |
| operations | SELECT、INSERT；仅 UPDATE `state,bridge_operation_id,result_publication_id,result_revision,completed_at`，source/actor/key/intent 不可变 |
| audit_events | SELECT、INSERT；无 UPDATE/DELETE |
| business-lock helper | 仅 EXECUTE 闭合签名；无原始 Academic table SELECT/INSERT/UPDATE/DELETE grants |
| 已有 Bridge | 原 B9 manifest 所列精确权限；不加 owner/global list/physical deletion/native DDL |
| Identity | 沿用既有 bridge security helper，完整签名/13列投影/Session digest 私有封装不变；无 verifier/raw Session 权限 |

新表 ENABLE + FORCE tenant RLS；明确定义 runtime SELECT/INSERT/UPDATE 三类 tenant policy，不用 `FOR ALL` 声称 DELETE 已开放。owner 的一致性 trigger 所需读/锁策略单独列明并受 `session_user` 与 transaction-local tenant 限制。只读表无 UPDATE policy/column 权限。

所有资源 CAS +1、terminal/nullable result、publication composite FK、deferred pointer consistency 与 same-tx audit 都须在新 schema 的约束/trigger 强制。prepared generation 与 source_revision/digest 在 server 与 deferred guard 一致；native 成功而本地失败不能生成 SUCCEEDED 本地 publication。

## 4. Academic 父关系锁的最小 helper

新 helper 候选 `zhiban_content.lock_business_context(uuid,uuid,uuid,uuid,text)`：参数为 tenant/resource/Offering/actorMembership 与闭合动作类别（TEACHER_WRITE/TEACHER_WITHDRAW/TEACHER_READ/STUDENT_READ）。严格 UUID/tenant/session_user 检查，未知 action 拒绝；它只返回 exact Course/Offering/relationship ID、status、revision、validity 等闭合业务事实，不返回正文、个人列表、密码/Session 或任意 SQL 查询结果。

SECURITY DEFINER owner=`zhiban_identity_owner`、`search_path=pg_catalog,zhiban_content,zhiban_academic,zhiban_identity,pg_temp`、`row_security=on`、VOLATILE、PARALLEL UNSAFE；PUBLIC 与其他 runtime REVOKE，只有 Bridge EXECUTE。没有动态 SQL、调用者可控表名或写入语句。

对 `courses/offerings/assignments/enrollments` 增加 owner 专用策略：

- SELECT：仅 `session_user='zhiban_bridge_runtime'` 且 `tenant_id=current_tenant_id()`。
- UPDATE lock-only：相同 USING，`WITH CHECK(false)`；owner 有 table privilege，但实际 UPDATE 即使 SET 为原值也拒绝。不得给 Bridge 本身 UPDATE 以取得锁。
- 保留原 academic runtime tenant policy，不改变其现有权限；不扩展到 Classes、RoleCatalog、Identity Session 表。

helper 在同客户端按 Offering→Course→actor 精确 assignment/enrollment 顺序 `FOR SHARE`，不使用“另取 Academic connection”或不会与实际撤权写入冲突的 advisory lock。已过期/已撤销/错班关系不返回 ALLOW；服务端仍核对一个 grant 的 role+scope，并在 native COMMIT 前和本地结算前重新验证时钟/资格。helper 不替代 Session security guard。

执行顺序：初步定位资源/slot owner（尚不信任其授权）→同客户端 identity guard 锁 actor+owner →业务 helper 锁父关系→resource FOR UPDATE/SHARE 并核对初读身份/owner未变→slot→generation→operation。Identity helper related participant 上限不变，本轮 actor+owner 足够；membership/owner 无效不得用当前共任教师自动替换。publications 不做需要 UPDATE 权限的行锁。

## 5. 发布原子性与 receipt/profile 升级

reserve、dispatch guard、settlement 每个本地阶段都是单个 `zhiban_bridge_runtime` client/READ COMMITTED transaction；其中身份验证、业务锁、content pointer/operation/audit 与 Bridge pointer/operation/audit 使用同一 client。多个有持久 reservation 的阶段可以跨事务，但任一阶段不能拆为分别 COMMIT 的 guard/content/Bridge。

现有 Academic store 的 business/guard/identity 多连接组合不复用到 Bridge 发布。Native provider 另取私有连接执行其事务，按 B9 正式 public API 验证、原生 COMMIT 前授权/期限检查；不与本地事务嵌套、不声称跨库 ACID。slot owner 与 generation owner 一致；每个 generation server-generated owner_handle 不等于当前 actor 字符串。撤回采用 frozen SUSPEND，保留 active generation/history，不物理 RETIRE/delete。

精确 receipt 升级是实现的一部分：

1. Identity 0001–0013、Academic/Learning/Assessment 已应用 migration 字节和 ledger 不变；新增 content migration 明列跨 schema ready/helper/RLS 的变化，独立记录 checksum。
2. 原 M2 loader 期待每 Academic 表唯一 policy；新增 owner policies 后必须使用新 content-enabled profile，逐一核验原 tenant policy与两个准确 owner policy 的角色/命令/predicate/WITH CHECK/function owner/search_path/EXECUTE/ACL。不得改为 policy count≥1、忽略 bool_and 或静默接受任意新增 grant。
3. 新 Bridge manifest 同时覆盖新增 ready 函数定义、content schema/ACL、Academic helper/policies与相关角色 ACL；旧 B9/native receipt 按未变对象保留历史适用范围，不能拿旧总体 fingerprint 标新环境通过。
4. 无新 receipt 或任何 drift 时，启动/启用失败；不在 HTTP 请求或启动时自动跑 migration/补 grant/重写 ledger。native provisioning 仍独立 admin/migrator 步骤。
5. M1–M4 的共享启动/Academic ACL 检查确实受影响，实现时补 M2–M4 本地回归；不是本轮文档评审重复跑一遍。

## 6. 局部 CSP 修订与实测

原设计“style-src 'self' 必须放宽 inline geometry”过于宽泛。公开 renderer 的固定 `<style>` 可以 hash 授权，React 对 `style` CSSOM 属性赋值在本轮 Chromium 实测可工作，同时 `style-src-attr 'none'` 拒绝原始 HTML style 属性。无需直接读取/import private renderer styles 模块或添加 blanket unsafe-inline。

隔离诊断命令：`pnpm exec tsx scripts/zhiban-local/diagnose-d08.mts --csp-review`。完整结果见 [LOCAL CSP 证据](evidence/m5-csp-local.json)：重新隔离构建固定 source DSL/renderer/editor，复用安装依赖，不声称 frozen reinstall。renderer 样式 hash 来自公开渲染输出的精确 textContent，与 source/artifact hash 关联。

最终 LOCAL 9/9 通过（7 项 package/host 检查＋2 项 CSP 检查）；严格检查在编辑后等待两次 animation frame，确认 CSSOM 几何/固定 stylesheet 可用且无意外 CSP violation，再执行攻击探针。

发现并修正的实测问题：仅允许非空 renderer CSS hash 时，延后收到了两次 `style-src-elem` 拒绝，虽然画面仍显示。增补空 style 初始化 hash 后，该检查通过；没有用测试重试或忽略 violation 取得通过。候选包含：

- renderer CSS：`sha256-xV3QMqVeoqC9uYjQCwLSqMrFJ81WnjRzc+LMeASPzCE=`。
- 空内容初始化：`sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`；只允许空样式，不授权其他 CSS。

这组 hash 只适用于本次固定 renderer/text host；不同 artifact 的 renderer CSS 需重新验证，不能永不变化。receipt 的 source/artifact hash 与两项实际 policy/hash 对应。

候选产品文档策略（editor/preview 专属 GET HTML response）：

```text
default-src 'none';
script-src 'self'; script-src-attr 'none';
style-src 'self' 'sha256-<verified-renderer-style-hash>' 'sha256-<empty-style-hash>';
style-src-elem 'self' 'sha256-<verified-renderer-style-hash>' 'sha256-<empty-style-hash>';
style-src-attr 'none';
connect-src 'self';
img-src 'none'; font-src 'none'; media-src 'none';
frame-src 'none'; worker-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

固定自有 script/style bundle 可加载；no inline/eval script、no remote fonts/iframe/snapshot/media。connect-self 仅用于实际同源 content/CSRF API，仍须每次 Session/Origin/CSRF；隔离试验使用更窄 connect-none，未验实际 API。CSP 的 self 是 origin 边界，不是端点白名单，host 仍仅挂授权的智伴 routes，不挂原生服务。

首轮独立页面 GET route 显式匹配、认证后提供 editor/preview HTML；路径中的 tenant/Offering/resource UUID 仅定位而非授权。HTML 内不嵌用户正文或 token，bundle 从 API 拉取；Cache-Control no-store、nosniff、no-referrer；未匹配路由/错误页继续用原工作台 CSP。登录页、工作台、API 的全局 CSP 不变，不将专属策略扩散到所有 response 或 iframe。

上线或浏览器范围扩大前，实际受支持浏览器、TLS/Cookie、CSS布局、撤权后的 API 行为与每种启用元素重新实测。任何未登记 style element/hash drift 失败关闭，不动态根据用户内容追加 hash。不能声称 CSP 可以撤回已展示到浏览器的内容。

## 7. 验证边界与退出条件

本轮可证明：SOURCE/公开包可行性与隔离 Chromium CSP 行为；不证明新 ready、helper、ACL/row locks 或 publication 事务已经实现。PG/native provisioning/真实账号均未操作。

下一 SQL inventory 与本地 BUILD 的必要验证：

- gate 在 NULL/错租户/未注册/TEXT_RESPONSE 时 FALSE；DRAFT/WITHDRAWN 的真实结构资源仍可就绪，而学生/失效 actor访问仍拒绝。
- Bridge 没有 Academic 原始 DML；helper 跨租户/错误参数拒绝；owner lock policies 能 FOR SHARE，却不能实际 UPDATE；没有 broad function EXECUTE、native CONNECT、role membership/DDL。
- 同客户端原子 pointer/operation/audit；故意 audit/一致性失败全回滚；native 后 local failure 保持不可见/unknown；错 generation/slot/source version 不可结算。
- 独立连接 barrier：role/assignment/enrollment/Session/Credential/owner 失效对保存、等锁后的 dispatch/settlement、replay 都即时生效；业务状态过期与 native COMMIT 前检查有效。
- exactly两种 receipt profile、startup drift/旧 receipt 拒绝与新 profile 通过；M1–M4 受影响回归；真实 editor/preview HTTPS 路径使用专属策略，工作台/错误页不受放宽。

这份修订可作为具体 SQL inventory 的唯一选型依据。SQL 候选尚未应用、真实验证未完成时不标 `BUILD_READY/ENABLED_BRIDGE_SIGNED_OFF/D08_ACCEPTED`。已生成 [未应用 migration/helper/ACL/receipt 清单](zhiban-v2-m5-sql-inventory.md)，无新 role bootstrap；下一步评审其候选细化与 receipt/profile 差异，再在明确本地应用范围内实现文本闭环。建议本轮跨 schema SQL/权限/事务评审使用 GPT-6 Astra high，常规实现 GPT-6.1 Sol medium。
