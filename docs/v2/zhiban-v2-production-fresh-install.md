# 全新三库安装与首管理员操作手册（A／B）

适用于当前候选源码的 PG18 空库安装。真实阿里云 RDS 尚未验收；以下命令不是已在 `47.120.42.25` 成功执行的记录。正式非 root 宿主、systemd／88端口代理模板、停写备份与独立恢复现见[Ubuntu 运维手册](zhiban-v2-ubuntu-operations.md)。旧 LOCAL／PG16 快照的正式启用仍为可选历史迁移分支。

## 安装时自动初始化数据库

现在使用统一 `setup` 入口，安装时自动应用全部表结构与必要初始化数据，不用逐份手工导入 SQL。准备好本手册所列私有配置／批准材料后：

```bash
pnpm setup:zhiban:production:plan /root/zhiban-install/setup.json
pnpm setup:zhiban:production /root/zhiban-install/setup.json 上一步审核所得planSha256
pnpm deploy:zhiban:production start /etc/zhiban/runtime.json
```

安装命令自动完成：检查专用目标 → 可选建库／角色和权限准备 → 业务／Content／authoring 三库表结构 → 首管理员及必要策略 → 签名凭证与完整核验。原生 OpenMAIC 的 schema migration 仍直接复用。普通启动不持有安装权限，也不反复导入。

- **已有合规预置的数据库和角色**：按 `setup-preprovisioned.example.json` 填写，安装命令自动导入 schema／初始化首管理员；不需要常驻或安装过程额外取得 admin 权限。这也是 RDS 先由管理路径完成冻结角色预置后的使用方式。
- **自动创建专用空库和角色**：按 `setup.example.json` 提供一次性的管理连接。当前自动预置要求真实 PG18 superuser 管理路径，owner／grantor 与独立 profile 一致；不能将 RDS 普通 CREATEROLE 账号当作该路径。若目标是三个已存在的专用空库，设 `createDatabases:false`，仍须全部应用角色尚未存在。不会修改现有应用角色或轮换其密码。
- **重复安装**：READY 实例核验通过后返回 `ALREADY_INSTALLED / VERIFIED_NO_DDL`，不重新设置首密或重新建表。FAILED／外来／来源不符状态拒绝继续，不自动重置。
- **已有数据**：自动预置发现非空库，在创建其他库或角色之前拒绝；保留原数据。这里的“导入”是安装 schema 和必要系统数据，不把 OpenMAIC 的旧课程或其他实例的账户自动合并进新机构。

`setup-plan` 不执行 DDL；审阅的 pin 同时绑定目标、安装计划与私有管理配置。`PREPARE_DATABASES` 进入同一个 installation journal；中途失败保持隔离、保留部分目标，不自动删库或删角色。安装结束后，运行配置不包含管理连接，启动仅使用 runtime JSON。

## 1. 源码和安装参考

使用 Node ≥22.19、pnpm 10.28.0。构造参考还需 PG18 的 `initdb/pg_ctl/psql/postgres`；以非 root 用户运行，**只创建自己的临时 cluster**，不接受外部 DSN 或既有数据目录。Ubuntu 二进制目录可显式指定：

```bash
pnpm install --frozen-lockfile
pnpm deploy:zhiban:production assets
pnpm build:zhiban:host
export ZHIBAN_PG18_BIN=/usr/lib/postgresql/18/bin
umask 077
pnpm deploy:zhiban:production source-profile /绝对路径/新source-profile.json 目标数据库owner名 目标角色grantor名
```

`source-profile` 的 owner／grantor 必须是目标预置策略中实际批准的非应用角色名；不从真实目标观察值自我批准。命令在隔离 PG18 安装同一来源，记录三库空态／安装态、完整 schema／ACL／角色图、ledger、provider、源码和浏览器资产 hash，并返回 SHA256 pin。源码、资产或依赖变更后须重新构造、审核；不能给旧 profile 换 pin 冒充批准。

本地证据中的 `postgres/postgres` 仅适用于 disposable cluster，不是 RDS 的批准参考。证书、密码、源码闭包、数据库名和实例 ID 最终均绑定到安装计划／receipt。`assets` 为显式构建，`start` 不构建浏览器资产、不执行 migration。

## 2. 先预置独立目标，不能复用 OpenMAIC 库

若采用自动预置，下面 SQL 来源由 setup 自动执行；若 RDS 需通过独立管理路径预置，则使用相同来源，之后运行不含 preparation 的 setup。目标为三个**空的专用库**，例如 `zhiban_business`、`zhiban_content`、`zhiban_authoring`；不碰已有 OpenMAIC。按下列来源分别预置角色、schema／数据库权限：

| 数据库 | psql-only 来源 |
| --- | --- |
| business | `docs/v2/candidates/pg18-provider-v1/bootstrap-roles.pg18.sql`，再 `bootstrap-bridge-roles.pg18.sql`，再 `lib/zhiban/infrastructure/production/service-roles.sql` |
| content | `docs/v2/candidates/pg18-provider-v1/bootstrap-native-roles.pg18.sql` |
| authoring | `lib/zhiban/infrastructure/production/authoring-roles.sql` |

academic／autograde 两个运行角色由 `lib/zhiban/infrastructure/production/service-roles.sql` 准备，不再要求逐条手工创建。自动预置仅给本次新建角色设置其已批准私有连接配置中的密码；预置模式的凭据由管理路径交付。源码 SQL 不内嵌密码。schema 安装阶段仅用三个 migrator 角色；一次性 setup 管理连接不进入运行配置。

这些脚本有严格角色图和 grantor 要求。**RDS 普通 CREATEROLE 不等于能够预置冻结图。** 无合规管理路径时停在预置阶段；不能补 ADMIN 边、提高运行角色权限、改旧 migration 或照搬本地超级用户身份来通过。现阶段不宣称任意 RDS 账号可以独立完成此步。

空态 profile 不匹配即拒绝应用 schema。存在其他 `zhiban_*` 角色、额外 ACL 或非空 schema 都可能使独立参考不匹配，应查明来源而非让目标反签自身。

## 3. 私有输入和责任分离

参考 `docs/v2/examples/production-install/` 的配置模板。它们是**带占位符的填写模板，不是可用生产批准**。所有路径用无符号链接的绝对路径；私有文件通常 0600，安装／状态／批准目录 0700，归当前执行用户。运行凭据可为 root 所有的 0640 文件，前提是执行用户可读；常驻批准目录当前要求由运行用户所有且 0700。

- 运行配置：八个受限角色及 CA、HTTPS 证书／私钥、source profile／pin、receipt 签发者公钥／SPKI pin、明确 Identity 策略。没有 migrator 凭据、签发私钥或首密。
- 安装配置：仅三 migrator 凭据、receipt 签发私钥、四种 admission policy、双人批准和首密文件。不要交给常驻进程。
- 每个角色使用单独 0600 `.env`，只有 `DATABASE_URL=postgresql://角色:URL编码密码@RDS主机:5432/专用数据库`。不得加 `sslmode` 等 URL 参数；连接策略由配置显式控制：保留 `caFile` 且不设置 `transport` 时继续校验 CA／hostname；配置 `"transport": "plain"` 并移除 `caFile` 时使用未加密 PostgreSQL 连接。对安装、运行、恢复使用的每个数据库连接均须按需要配置，模式与凭据文件共同绑定到计划／receipt。
- RDS 受信 CA 与浏览器 HTTPS 证书分开。`origin` 是最终外部 HTTP 或 HTTPS 地址；HTTP 模式必须显式配置 loopback 可信代理和内部 TLS serverName，内网证书匹配该 serverName。88 端口代理及显式可信 IP 策略见 Ubuntu 运维手册，保持不隐式信任 X-Forwarded-For。
- 两个不同的具名 Ed25519 签署人各自保管私钥。第三个 receipt issuer key 只在受控安装时使用；宿主只得到公钥。SHA256 pin 对 **SPKI DER** 计算，不是 PEM 文本 hash。

例如提取签署人公钥 pin：

```bash
openssl pkey -pubin -in /私有路径/operator-public.pem -outform DER | sha256sum
```

## 4. 明确 Identity 策略与首管理员批准

先在私有目录填写 `identity-spec.example.json`：环境／批准 refs、会话时限、admission 容量、成员容量及实际批准的泄露密码语料。示例占位语料不能当正式密码筛查策略。

```bash
pnpm deploy:zhiban:production identity-proposal /私有路径/identity-spec.json /私有路径/identity-proposal.json
```

它生成新的角色目录 ID、固定权限目录 digest、随机 HMAC key、四个 policy digest，**不自动批准**。审核后将 `.identity` 放进 runtime JSON，将 `.admissionPolicies` 放进 install JSON；保持同一份结果，不能分别重跑后混用。若用 jq，可在私有目录这样合并（目标文件先以 0600 创建）：

```bash
jq --slurpfile i /私有路径/identity-proposal.json '.identity=$i[0].identity' /私有路径/runtime-template.json > /私有路径/runtime.json
jq --slurpfile i /私有路径/identity-proposal.json '.admissionPolicies=$i[0].admissionPolicies' /私有路径/install-template.json > /私有路径/install.json
```

填写 first-admin spec 后生成短时有效的**未签名建议**：

```bash
pnpm deploy:zhiban:production first-admin-proposal /私有路径/first-admin-spec.json /私有路径/first-admin-manifest.json
```

此 manifest 的新 `userId` 就是初始登录账号。两个责任人分别审阅同一完整文件，再各自执行：

```bash
pnpm deploy:zhiban:production sign-manifest /私有路径/first-admin-manifest.json /各自保管路径/ed25519-private.pem /私有路径/各自signature.json
```

合并两个签名，输出文件名必须与批准 ref 对应，例如 `first-admin.json`：

```bash
pnpm deploy:zhiban:production envelope /私有路径/first-admin-manifest.json /私有路径/operator-signature.json /私有路径/approver-signature.json /私有路径/first-admin-approvals/first-admin.json
```

在 install JSON 配置两个具名公钥／pin、批准目录及 `manifests.first-admin = manifestDigest`。审批目录不可混入运行签发私钥。有效期过期必须重新提案及双签，不能直接延长已签文件。

首密存入单独 0600 文件（随机高强度、经独立安全渠道交给指定管理员），例如：

```bash
openssl rand -base64 36 > /私有路径/initial-password.txt
```

本路径复用冻结 FIRST_PLATFORM_ADMIN／FIRST_PASSWORD：创建一个真实平台管理员，不创建教学示例数据；重复 provision 按原合同幂等，不能覆盖已设首密。没有公开 bootstrap API。首次登录后使用现有密码修改流程更换首密；安装私密材料依运维保管策略撤离运行主机。

## 5. 审核计划、安装、查证与启动

推荐执行顶部统一 setup 流程。下面保留已预置目标的底层分步入口；两种入口复用同一个 installer，不要对已安装实例再次调用底层 install。固定运行端点、文件内容与 pin 后：

```bash
pnpm deploy:zhiban:production plan /私有路径/install.json
pnpm deploy:zhiban:production install /私有路径/install.json 审核所得planSha256
pnpm deploy:zhiban:production inspect /私有路径/runtime.json
pnpm deploy:zhiban:production verify /私有路径/runtime.json
pnpm deploy:zhiban:production start /私有路径/runtime.json
```

`plan` 不执行 DDL，也不把私有 DSN 输出到控制台。`install` 依次安装 business、Content、authoring，查证独立参考，安装 admission policy，消费首管理员批准，创建新 deployment 绑定，最后签发 receipt 并将 journal 改为 READY。运行进程不接受继承的 `DATABASE_URL`，不读取安装 JSON。

`verify` 检查 receipt／来源／完整 catalog 和 ledger；`start` 还在取得共用生命周期锁后重核、检查首管理员初始化／首密消费及当前 Content 绑定，才组合真实 HTTP 服务。只有一个宿主／安装器可持锁。自动预置还会在固定管理库 `postgres` 取得单独的准备锁，避免同时创建角色和数据库。GET `/zhiban` 可用后以 manifest 的 userId 与首密登录，点击「平台管理」。不要把静态登录页 200 单独当成数据库 readiness。

运行模型／解析／扫描服务仍用现有受限服务配置。未提供 scanner 时附件上传保持关闭；缺模型不妨碍登录、教务、文本发布和人工评分。本次验收不调用付费模型或真实外部服务。正式 systemd 使用 `.zhiban-host/host.mjs`，从只读 release 启动；管理员使用预构建 `.zhiban-host/ops.mjs`，不需在 release 中生成临时 bundle。`pnpm deploy:zhiban:production` 仍保留作为源码开发入口。

SIGTERM／SIGINT 会关闭 HTTP 并排空服务和 worker、释放池／生命周期锁。重启使用同一 runtime JSON 和状态目录；不重新执行 `install`。

## 6. 首次创建空间与普通运营

平台管理员不等于任意教学班成员。初始平台没有机构／课程列表是预期状态。要通过页面开通机构空间，必须在安装前于 runtime 的 `membershipAuthority` 配置具名独立公钥和私有批准目录。没有该 authority，平台页显示配置待补，控制命令保持关闭。

平台页提供「登记批准」和「执行受控命令」；实际能力仍由冻结 ControlCommands 校验双签 manifest、当前平台管理员 grant／user revision、目录 digest、短时有效期、密码重认证、CSRF、命令绑定和目标 CAS。不是把页面输入 JSON 当批准。

控制 manifest 字段遵循 `lib/zhiban/infrastructure/identity/composition/control-approval.ts` 的完整 `ControlApprovalManifest`；`TENANT_CREATE` 要明确新的 `planned_tenant_id`、code／displayName、当前 operator/grant revision，其他不适用目标字段为 null。`control-proposal INPUT NEW_OUTPUT` 只计算规范 digest，不代填授权字段；之后由上述两个签署人签同一文件并 `envelope`，放到 authority 目录，文件名 `<approval_ref>.json`。页面登记此 ref，再提交：

```json
{
  "approvalRef": "实际批准ref",
  "idempotencyKey": "已签manifest的command_id",
  "requestId": "新UUIDv7",
  "expectedUserRevision": null,
  "expectedTenantRevision": null
}
```

随后按原 `USER_CREATE`／普通账户首密流程、成员 consent／`FIRST_TENANT_ADMIN` 取得机构管理员；该机构管理员使用既有教务页创建课程、教学班、任教和选课。平台 grant 不直接赋予教师评分权。部分目标操作的 revision 必须按实际已签 manifest 提交，不能一律 null。

## 7. 部分失败与证据边界

三库不是单一事务。journal 记录已完成阶段；任一失败置 FAILED，不签 READY receipt、不自动删除对象、不自动重试。`inspect` 查看最后阶段，保留私有诊断和已完成目标用于受控诊断。禁止手工改 READY、补签一个观察到的目标、重跑迁移覆盖旧状态或改初始密码绕过失败。当前不提供任意阶段自动恢复；可在明确审核后另建三个全新空库重新计划安装，失败目标清理由单独操作范围决定。

统一 setup 的本地验收会真实创建三库／角色、使用 TLS 管理连接并经 psql 执行冻结角色源，随后初始化 schema／首管理员、复跑返回无 DDL，并验证已有数据保留。LOCAL 验收见 `docs/v2/evidence/persistence-130/production-install-runs/latest-local.json`：独立 source 构造、三库 TLS 安装、双签首管理员、HTTPS 平台页、受控空间创建、普通用户越权拒绝、三角色教学／文本 Bridge、重启、真实中途失败及 receipt／ACL／ledger 反向验证。它不是 RDS 角色预置、生产证书信任、历史数据激活或跨机恢复的证据，也不是旧 GitHub run 的扩展结论。
