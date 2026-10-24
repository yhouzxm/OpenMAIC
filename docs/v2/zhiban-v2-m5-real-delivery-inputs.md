# M5 真实本地交付输入清单

2026-10-13；**METADATA_ONLY_COLLECTED / AUTHENTICATED_INPUTS_PENDING / NOT_AUTHORIZATION**。对应[完成组与退出复评](zhiban-v2-m5-completion-exit-review.md)。R1/R2已在[R6本地修复](zhiban-v2-m5-completion-exit-fix-local.md)验证，后续仍须定向复评；准备此清单不授权连接开发库、读取原私有目录、签发、改HBA/凭据/信任库、安装、清旗或启动。

## 固定范围及待核验值

| 项目 | 目标/限制 | 本轮状态 |
| --- | --- | --- |
| Git | refactor/zhiban-v2；HEAD daf63afa83470d24a9ed41d171c6a17f8a80adb6；实际候选必须同时绑定dirty源码inventory | branch/HEAD已核对；工作区不CLEAN，不以HEAD单独签收当前代码 |
| 源 | 当前R6 inventory fa51a67d…c13b；handoff0001 aggregate bbede0be…24a8e；terminal inventory 4e5585a5…d662a | 已换新来源并核对；旧R5批准不可沿用 |
| Runtime | 本项目Node22 / pnpm10.28.0；build记录实际Node可执行字节、ABI、glibc、原生库、系统ELF和tool/source | 本轮无凭据观察Node22.23.3/pnpm10.28.0/PG工具16.15；真实发行仍另做物理验收 |
| Business / Native | PG16，127.0.0.1:55433；zhiban_m1_dev / zhiban_m5_native | 未连接核验；当前55433无监听，pg_control为shut down |
| cluster身份 | system_identifier、两库OID、postmasterStart、PG版本及admission | 控制头system identifier 7694054813252049413已观察；两库OID/postmaster/运行事实未知，不用临时56496值填充 |
| data / socket | /home/zxm/.local/share/zhiban-m1/pgdata；/home/zxm/.local/share/zhiban-m1/socket | 仅stat：canonical、owner zxm/uid1000、0700；未扫描/修改 |
| HTTPS | https://127.0.0.1:3443；固定入口及原header/body/path/CSP约束 | 当前3443无监听；真实证书信任与启动仍未验收 |
| control根 | 明确的canonical私有绝对路径；目录0700，单一maintenance lock/fence/pointer根 | 待具体路径批准，不能复制另一根或临时fixture做真实状态 |

## 必须提供的输入包

所有敏感文件仅通过本机canonical staging绝对路径交付：目录0700、文件0600或更严格、同owner、无symlink/hardlink。清单和聊天不接收密码、HMAC或私钥原文。登记非敏感ID/hash/签发purpose/适用范围与审核引用；与凭据相关的manifest/digest仍留私有范围。builder的config/TLS staging不得直接指向原真实私有根。

| 编号 | 输入与来源 | 消费处/关键绑定 | 所需动作与状态 |
| --- | --- | --- | --- |
| I01 | 受审source manifest与真实target观测 | baseline+新inventory；cluster/Business/Native OID、PG16、postmaster/data/socket/端口 | 工具/目录/pg_control/监听的无凭据元数据已收集；运行中SQL事实仍需后续明确范围 |
| I02 | operational issuer公钥pin、独立reviewer公钥pin；各自key保管和使用范围 | 两pin不同；签发批准issuerKeySha256；review批准controlDirectory/source/kind/精确bindings/TTL | 私钥仅显式issuer staging，位于control/output/child树之外；配置或生成真实authority另授权 |
| I03 | terminal安装的独立expected、INSTALL批准和技术receipt（如已存在则查证原件） | terminal0002 aggregate ec2aa806…2548；安装前后Business/Native完整profile、ACL、source、target | 未应用/部分应用不得假设已成功；只读查证先于安装授权；不重写0001 |
| I04 | ordinary handoff独立before/after expected | REVIEWED_ORDINARY_HANDOFF_PROFILE；INDEPENDENT_SHADOW_PG16、reviewRef、reference evidence、source及双库完整metadata | 独立shadow/审核产出，禁止actual原样复制为expected；真实Native全结构不可用最小fixture替代 |
| I05 | 现有BLOCKED门、maintenance.lock、fence history与pointer原字节 | 固定根；最高reserved fenceId/sequence、deployment、CAS hash；缺文件拒绝，不能自动补门 | 真实只读查证；保留现有UNKNOWN/RESERVED隔离，不以交付解锁 |
| I06 | 最新CLOSED窗口与审计/claims事实 | deployment/window/epoch、closedEventSequence、RESUMING→CLOSED provenance；精确cluster/OID；空claims/无未处理grants | 既有受限查证入口/管理观测；不能把测试插入CLOSED当真实凭据；未CLOSED则停止 |
| I07 | 新releaseId、credentialGenerationId与closed ordinary.json | 固定六角色/双库；新readSecret；原Identity HMAC、Session/catalog/admission和已核准policy保持；operator/membership null | 需明确真实凭据staging交付授权；普通配置不得包含admin/issuer/controller/migrator；禁止为了测试重写账户/身份 |
| I08 | 六份本次普通凭据及上一代已知凭据lineage | auth/runtime/control/academic/bridge/openmaic；原维护轮换的真实旧值与digest，必须区别于当前值 | 真实轮换/HBA操作单独批准；旧值仅private fd用于实际拒绝探测，验证后销毁临时请求；不能随机错密码冒充旧凭据 |
| I09 | tlsPaths指定certificatePath/privateKeyPath/caPath | 有效期、127.0.0.1 IP SAN、serverAuth、匹配RSA≥2048、pinned CA；精确原字节进artifact/TLS receipt | 显式staging；已有可信证书只能核验后复用；系统/内置浏览器CA安装单独授权，不设忽略验证 |
| I10 | Identity/Academic/Learning/Assessment/Content既有receipt的原文件与适用性审核 | previousReceiptPaths五项hash；当前policy/ledger hash；旧receipt适用范围由独立reviewer批准 | 不能只拿历史PASS总数或CI run替代；无原件/错context/migration不匹配则不签compatibility |
| I11 | 新不可变release及artifact/build/closure manifests | controlRoot/releases/releaseId；实际product/ordinary child/guard/browser/assets/native/Node/ELF、TLS/config字节；无额外/漂移叶 | 离线明确staging build，未激活；config/credential/TLS变化必须新代重建，不能补写旧artifact |
| I12 | COMPATIBILITY_TLS独立issuance批准 | 两份待审payload SHA、issuer pin/control/source/approvalId/reviewRef/issuedAt/expiresAt | 只有I01–I11和R1/R2就绪后可提出具体签发授权；完成组按修复后的唯一提交点消费 |
| I13 | 新管理transport attestation及实际旧凭据证明 | LOCAL_ORDINARY_TRANSPORT_EVIDENCE；target/source/generation/postmaster；HBA字节与完整有序rules/options/error、lineage/digests | 管理独立观测，不由ordinary客户端自证HBA；观测距验证≤30秒，TTL≤300秒；缺证不启动 |
| I14 | 独立signed shadow验证证据 | LOCAL_ORDINARY_SHADOW_VALIDATION；同source/code/native/OS闭包、shadow profile/evidence hash，九组check完整 | 全量受审shadow，真实LOCAL_DEV必须另有证明；不复用临时测试签名/CA/CLOSED/最小Native |
| I15 | PREPARE签名批准与REGISTERED read scope | LOCAL_PRODUCT_HANDOFF_PREPARE；全部target/build/config/profile/CLOSED/fence/pointer/CAS、TTL；owner register read token | 独立具体批准；INSTALL/REGISTER动作分别保留可查证结果；不直接ACTIVE、不授业务写 |
| I16 | HANDOFF_ACK独立issuance批准、新validation challenge/result及ACK/receipt组 | 精确validation输入SHA；实际fresh child完成九组；HOST_ACK/handoff/compat/challenge/readAuthorization binding | 缺证或不确定不给ACK；签发输出、owner seal/pointer发布各自查证；未知不重签/覆盖或自动修补 |
| I17 | 独立clear批准、dormant signed gate与controller/clear私有secret | LOCAL_RESUME_FLAG_CLEAR / LOCAL_STARTUP_RELEASE_GATE；精确gate/receipt/ACK/profile/HBA/logging/target/CLOSED/fence/pointer hash及TTL；controller PID/start/postmaster | clear非普通密码再轮换；owner/Native bootstrap已退出、controller预开后NOLOGIN/密码撤销、HBA无目标维护入口、物理排空；真正DB COMMIT后fresh检查才发布 |
| I18 | 真实launcher输入及验收/故障处置记录 | directory/expectedPath/authorityPublicKeyPath/receiptPath/compatibilityReceiptPath/tlsReceiptPath；同代完成组+DB COMMITTED+ACTIVE+epoch/claims/profile/ledger | 具体启动授权在已签清旗和R1/R2验证后；可信CA访问、实际本地账户旅程、停机与锁/连接排空；失败停止，不自动重启/清旗 |

I07–I08普通六角色准确为 zhiban_auth_runtime、zhiban_runtime、zhiban_control_runtime、zhiban_academic_runtime、zhiban_bridge_runtime、zhiban_openmaic_runtime。Identity composition/application policy保持冻结语义；原Content0001 loader不因为此清单放宽。

I13普通HBA要求管理postgres仅postgres库私有socket SCRAM、六角色精确目标库/127.0.0.1/32 SCRAM、其余local/IPv4/IPv6/all/replication拒绝，顺序和options/error均匹配[ordinary-transport](candidates/m5-handoff/ordinary-transport.cjs)。不把临时bootstrap额外管理HBA当最终普通配置。

## 建议执行顺序与停止条件

1. R1/R2已修复并通过22/29/23/17本地定向验证；[R6定向复评](zhiban-v2-m5-r6-directed-review.md)未发现新增阻断项，补supervisor退出未确认持锁LOCAL 1/1。当前真实环境未启动。
2. 形成I01–I10具体文件路径、非敏感摘要、独立审核来源与读取/变更范围；提出真实只读观测和staging准备的具体授权。未授权不读原私有凭据。
3. 离线构建I11，评审I12精确payload；真实expected、transport、shadow及凭据/HBA交付方案完整后，分别批准实际安装/准备/受限签发。各阶段有自己的TTL、permit及失败查证，不能预先用一个泛化批准包代替后续实际值。
4. 实际REGISTER/validation/HANDOFF/seal完成后，再根据真实新摘要提出I17独立clear批准；clear不顺带build、换密码、重签旧receipt或更改ready/service/window/claims。
5. clear的数据库/文件结果都精确核验后，批准I18普通启动与实际业务验收。初次启动或任一stage结果未知先停在隔离状态；要恢复文件必须有明确恢复批准和已评审执行器，当前不能以手工覆盖掩盖UNKNOWN。

上述步骤不是执行命令或当前授权。全套真实输入未具备前不安装、不签发、不清旗、不启动。准备清单阶段不要求重新跑GitHub；仅在存在明确远端验收目的且单独授权时用CI。

## 证据和deferred gates

R5的25/23/15及复评REPRODUCED均保留原来源；R6新22/29/23/17仅覆盖其新source与局部验证。旧terminal、Storage和Identity证据继续按原source/run/SHA/范围保留，不能自动批准新代码或真实target。真实Native全结构、真实TLS系统/内置浏览器信任、真实账户/发布旅程、OS崩溃/带外撤权下已入场事务、完整enabled/生产gate仍未签收；PNG/Runtime/AI维持既有deferred范围。

本页已接无凭据元数据观察；没有读取真实认证/config/HBA/receipt或运行SQL，也未改变现有UNKNOWN/RESERVED状态。


## 本轮已收集与下一包

见[LOCAL元数据原件](evidence/m5-real-inputs-metadata-r6-local.json)：工具版本、目录stat、固定pg_control头和监听；不含凭据/SQL连接。实际55433当前shut down，不能继续运行中profile/ledger/CLOSED采集，也没有自动启动。

已准备[受控启动与只读采集方案](zhiban-v2-m5-readonly-startup-plan.md)，并完成[执行器本地验收](zhiban-v2-m5-management-observer-local.md)：仅私有管理socket、postgres管理库、固定READ ONLY catalog采集，TCP关闭，既有隔离保持；disposable PG16 33/33及静态11组PASS。源码为observer独立inventory e776806c…66030，不替代R6源。真实config/guard读取、认证staging/authority与具体目标参数仍PENDING，真实执行未授权。

2026-10-14已完成[签名/guardian/配置闭包复评](zhiban-v2-m5-management-observer-review.md)，OR-01–04四项P2复现、真实执行BLOCKED。用户回复“保留待补”；[本轮未签输入更新](evidence/m5-management-observer-real-inputs-review-r1.json)仅补复评gate、已知source/公开二进制核验，actual control/auth/authority与真实摘要继续null，没有采集真实私有输入。

后续已完成[OR-01–04修复及守锁终态](zhiban-v2-m5-observer-or-fix-local.md)：独立source447a2b38…c0869、本地51/51、静态12组；原e776…证据及未签包不重绑定。新增authenticationStageDirectory/privateAuthenticationStaging必须明确审核，原pgpass/DB密码不写；未知custody由永久HOLDING guardian或resident父保留。

下一包复评两个本地授权、永久hold/迟退出/resident、认证快照清理及来源边界。[本轮未签实际包](evidence/m5-management-observer-real-inputs-or-fixed.json)已换source/schema，真实路径/hash/读取和生命周期授权仍按“保留待补”保持null，不读取原私有目录来自动拼装凭据。暂不生成安装/签发/clear批准或ordinary配置。独立expected/shadow仍单独来源，metadata不能填充这些凭据。
