# P7 合并交接包

2026-10-24，LOCAL 未提交候选，一次合并原 P1–P7 已交付范围。上游 OpenMAIC 1.2.1，固定 pin `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`。Git HEAD 只是基线，不能代替包含 dirty 候选的逐文件源码 manifest。

## 统一入口与使用

[3461 工作台](https://127.0.0.1:3461/zhiban)。三角色继续使用原合成账号；密码只从 `info` 指向的本机0600账户文件读取，不进入源码交接包。没有新的关机安排。

```sh
pnpm trial:zhiban:info
pnpm trial:zhiban                 # 未运行时启动；恢复同一批账号及历史
pnpm trial:zhiban:backup          # 私有三库一致快照
pnpm trial:zhiban:backup:verify
pnpm trial:zhiban:stop            # 保存成功后才清理运行root
```

详见[操作指南](zhiban-v2-trial-guide.md)和[持久化与恢复](zhiban-v2-persistent-local.md)。默认持久化与显式 disposable 验证分开；不在运行实例旁启动占用相同端口的完整验证。

## 合并范围与证据

| 原批次／完整包 | 本地交付内容 | 证据边界 |
| --- | --- | --- |
| P1–P3／P5–P6 原教学业务 | 三角色、教务与七类导入、目录／学习、测验、成绩／总评申诉、进度先修、讨论、跟进、Tutor、AI备课、旧入口兼容 | 原页面／能力矩阵和各产品receipt，不新增全量签收 |
| P3 资源与附件 | 本地文本／CSV／文本PDF解析、真实扫描附件、课程归属与发布／查看／提交 | Office／OCR／媒体真实服务未配置；每文件仍1MiB |
| P4 课堂与实验 | 固定版本教案、生命周期与先修、人工实验报告、原评分与历史 | 实验测量为 LEARNER_REPORTED；真实Native自动执行未启用 |
| P6 PBL／AI Peer | 小组共享修订、全员确认共同提交、教师评价；私人AI学习伙伴 | 默认PBL是单学生演示，多人证明来自独立fixture；伙伴不是同学或正式成绩依据 |
| P5 六维／EMA | 描述型证据维度、固定来源真实模型分析、教师采用／拒绝、本人纠错 | 缺证据不编分；EMA由教师显式执行，不作心理诊断或无人值守干预 |
| P3 校内成果／服务评分 | 可撤销校内证书、课程等价与跨班去重学分、固定规则受限服务正式AI评分 | 不含外部资质／跨校；首次TEXT／适用测验评分，保留人工更正与申诉，不覆盖已有成绩 |
| P7 持久化与归档 | 同机三库备份／恢复、账号及历史保留、源码manifest／独立归档校验 | 同机同路径；源码归档不含数据库、密钥、依赖及Git历史，不替代换机部署 |

机器可读的[交付证据索引](zhiban-v2-p7-delivery-index.json)固定每项receipt的SHA256、默认演示入口和适用范围。既有PG16、真实模型、浏览器及恢复证据沿用其原source范围；后续展示差异仍按各closeout记录。本轮只执行交接相关检查，没有重跑课堂、模型、PG整套或GitHub CI。来源统一 LOCAL，不伪造 GITHUB_ACTIONS。

## 制品、配置与复现

生成：`node scripts/zhiban-handoff.cjs pack`；独立校验：`node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz`。制品含 `source.tar.gz`、`HANDOFF.json`、`SHA256SUMS`、`VERIFY.json`。最终版本号、实际目录及归档hash见包外 `evidence/p7-handoff/consolidated-20261024/final-closeout.json`，避免归档自引用。

适用已有可信Git checkout的同路径源码恢复；需 Node22、pnpm10.28.0、Ubuntu PG16、可重建依赖与本机受信TLS。先核对归档，再由操作者在保留现有dirty内容的副本中恢复；不要直接覆盖运行中的工作区。源码包不能单独创建Git历史、重建可信receipt或恢复私有数据库。

模型0600配置、扫描profile与pin、TLS密钥、账户、PG快照独立私有交付；包内示例只含占位值。真实扫描／模型每次使用仍按当前授权及配置验证，历史成功不自动启用新操作。未修改已应用迁移，不提交／推送／CI或生产部署。

## 集中剩余边界

1. 真实 Native 课堂／自动实验／可信事件：维护control、独立pgpass、可信公钥pin及同代receipt尚缺；UNKNOWN／RESERVED隔离保持。
2. Office／OCR／音视频真实解析：缺实际服务配置；无依赖内容及下载不受此阻塞。
3. 换机独立安装、真实身份／首密交付及目录运营、容量／生产部署、物理断电恢复未签收；最新物理备份完整性不代表该代已跨机恢复。
4. 无人值守EMA、分布式正式评分及生产吞吐不在本地首包签收内。服务评分提交期短暂Identity共享表锁有保守写入阻塞，不能据本地结果宣称生产容量。

用户延期的原生刷新／关闭复验继续作为明确验收缺项；PLC专用模拟器仍排除。下一完整功能是满足可信输入后的Native课堂／自动实验包，建议 GPT-6.1 Sol / high；配置交付与普通整合建议 medium。
