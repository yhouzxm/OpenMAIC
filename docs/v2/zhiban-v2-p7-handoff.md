> 2026-10-27 更新：[Ubuntu／PG18 本机交付与恢复验收](zhiban-v2-ubuntu-pg18-local.md)及[本轮制品／pin／结论](evidence/p7-handoff/pg18-20261027/closeout.json)为最新候选。数据迁移／恢复与 Identity 探针通过；PG18 全量应用仍被冻结 PG16 契约阻断，不能称为生产可部署。下文 10-26 包保留历史范围。

# P7 统一持久化交付

2026-10-26，沿原 P1–P7 一次合并近期原生备课、完整文档／资产、AI 课堂、自主 PBL、归档恢复、多模态服务、管理员运行中心及可信结果。OpenMAIC 1.2.1，官方 pin `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`，Git 基线 `093b4a69af96626010d9104c50d680d9b9dc1928`；既有 dirty 候选全部保留，HEAD 不能代替源码 manifest。

## 入口、账号与保存

[3461 工作台](https://127.0.0.1:3461/zhiban)，沿用王管理员／周老师／陈同学三角色合成账号。完整 ID／密码只读取 `info` 指向的本机 0600 `accounts.json`。不在源码包、聊天或公共文件交付账户、数据库、TLS 私钥或实例密钥。

```sh
pnpm trial:zhiban:info
pnpm trial:zhiban                 # 未运行时恢复原三库与账号；正常启动不重跑验收
pnpm trial:zhiban:backup
pnpm trial:zhiban:backup:verify
pnpm trial:zhiban:stop             # 正常保存成功后才清理 owned root
```

[操作指南](zhiban-v2-trial-guide.md)、[本机恢复](zhiban-v2-persistent-local.md)、[独立安装／恢复命令](zhiban-v2-portable-install-local.md)。不与当前实例并行启动同端口 disposable／恢复实例。

## 本次一次纳入的范围

| 完整能力 | 当前交付与证据边界 |
| --- | --- |
| 原 P1–P7 教学业务 | 既有教务、三角色、导入、课程、测验、成绩／总评申诉、进度先修、讨论、分析支持、六维／EMA、校内成果和受限服务评分保留原各包证据 |
| 原生备课／编辑／资产 | 原生 Workspace／SDK／Agent、完整课件与固定资产采用发布；真实生成首轮异常及来源恢复如实保留 |
| 原生 AI 课堂／自主 PBL | 固定发布播放、问答／白板／圆桌、Instructor／Simulator／Evaluator、本人历史与报告；私人状态不等于全班共享或正式分数 |
| 六格式归档／恢复 | MAIC、PPTX、互动 ZIP、离线 HTML、Markdown／DOCX；MAIC 完整／PPTX 静态副本恢复，学生历史不导入；实验视频未启用 |
| 资料与多模态服务 | 已接课程服务状态、解析／生成／语音适配、素材采用发布；无外部配置的实际调用继续待验 |
| 管理员服务与运行中心 | 原生配置、状态、连接检查、空间用量、审计；默认部署 lock=all／allowUserKeys=false 未解锁 |
| 完整课堂与可信结果 | 固定 Quiz／PBL／反思 → 原 Attempt／显式正式提交 → 原教师评分／原完成规则；教师显式共享／撤回小结，Tutor 受限读取／检索；AI 练习分不自动变正式分 |
| 实验与持久化 | 既有 LEARNER_REPORTED 报告和 DC／RC SERVER_CALCULATED_SIMULATION 保留来源；新 Native 任务／凭据、归档资产、服务配置／审计及实例密钥均纳入三库与私有文件恢复 |

[证据索引](zhiban-v2-p7-delivery-index.json)固定各原 receipt 的 hash、原适用范围和集中待办。当前源码与各历史 receipt 的共享文件差额见包外 `evidence/p7-handoff/recent-native-20261026/evidence-applicability.json`。本轮只做交付、隔离恢复及相关只读入口核对，不重跑课堂／模型／解析／整套 PG 或 GitHub CI。

## 两类制品，分开交付

源码包：`node scripts/zhiban-handoff.cjs pack`；独立校验 `node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz`。包含 `HANDOFF.json`、逐文件 SHA256、源码 archive 和校验结果，适用已有可信 checkout。独立安装包：`node scripts/zhiban-portable.cjs pack /新的私有目录/install-kit`，额外携带两棵 shallow Git anchors 和 bootstrap，可在全新源码目录 frozen install。两者不含 node_modules、运行数据库或主机模型配置。

实际 versionId／sourceDigest、安装 pin、私有恢复包 pin、目录、隔离恢复和最终状态统一在包外 [本轮 closeout](evidence/p7-handoff/recent-native-20261026/final-closeout.json)，不把归档 hash 写回归档内部制造自引用。结果以 closeout 为准，旧包不覆盖。

私有恢复包含合成数据库／账户／授权材料、开发 TLS 私钥、Native 文档／资产／资料／用量、管理员审计与实例密钥。**数据库内如保存了加密服务提供者凭据，它们也在快照中；实例密钥与数据库一起交付即具有解密能力，必须同等私密保管。** 源码包不含这些。主机 `.env.local`／`openmaic.yml`、扫描／解析 profile 与 pin 仍独立受控配置，不自动复制。使用外部 `OPENMAIC_SECRET_KEY` 的主机必须另行保管并在目标提供同一密钥，不能指望文件快照替代环境密钥。

物理恢复仍限定 Linux x64 LE／PG16 同版本字符串、相同内部 `/tmp/zhiban-trial-content-*` 根与私有 socket 56517、HTTPS 3461。允许源码／状态安装目录不同；拒绝覆盖、链接、错 pin 和部分成功 receipt。当前不是 PG18 迁移工具，阿里云 PG18 需另做逻辑迁移／适配验收，不能直接导入 PG16 数据目录。

## 集中剩余与后续

- 旧 Native 维护 control／独立 pgpass／公钥 pin／同代签名未齐，CREATE／APPEND／COMPLETE 与 UNKNOWN／RESERVED 保持隔离；真实仪器未配置，不称实测。
- Office／OCR／音视频解析、图像／视频生成、TTS／ASR 和视觉模型的真实服务验收待输入；不阻塞已交付无依赖能力。
- 历史真实 GitHub Ubuntu VM run **40096542805 PASS** 保留其旧冻结包范围；本轮 LOCAL 包不冒充同 SHA／同 source 远端签收，也没有新运输授权或 CI。
- 长期主机、PG18／生产部署、真实账户／首密渠道与数据、无人值守 EMA／分布式评分容量、物理断电及延期的原生关闭／刷新验收集中保留。PLC 专用站点仍排除。

本轮不提交、不推送、不运行 CI、不部署生产。下一阶段按目标主机与真实服务输入做部署／依赖验收，不再重做已完成移植或逐入口 P7；常规配置交付建议 GPT-6.1 Sol / medium，PG18／跨 Identity 授权及新恢复并发用 high。
