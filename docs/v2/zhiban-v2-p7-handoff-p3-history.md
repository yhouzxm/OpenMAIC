> 历史交接：本页固定为跨页CSV／PNG头像增量的原说明，不表示当前入口覆盖或当前运行结果。当前版本见[统一交接](zhiban-v2-p7-handoff.md)。

# P7 统一试用版本与交接包

2026-10-23，LOCAL 增量交接：纳入 **P3成绩簿受限跨页导出＋本人PNG头像与管理员目录展示**。统一入口为[3461工作台](https://127.0.0.1:3461/zhiban)，当前账号、动态ID和source漂移只认 `pnpm trial:zhiban:info`。本轮不停止或重建运行实例，不执行业务写入、完整课堂、模型、扫描或GitHub回归。

> 后续个人设置旧路由增量见[LOCAL包](zhiban-v2-personal-settings-routes-local.md)；本页已生成的7b5fc1a08e0d源码包保留原hash，未包含该后续增量。

## 当前交付物与源版本

分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；既有dirty候选保留。集成官方OpenMAIC **1.2.1**／`e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`，不声称这是上游今天的最新版。**单独checkout HEAD不包含本地功能**，新包身份以外置HANDOFF.json的versionId／sourceDigest／逐文件hash为准。

| 交付物 | 用途与范围 |
| --- | --- |
| TRIAL.md／当前指南／入口交接 | 当前3461、三角色入口、账号交付、生命周期及专项命令 |
| scripts/zhiban-handoff.cjs | 现有status／pack／verify，只读状态或生成本地源码快照 |
| source.tar.gz＋HANDOFF.json | 当前dirty源、文档、受信参考和可分发LOCAL证据；含两个P3增量 |
| SHA256SUMS／VERIFY.json | 归档hash、条目集及逐文件读回检查 |
| [本轮closeout](evidence/p7-handoff/p3-increment/final-closeout.json) | 新包位置、摘要、增量覆盖、源／证据边界及当前运行核对；本目录排除打包以免自引用 |
| [初次P7归档](zhiban-v2-p7-handoff-initial-history.md) | 初次源码包及旧三角色课堂的历史范围，不是当前实例结果 |

```sh
pnpm trial:zhiban:info
node scripts/zhiban-handoff.cjs status
node scripts/zhiban-handoff.cjs pack
node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz
```

打包产物写入 `~/.local/share/zhiban-handoff/<versionId>/`，旧包不覆盖。pack两次稳定读取受控文件并确认HEAD，拒绝symlink、完整私钥、敏感JSON和实值env example；排除Git历史、node_modules、临时构建、私有配置、密钥、数据库dump、运行账号／PID元数据和自引用P7证据目录。verify只读归档，不提取，核对安全条目集合、大小、文件hash及manifest摘要。hash核对不授予任意来源或生产权限。

源码包不含数据库、当前口令、CA私钥、模型／扫描密钥及真人审批凭据，也不是数据恢复包。支持当前约定路径 `/home/zxm/openmaic/zhiban` 的既有可信checkout源交接；还需Git官方pin对象、Node22／pnpm10.28.0／UbuntuPG16、重建依赖与本机受信CA／expected profiles。换路径／换主机需重建绝对路径绑定参考；**未验证干净主机安装或跨主机恢复**。

## 两项新增功能与操作

| 功能 | 使用入口 | 明确边界 |
| --- | --- | --- |
| [成绩簿受限跨页CSV](zhiban-v2-gradebook-export-local.md) | 教师课程→成绩簿→先查询学生→按查询条件跨页导出CSV | 全匹配当前在班学生×当前发布正式活动；限500人／100项／10,000条／8 MiB，超限整体拒绝；未查询输入不改变范围，原当前页导出保留；无总评／申诉／历史名册 |
| [本人头像与目录](zhiban-v2-avatar-local.md) | 个人资料与账户→选择PNG→上传；可替换／移除；管理员原成员目录查看 | PNG≤96×96／12 KiB；独立CAS与幂等，保留未保存文字；本空间本人及受限管理员可读，无公开URL／跨空间同步／JPEG／裁剪 |

头像新增 `0002_avatar.sql` 与两migration绑定的expected profile；现有0001及其他既有migration未改。只在新owned disposable PG16应用；本轮P7不对现存或真实数据库执行安装／迁移。旧库缺0002时loader拒绝启用，不能把新reference套在旧catalog上。

## 当前环境与证据链

- UbuntuPG16私有socket56517，业务／Content Native／Lesson Native三库；HTTPS3461使用本机受信开发CA。不触碰55432／55433。
- 普通启动 `pnpm trial:zhiban`，常规启动与验证分离；本轮接续现有实例，sourceMatches=true／漂移0。当前进程／root绑定见[status](evidence/p7-handoff/p3-increment/status-after.json)。
- 账号只从info指向的0600 accounts.json私下读取，不进入源码包或聊天。三角色为王管理员／周老师／陈同学；切换角色先退出，同一127.0.0.1不同端口共享Cookie。
- 停止删除owned实例数据，新启动生成新账号和合成课堂，不是恢复；本轮没有新增数据备份或恢复演练，历史私有备份只保留原范围。
- 当前只读核对：真实教师会话获取跨页CSV并读回公开88分／6条记录；学生本人头像与管理员目录为同一64×64合成PNG，学生目录访问403，见[结果](evidence/p7-handoff/p3-increment/current-p3-readonly.json)。登录建立会话，未更改业务数据。
- 跨页导出的两轴／超限／撤权／浏览器下载证明沿用[独立包](zhiban-v2-gradebook-export-local.md)；头像的上传／替换／移除／CAS／授权／实际解码沿用[独立包](zhiban-v2-avatar-local.md)。共同harness／package和当前文档在后续增量变化，不把旧receipt重签为当前全量回归；本轮单列关键产品文件hash覆盖与差异。
- 初次P7的93/100课堂属于旧root与旧source，**不是当前课堂数据或本轮重验**。[旧closeout](evidence/p7-handoff/final-closeout.json)和旧源码包保留原摘要。本轮只更新交接和只读核对。

## 可用范围及deferred gates

当前已交付范围包括：三角色课程工作区与分页教务／七类导入、空间成员与受控账户操作、章节编排／固定发布文本PNG与原生PPT／离线HTML、学习测验／基础课堂Attempt关联、人工评分发布更正／成绩簿当前页及跨页CSV、讨论／提醒／补救／证据观察、本人资料头像及受限目录、原生文字AI备课和课程文字Tutor。

仍待或受限：scanner pin漂移，新扫描附件／资源上传关闭；Office／OCR／音视频解析服务；完整Native Runtime及维护恢复；真实身份核验、运营审批与交付渠道、外部目录同步；未映射旧URL；画像维度／PBL／EMA／AI Peer REVIEW；课程总评／申诉规则；用户已延期的原生刷新／关闭未保存保护。附件面板旧“合成样例”措辞仍以实际scanner gate为准。阅读、HTML事件及聊天不自动计正式成绩。

PNG头像格式治理不等于通用杀毒扫描；AI配置存在不等于本轮重新验证真实模型。55旧page／6layout是追溯清单，不是全量签收计数。全项目／生产和未批准高级功能均未签收。

本轮完成当前LOCAL交接源版本更新；commit／push／CI、真实库迁移和生产部署另按明确授权。下一完整工作建议沿原P1/P3处理已有个人设置功能的旧路由兼容包，先核对实际映射再接线；建议GPT-6.1 Sol / medium。
