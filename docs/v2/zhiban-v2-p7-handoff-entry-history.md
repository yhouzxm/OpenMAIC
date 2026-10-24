> 后续源码增量：[三条普通入口批量包](zhiban-v2-ordinary-entry-batch-local.md)已完成并修正两项检查。**本页a6ef3a535563归档及P7证据仍固定原hash／范围，不含该后续增量；本轮未重打包。** 下文失败描述保留归档时事实，不表示后续源码仍失败。

# P7 统一试用版本与交接包

2026-10-23，LOCAL源交接更新，纳入此前跨页CSV／PNG头像及**七组已完成旧入口增量**。统一入口：[3461工作台](https://127.0.0.1:3461/zhiban)。当前账号、动态ID与运行漂移以 `pnpm trial:zhiban:info` 为准。本轮接续运行实例，不停止／重建、不改业务数据、不重跑完整课堂、模型、扫描或GitHubCI。

## 当前源版本与交付物

分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；既有dirty候选保留。应用集成官方OpenMAIC **1.2.1**固定pin `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`，不声称这是今天最新版本。**仅checkout HEAD不能重现本地产品。** 当前包身份由外置HANDOFF.json的versionId、sourceDigest、逐文件hash与归档SHA256共同确定，精确值见[本轮closeout](evidence/p7-handoff/entry-increment/final-closeout.json)。

交付目录为 `~/.local/share/zhiban-handoff/<versionId>/`，含 `source.tar.gz`、`HANDOFF.json`、`SHA256SUMS`、`VERIFY.json` 与本轮 `P7-EVIDENCE/` 旁包。归档内为当前dirty源码、文档、公开LOCAL证据及受信参考；P7自引用证据目录、运行metadata、账号口令、密钥、模型私有配置、dump、日志、Git历史、node_modules和临时构建不进入源码归档。P7旁包提供归档结果、入口覆盖、旧证据适用范围、前后运行状态与最终closeout，补足源码归档有意排除的P7证据。

pack沿用现有稳定双读、HEAD检查、symlink／完整私钥／敏感JSON／实值env example拒绝；verify只读归档，不提取，独立核对条目集、大小及逐文件hash。本轮再逐文件比对当前工作区、七组入口必要文件和运行源码覆盖。hash正确不代表生产权限、干净主机安装或所有历史测试在当前source重跑。

```sh
pnpm trial:zhiban:info
node scripts/zhiban-handoff.cjs status
node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz
```

需要另一个独立源快照时才运行 `node scripts/zhiban-handoff.cjs pack`；旧版本目录不覆盖。[上次CSV／头像交接](zhiban-v2-p7-handoff-p3-history.md)的 `7b5fc1a08e0d` 包与[初次P7](zhiban-v2-p7-handoff-initial-history.md)各保留原hash／证据范围，均不含此后的入口增量。

## 本次纳入的全部已完成入口增量

| 功能包 | 入口与保留边界 |
| --- | --- |
| [个人设置](zhiban-v2-personal-settings-routes-local.md) | student/settings、teacher/profile复用本人资料／头像／安全；学习画像不混入设置 |
| [全局成绩](zhiban-v2-global-grades-routes-local.md) | teacher/grades、student/grades复用受限课程选择与原课程成绩；无总评／权重／申诉扩张 |
| [管理员／登录](zhiban-v2-admin-login-routes-local.md) | admin、admin/users、login接原管理员目录和固定同源登录返回；不恢复删除／代重置密码或业务编号凭据 |
| [画像与风险支持](zhiban-v2-support-routes-local.md) | 师生全局入口和课程profiles／analysis／risks／support复用证据、审阅、提醒、补救；学生不读教师私有风险，维度REVIEW |
| [教师AI备课](zhiban-v2-authoring-routes-local.md) | teacher/agents及课程内agents替代为原生生成→采用→发布；旧干预Agent／监控／Peer未恢复 |
| [学生AI工具](zhiban-v2-student-tools-routes-local.md) | 课程tools复用原Tutor，student/tools提供受限选择；原tutor与旧tools共用本人历史，教师开关不变，Peer关闭 |
| [课程设置／任教名单](zhiban-v2-course-administration-local.md) | 课程settings只读引用版本配置并连接原教学设置；teachers只读本教学班关系／姓名分页，非同事有效Identity授权目录，基础配置仍由管理员维护 |

跨页CSV仍限500人／100项／10,000条／8MiB，原当前页导出保留。本人PNG头像仍限96×96／12KiB、本空间本人及受限管理员读取。未映射或未批准页面仍按主计划矩阵保留缺口；“全部入口增量”指上表已完成包，不是所有旧URL或全项目移植签收。

## 当前运行与证据适用范围

UbuntuPG16私有socket56517、业务／Content Native／Lesson Native三库；HTTPS3461使用本机受信开发CA。不操作55432／55433。本轮保留同一root及进程、前后sourceMatches=true／漂移0；[前后状态与只读入口核对](evidence/p7-handoff/entry-increment/final-closeout.json)单列。不执行账户、角色、名册、辅导开关、任务、提交、评分或发布命令；登录只建立原Identity会话。

账号仅从info指向的owner-only accounts.json交付，不进入源码包或聊天。停止会删除本次数据；普通启动 `pnpm trial:zhiban` 创建新账号和新合成课堂，不是恢复。已有实例时勿重复启动／专项占用同端口。普通启动不保证加载当前私有模型wrapper；源码包不带模型／扫描凭据。

各功能包旧浏览器／PG16／真实模型证明保持原root／source／run范围。[适用范围对照](evidence/p7-handoff/entry-increment/evidence-applicability.json)逐一列出旧sourceHashes相对当前的未变／变化文件；共享harness、课程壳和文档变化不被隐去，不重签旧receipt为当前全量回归。个人设置旧receipt曾断言画像URL404，该断言现已被后续画像入口交付取代，旧receipt保留历史含义。当前只读核对不替代原写入、撤权、并发、模型或扫描证明。

当前新合成课堂没有保证预置所有旧演示的讲义、头像、提醒或观察；历史93／96分和头像截图不作当前数据。最近任教反向验证已恢复ACTIVE关系，revision及valid_from按原命令推进，不是回滚历史。已读快照不保证他处撤权瞬间从浏览器消失。

## 已知检查待办与deferred gates

以下**未解决，也未签为全绿**：

- 原workspace测试文件8通过／1失败：旧 `/admin/import/registrations` 断言期待 `/roster`，当前未映射。是否补该别名需核对当前多类导入职责，不改断言掩盖差额。
- 全量build类型检查TS2353：原verifyOnboarding调用传入Input未声明的store参数。受影响Workspace依赖闭包类型检查及查询／cursor定向验证通过，不等于全量类型通过。
- scanner pin漂移，新扫描附件／资源上传关闭；Office／OCR／音视频解析服务未配置；完整Native Runtime及维护恢复输入／门禁保留。
- 真实身份核验、账户运营审批／交付渠道、外部目录同步、换主机安装及数据恢复演练未完成。
- 画像维度／PBL／EMA／AI Peer继续REVIEW；课程总评／申诉规则、剩余旧URL及用户延期的原生刷新／关闭未保存保护另计。阅读、HTML消息和聊天不计正式完成或成绩。

支持当前约定路径 `/home/zxm/openmaic/zhiban` 的可信checkout源交接；还需官方pin的Git对象、Node22／pnpm10.28.0／UbuntuPG16、重建依赖／生成bundle，以及本机CA／expected profiles。换路径／主机要重建绝对路径绑定参考。源码包不是数据库备份、可直接部署的生产制品或独立安装成功证明。

本轮仅更新LOCAL交接版本；无commit／push／CI、真实库迁移或部署。下一完整功能建议：教师课程列表旧入口及现有分页工作区导航收口，先核对真实旧URL职责，复用当前实现。建议 GPT-6.1 Sol / medium。
