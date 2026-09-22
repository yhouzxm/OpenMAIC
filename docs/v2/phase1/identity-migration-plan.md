# V1 → V2 Identity 迁移计划

Status: FROZEN。Phase 1A 不连接生产数据库、不读取生产 hash/个人数据、不导入任何账户。实现证据与数据库实际应用状态必须分开。

| 字段/关系                      | 分类           | 目标与条件                                                                                                   |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------ |
| User ID                        | REGENERATE     | 新 UserId；legacy_user_id 保存在 source + legacy tenant + account 映射，不复用主键                           |
| Username/login_name            | TRANSFORM      | 规范化后冲突报告；028 声明全局唯一不证明生产已执行；拒绝静默改名                                             |
| Name/display_name/real_name    | DIRECT         | 保留来源与用途，长度/Unicode校验；姓名不是唯一身份                                                           |
| Phone                          | TRANSFORM      | V1 加密/查找摘要依赖旧密钥，受控验证后重新加密/索引；不能用后四位重建                                        |
| Email                          | UNKNOWN        | 本次核心账户/schema/login identifier 未找到可靠 email 登录模型；不推断不存在于全库                           |
| Password                       | TRANSFORM      | 编码 Argon2id hash 条件性兼容迁移；抽样 verifier/参数验证；未验证则 MIGRATION_REQUIRES_RESET_OR_VERIFICATION |
| Role                           | MAP            | student→STUDENT；course/head teacher→TEACHER+不同 scope；admin 需审批，system/risk/research 不自动授予       |
| Class relationship             | MAP            | class_memberships、classes 与后续行政/教学班模型映射到 Course，不写 User类型                                 |
| Teacher relationship           | MAP            | teaching_assignments / course owner / class head teacher，核验 Tenant 与有效期                               |
| Admin relationship             | MAP            | admin_profiles 只是来源信息；实际授权须以有效 role_assignments + scope 为证据                                |
| Tenant / Organization          | MAP            | tenant 与组织分开核验；不把四级组织树变成四层租户                                                            |
| Account status                 | TRANSFORM      | 全局 User 状态与本空间 Membership 状态拆开；一个停用旧账户不能自动停用同人其他空间                           |
| Student/employee no            | MAP            | Membership/业务档案内来源标识，不默认全局登录标识                                                            |
| Source identity                | DIRECT         | 保留 source_system/source_external_id 作为溯源，校验唯一性                                                   |
| Existing Session / reset token | DO_NOT_MIGRATE | V2 全部重新登录，不复用旧 token、cookie、匿名 owner                                                          |
| OpenMAIC resource ownership    | MAP            | 单独审核 Zhiban-owned mapping，不复制匿名 cookie，不变更 OpenMAIC表                                          |
| Historical audit               | UNKNOWN        | 保留只读来源记录；不改写旧 actor 为新 actor，建立关联索引                                                    |

字段分类使用 DIRECT/TRANSFORM/MAP/REGENERATE/DO_NOT_MIGRATE/UNKNOWN；历史审计审批后决定引用或导入，保留来源不可变。

## 执行前关卡（未来阶段，未执行）

1. 批准脱敏只读清单：schema migration 实际版本、计数、唯一冲突、孤立 FK、算法分布、disabled 状态、组织与 scope；不导出明文凭据到文档。
2. 一人多账户匹配要人工或权威外部身份核验；同名/电话复用不自动合并；优先建立一对一映射，冲突隔离。
3. 创建可重放 migration manifest，source key 唯一、checksum、批次号、审计；在独立测试库演练，不接 V1 写权限。
4. 逐批先 User/Tenant/Membership，再批准 RoleGrant，最后业务关系；权限只取审核后的最小集，不继承 V1 system_admin 全权限。
5. 密码算法在代码中已确认，但生产编码值、库兼容、must_change、初始密码来源仍待验证。025 schema 允许生日策略，不等于生产实际使用；V2 禁止继承弱默认密码，必要时一次性验证重置。
6. 对账身份/关系计数、拒绝清单、双租户越权、角色变化和新登录；仅经明确后续授权再切换。
7. 回滚只撤回 V2 的该批次映射/资格或切回旧入口（需单独批准），保留审计。绝不修改 V1 或删除已产生业务数据；数据有依赖时用禁用/补偿而非级联删除。

## 主要风险

全局唯一登录标识但 tenant-bound account 的模型冲突；组织 scope 在 SQL 与 TS/API 间不一致；过宽 tenant grant；手机号密钥/索引重建；global User 合并误识别；旧账户类型与多角色不一致；V1 Session 不检查 Tenant 状态的路径；实际数据/迁移应用状态未知。未确认项均不得被当作迁移成功。

## 授权状态

生产 V1 Identity 迁移：NOT AUTHORIZED。文档冻结不解除任何生产数据或 V1 写入限制。SYSTEM_ADMIN 不从旧 role_assignments 自动迁移成 Membership RoleGrant；任何未来平台授权只能独立审批 SystemAdminGrant。
