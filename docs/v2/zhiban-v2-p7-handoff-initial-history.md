> 历史归档：初次P7交接，原sourceDigest、实例及证据范围保持；当前交接见[zhiban-v2-p7-handoff.md](zhiban-v2-p7-handoff.md)。

# P7 统一试用版本与交接包

2026-10-23，LOCAL 当前可用范围的交接包。统一入口为[3461 工作台](https://127.0.0.1:3461/zhiban)，操作只认[当前指南](zhiban-v2-trial-guide.md)与实时 `pnpm trial:zhiban:info`。历史分包 receipt 保留原 SHA／source／scope；不把它们重标成当前全量验证。

> 后续 P3 [受限跨页成绩簿CSV](zhiban-v2-gradebook-export-local.md)已加载新3461实例；下述已生成源码包保持原摘要，未包含该增量。运行入口与演示账号只认当前info。

## 版本与交付物

Git 分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，大量既有 dirty 候选保留。集成官方 OpenMAIC **1.2.1**／`e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`，不是声称上游今天的最新版。**单独 checkout HEAD 不包含本地交付功能。** 真正可复核的源版本为交接 manifest 的 `versionId`／`sourceDigest`／逐文件 hash。

| 交付物 | 用途 |
| --- | --- |
| 根 TRIAL.md | 单一当前入口、账号读取与生命周期，旧记录归档 TRIAL-HISTORY.md |
| 当前指南／入口交接 | 三角色路径、精确默认命令、专项区别、配置及故障处理 |
| scripts/zhiban-handoff.cjs | status／pack／verify；只读现有状态或生成本地源码快照，不安装／停机／迁移 |
| source.tar.gz | 受控文件集合的 source/ 与 HANDOFF.json；包含当前未提交实现 |
| HANDOFF.json／SHA256SUMS／VERIFY.json | 源版本、逐文件大小／mode／SHA256、排除项及归档校验 |
| [本轮证据目录](evidence/p7-handoff/final-closeout.json) | 当前运行、三角色旅程、工具负向检查、打包结果及适用范围 |

```sh
node scripts/zhiban-handoff.cjs status
node scripts/zhiban-handoff.cjs pack
node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz
```

源码包默认写入当前用户的 `~/.local/share/zhiban-handoff/<versionId>/`，不是 Git 提交或远端发布。打包只读 Git tracked／non-ignored 候选，排除 node_modules、临时构建、私有 env／openmaic.yml、密钥、dump、账号文件、运行 PID／demo metadata、日志及本轮自引用证据目录。敏感 JSON、填入实值的 env example 或完整私钥材料拒绝导出；symlink 一律拒绝读取。两次读回 hash 与 HEAD 稳定性检查后才压缩。校验不提取归档，拒绝路径越界、symlink、重复条目、超限及条目／hash 不匹配；hash 一致本身不代表信任任意来源或生产审批。

源码快照保留例子／静态受信 profile 与公开文档，**不含 Git 历史、依赖、数据库、当前口令、CA 私钥、模型／扫描密钥或审批人员凭据**。原 `.git` 与官方 pin 对象仍是现有构建核验的前提。先在独立目录读回检查；不要未经备份就覆盖已有 dirty checkout。本包支持当前约定路径 `/home/zxm/openmaic/zhiban` 的既有可信 checkout 源交接；部分本地 expected profile 绑定绝对路径，换路径／换主机需重新构建相应本地受信参考和证书，**未完成独立干净主机安装／跨主机恢复演练**。源码身份可复核不等于零配置部署包。

## 环境与账号交付

| 项目 | 当前约定／验证边界 |
| --- | --- |
| 工具链 | Ubuntu PG16、Node22、pnpm10.28.0；本轮 status 记录实际版本 |
| 启动 | `pnpm trial:zhiban`，默认 --unified-trial --serve；已有实例先接续，不为交接重建 |
| 状态／停止 | `pnpm trial:zhiban:info`／`:stop`，复用原 PID／argv／owner／hash 守卫；本轮不执行 stop |
| 数据 | owned 私有 socket PG16 56517，业务／Content Native／Lesson Native 三库；停止删除此实例，新启不是恢复 |
| 开发 TLS | 本机 `/home/zxm/.local/share/zhiban-m1/receipt.json` 与受信开发 CA／证书；不绕过浏览器警告，不随包交付私钥 |
| 三角色账号 | info 给出当前完整 UserId 与0600 accounts.json 路径；密码只由本机 owner 私下读取，不写进交接包 |
| 模型 | 普通启动可无模型；本机已有私有模型 wrapper 可按运营者配置使用，包含密钥的配置不分发；本轮不重新调用真实 AI |
| 扫描 | 当前 scanner 为 UNAVAILABLE，旧 pin 漂移未修；新扫描附件／教学资源上传保持关闭，不用合成扫描冒充 |
| 生产／维护 | 55432／55433、完整 Native Runtime、维护恢复／真实审批输入不在此包启用范围 |

同一浏览器标签和127.0.0.1不同端口共享 Cookie，切换角色先退出。新环境中无预先确认的 `@标识`，应走独立提名／本人确认，不把学号或邮箱当账号。用户密钥与真实入驻来源不得用源码包替代。

## 当前功能范围与未决边界

| 类别 | 已交付 LOCAL | 当前剩余／门禁 |
| --- | --- | --- |
| 教务与账户 | 三角色工作区、课程／学期／行政班／教学班、任教／成员／Enrollment、目录、七类导入与批次、独立开户／首密／全局启停／@标识 | 真实实名／审批人员／交付渠道、外部目录同步、头像；旧用户管理URL未全量兼容 |
| 课堂与内容 | 章节单元、固定发布文本／PNG、原生PPT只读、自包含HTML互动、基础派发、Attempt关联、课堂结果／历史 | 完整 Native Runtime、更多互动／实验、可信完成规则各有原 gate；阅读／浏览器事件不记成绩 |
| 作答与成绩 | 文字／三题型测验、次数／截止／重交、人工评分／发布／更正、当前页CSV、教师统计／本人概览 | 新扫描上传目前关闭；其他附件／解析格式需服务；跨页导出、课程总评与申诉未齐或待规则 |
| 讨论与支持 | 主题回复／关闭／隐藏恢复、人工跟进结案、站内提醒回执、补救、规则私有审阅、概念纠错、证据型观察／本人纠错 | 画像维度、PBL／EMA／AI Peer 继续 REVIEW；不自动贴能力标签／处分 |
| AI | 原生文字备课采用发布与课程文字Tutor已有独立真实旅程 | 当前包不重验真实模型；工具型／多模态／跨课程与更多Agent用途未批准或待配置 |
| 页面迁移 | 当前已交付页面可用；新版满足时不复刻旧像素 | 55旧page／6layout是追溯清单，**不是已全量验收计数**；剩余旧路由与高级页面见矩阵 |

主线仍为[原P1–P7](zhiban-v2-migration-completion-plan.md)、[36能力](zhiban-v2-feature-gap-matrix.md)和[55旧路由](zhiban-v2-ui-page-gap-matrix.md)。本轮纠正已实现功能仍被旧行写成“未交付”的描述，同时保持“功能已有”和“旧URL已映射”两种事实分开；没有用统一工作台代替缺失高级业务。

## 本轮统一验收与已知限制

在原运行实例，不重建数据库：管理员检查当前导入／教务导航；教师真实新建、保存并发布“P7 交接：安全巡检讲义”；学生读取同一发布并完成安全巡检首次尝试／提交v1；教师评分并显式发布 **93/100**；学生回看同一公开分数与反馈。[三角色记录](evidence/p7-handoff/three-role-journey.json)和[学生截图](evidence/p7-handoff/student-result.png)绑定本次 source/root。旧88分保留，当前平均90.5%是两项活动的未加权均值，**不是课程总评**。

本轮只验这一代表性跨模块旅程及交接工具边界，未重新扫描／生成／导出／运行整套PG16基础或GitHub CI；新增工具不改变现有业务、ACL或migrations。未把当前旅程说成全部55旧路由或所有历史分包重验。

已知限制：附件区仍有“合成样例模式”的旧提示，实际新扫描上传保持拒绝；以当前 scanner gate 为准。原生刷新／关闭未保存保护按此前用户指示延期，仍先显式保存。纯源码包不是持久数据备份；本轮不声称恢复演练或生产可用。

P7 本次完成的是**当前 LOCAL 可用范围的统一交接包**；全项目／生产／未批准高级范围并未全部完成。当时安排的下一包 **P3 课程成绩簿受限跨页导出**现已按[独立LOCAL包](zhiban-v2-gradebook-export-local.md)交付；不扩展上述P7原证据与源码包。当前执行顺序只认主计划。
