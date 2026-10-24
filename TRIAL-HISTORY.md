> 2026-10-23 原 P3：[多类教务导入与批次结果](docs/v2/zhiban-v2-academic-imports-local.md)接默认3461。管理员导航“教务批量导入”可选择学期、课程草稿、行政班、教学班、正式档案、行政班成员与Enrollment；预览后显式确认，逐行原子、失败后停止，原批次持久回看及下载。不开新账户、不自动授角色／发布／恢复关系。当前结果、默认实例及重要边界见产品包最终记录。

> 2026-10-23 原 P3：[受控登录标识与目录映射](docs/v2/zhiban-v2-login-identifiers-local.md)接默认3461。工作台“本人登录标识”核验平台提名、本人当前密码确认或停用；原登录页支持已确认的@标识，UserId仍可用。管理员成员目录可按@精确查本空间映射；学号／邮箱不作登录。当前LOCAL实际结果及原scanner不可用边界见该文最终记录，不代表生产审批。

> 2026-10-23 续作收口：全局账户启停／目录已完成当前默认CLI＋IAB旅程，学生恢复后新登录可见原课程，旧cookie不复活。当前scanner文件pin漂移尚未修复，新附件／资源扫描上传关闭；普通教学和账户入口继续。此前扫描证据保留原范围，具体见[本包最终记录](docs/v2/zhiban-v2-account-status-local.md)。

> 2026-10-22 原 P3：[受控全局账户启停与目录联动](docs/v2/zhiban-v2-account-status-local.md)已接默认3461。管理员“成员账户目录”显示本空间成员的全局账户状态与查证时间；全局停用／恢复由独立平台CLI处理，网页无global写权限。恢复需要原入口重新登录，旧会话不复活，成员与历史数据保留。当前运行／具体证据见该文最终记录；本轮LOCAL两签名为合成批准，不代表真人审批或生产启用。

> 2026-10-22 原 P3：[普通账户开通与本人首密交付](docs/v2/zhiban-v2-account-onboarding-local.md)已接默认3461。管理员导航“普通账户开通”申请；独立平台CLI开户／交付受限一次性凭证，本人经登录页“新账户首次设密”自选密码，再从原入口登录。初始无空间／角色／课程；后续复用原邀请、本人同意、激活及Enrollment。当前新合成课堂已完成实际IAB申请／首密终态／新账户原入口登录；设密通过真实HTTPS合成接收者执行，未声称浏览器代填新密码。真实实名与外部交付仍待，旧课堂与本轮课堂各有独立三库归档（非恢复演练）。普通启动不变，不跑GitHub CI。

> 2026-10-22 原 P6：[课程 AI Tutor](docs/v2/zhiban-v2-course-tutor-local.md)已接师生课程“AI 学习辅导”。教师默认关闭、明确启用／提示；师生本人私人对话、可选固定已发布文字讲义、连续提问／停止／历史。当前3461真实GLM两轮及刷新已通过；聊天不改成绩、不生成画像，维度REVIEW。当前为新合成课堂，切换前后各有三库归档，不声称恢复旧数据。专项 `pnpm verify:zhiban:tutor` 只测受影响边界；普通启动仍 `pnpm trial:zhiban`，本机已有模型的私有启动见交付文档。

> 2026-10-22 原 P5：[风险规则与教师审阅](docs/v2/zhiban-v2-risk-local.md)。教师课程内“风险规则与审阅”配置启用，命中只供核查，私有审阅后显式登记跟进再接补救。默认规则关闭；学生不接收私有标签或说明。专项 `pnpm verify:zhiban:risk`，当前3461及本机账号以 `pnpm trial:zhiban:info` 为准。上轮临时实例已不在，保留的三库备份不等于本轮新备份或恢复结果。

> 2026-10-22：教师／学生课程新增“学习证据画像”，提供正式来源、教师引用观察、学生本人纠错及教师保留／修订／撤回。维度尚未启用，不自动评分或认证掌握；本包见[交付与证据](docs/v2/zhiban-v2-learner-local.md)。默认仅 owned LOCAL 合成课堂，切换前后归档和来源范围单列，不冒称恢复旧实例。


> 2026-10-22：教师／学生课程导航新增“概念纠错”，按正式发布成绩登记证据，教师明确发布后由学生补充解释、教师复核。测验须先关闭原答案复核；私有依据不公开。见[本包交付与证据](docs/v2/zhiban-v2-concept-local.md)，不计作画像或自动诊断。默认数据以当前 LOCAL 实例为准，旧归档不代表已恢复。


> 2026-10-21 原 P5：[补救计划与学生任务](docs/v2/zhiban-v2-remediation-local.md)。教师从跟进详情“制定／查看补救计划”选择已发布正式活动并发布；学生课程“补救任务”进入原活动并反馈；教师比较基线与真实提交／已发布成绩，记录评估或取消。原截止与次数不变，自报不算完成。专项 `pnpm verify:zhiban:remediation`；当前账号及3461状态以 `pnpm trial:zhiban:info` 为准。

> 2026-10-21 原 P5：[站内提醒与学生确认](docs/v2/zhiban-v2-reminders-local.md)。教师从“教学分析 → 跟进详情”单独撰写学生可见内容；学生课程内“站内提醒”点击“我已知悉”；教师刷新查看回执。私有跟进说明不会发送，每份跟进只允许一条待确认提醒。确认不改作答、成绩或结案。统一3461与账号以 `pnpm trial:zhiban:info` 为准，专项用 `pnpm verify:zhiban:reminders`；本包不发送邮件／短信。

> 2026-10-20 真实AI旅程已完成：GLM-5.3 三页讲义经教师审核修订并发布，学生逐页读取通过，见[实际结果与两个体验待办](docs/v2/zhiban-v2-ai-lesson-real-local.md)。当前3461保留该合成课堂；启动时 metadata 仍是当时未生成的快照，后续结果见独立真实 receipt。三库已备份，未做恢复演练；停止／重建会清理本实例。

> 2026-10-20 v1.2.1 更新：源码与配置说明见[升级记录](docs/v2/zhiban-v2-openmaic-121-upgrade.md)。根目录已有隐藏文件 `.env.example`，原生 Next 启动可复制为 `.env.local`；智伴 LOCAL launcher 不自动加载该文件，请按升级记录显式注入配置。历史运行 receipt 不代表当前进程状态。

> 2026-10-20：教师AI备课接线见[本地交付范围](docs/v2/zhiban-v2-ai-lesson-local.md)。默认3461教师课程“讲义与图片”内提供面板；未配置模型时明确说明并禁用生成，手工备课可继续。专项 `pnpm verify:zhiban:ai-lesson` 仅验证本包，不重复完整课堂。新实例包含第三库 `zhiban_trial_lesson_native`；备份必须包含三库，历史双库备份不含本包生成数据。真实模型尚未配置，不能据夹具证据声称生成成功。

# 智伴 V2 本地试用入口

## 当前 P3 教师课程／教学班授权（2026-10-18）

[3461统一入口](https://127.0.0.1:3461/zhiban) → 管理员“成员账户目录” → “管理空间成员”，选择课程／教学班教师，先“登记任教待授权”，再输入本人密码授予。关系与角色缺一不能教学；课程授权也不自动任教全部班。撤销角色或结束任教后，新访问／写入拒绝；历史事实保留。行政班不是这里的CLASS。

精确范围教师的试用账号及管理链接：`/tmp/zhiban-trial-content-AA7kru/teacher-inputs.json`；普通三角色：`/tmp/zhiban-trial-content-AA7kru/accounts.json`。密码只在本机0600文件，实时来源用 `pnpm trial:zhiban:info`。本次仅6组教师专项和受影响检查，未重跑旧完整课堂、扫描、导出或GitHub；范围、source hash及私有备份见[产品包](docs/v2/zhiban-v2-teacher-scope-local.md)。这是新合成课堂，未冒称恢复旧实例。

默认 `pnpm trial:zhiban` 已与回归分离，不再每次启动重做旧旅程或故障注入。显式 `verify:zhiban:trial` 才跑完整旅程；`verify:zhiban:teacher-scope` 只跑教师包。当前保留受验的教师专项 --serve 实例。普通global开户／首密和真实运营输入仍待，Runtime未启用。下一步复用新版教师AI备课的生成→采用→发布，建议 **GPT-6.1 Sol / medium**；不再拆教师授权小任务。

## 此前 P3 空间成员管理首包（2026-10-18）

[3461统一试用](https://127.0.0.1:3461/zhiban) → 管理员“成员账户目录” → “管理空间成员”。已接已有global User的受控邀请、本人同意、管理员激活，本空间停用／恢复、STUDENT/SELF及他人的TENANT_ADMIN/TENANT管理、原子管理员交接与未知结果确认。Enrollment单独批准；不自动开课。新教师授权、普通global开户／首密、真实入驻审批与生产部署仍未开放。

36组默认统一旅程（含新增5组成员旅程）、58项定向测试通过；运行来源1536项匹配、drift=0。账号私有文件 `/tmp/zhiban-trial-content-faL99P/accounts.json`；额外手工试用输入 `/tmp/zhiban-trial-content-faL99P/member-inputs.json` 已留PENDING邀请，可由该账号登录joinUrl同意，再由管理员审批激活；来源30分钟不自动续期。独立CLI及无活动空间账号加入页登录已验证。LOCAL双key来源为合成运营方，不代表两名真人审批。见[产品包及完整边界](docs/v2/zhiban-v2-membership-local.md)与[最终收据](docs/v2/evidence/zhiban-membership-local.json)。实时状态用 `pnpm trial:zhiban:info`，密码只从私有文件读取。

本轮是新合成课堂；前一导出课堂已在切换前备份，最终双库与成员控制输入另有[交付备份](docs/v2/evidence/member-management/delivery-backup.json)，不宣称恢复旧实例。下一步集中补G3教师CLASS／COURSE关系及作用域消费，建议 **GPT-6.1 Sol / high**。无commit／push／CI dispatch，真实55432／55433及已应用migration未动。

## 此前 P3 已发布单元 PPTX／离线 HTML（2026-10-18）

默认 [3461 统一试用](https://127.0.0.1:3461/zhiban) → 师生课程工作区 → 学习中心 → 已发布讲义／资源单元，可点击“导出 PPTX”或“导出离线 HTML”。PPTX 为可编辑文本＋内嵌 PNG；HTML 下载后双击打开，点击“播放课堂”即可无网络阅读。教学资源按解析正文重新分页，原文件仍由原下载入口提供。活动、测验答案、成绩与草稿不导出；Office／OCR／音视频解析继续待服务配置。

31组统一旅程、师生8次真实下载及4份离线文件播放／场景目录通过；1528项运行来源匹配，drift=0。账号私有文件 `/tmp/zhiban-trial-content-sFuJer/accounts.json`，当前状态以 `pnpm trial:zhiban:info` 为准。内置浏览器已保留受信任登录入口；实际下载和离线文件验证使用普通Chromium。上一material课堂已在重建前完整备份，见[本轮产品包及证据边界](docs/v2/zhiban-v2-published-export-local.md)。

上述导出交付记录保留其当时来源范围；后续空间成员首包见本文顶部。以下数字与账号均保留各自历史范围。


## 此前 P3 教学资源归属与发布（2026-10-18）

默认 [3461统一试用](https://127.0.0.1:3461/zhiban) 已接TXT／Markdown／PDF课程资源：教师从“讲义与图片”或章节“本章上传资源”上传、扫描、复用新版解析并显式发布，返回原章节加入、保存／发布目录后，学生从学习中心读取固定发布版本并下载对应原件。替换文件只更新教师草稿；归档后学生访问拒绝。单文件≤1MiB，PDF文本预览不保留排版／图片；Office／OCR／音视频服务仍待配置。见[本地包](docs/v2/zhiban-v2-course-material-local.md)。

本轮21项定向测试、30组统一旅程及额外章节接续UI通过，1448项运行来源匹配、drift=0。当前私有账号 `/tmp/zhiban-trial-content-49kok0/accounts.json`，实时状态仍以 `pnpm trial:zhiban:info` 为准。内置浏览器已留在新学生资源单元。

**数据边界：**上一 `/tmp/zhiban-trial-content-NooUM6` 资料试用实例因本轮备份校验／执行顺序失误未保留，本包是新合成课堂。当前新实例已另行备份至 `/home/zxm/.local/state/zhiban-trial-backups/material-delivery-20261018-203858`，不是恢复旧实例。历史两份备份各保留原范围。具体见交接记录；下文旧账号／运行数字均仅适用于当时版本。

下一步沿原P3接已发布内容的原生PPTX／离线HTML导出；建议 GPT-6.1 Sol / medium。NO COMMIT／PUSH／CI，真实55432／55433不操作。


## 此前 P3 个人资料与账户／目录交付（2026-10-18）

默认 [3461统一试用](https://127.0.0.1:3461/zhiban) 已接“个人资料与账户”；管理员导航新增“成员账户目录”，可搜索／分页并维护正式姓名、学号／工号。显示资料、私有联系方式、正式档案与登录UserId分开；本人改密／退出全部会话复用原身份API，开户／启停／角色变更仍未启用。范围及证据见[本地产品包](docs/v2/zhiban-v2-profile-directory-local.md)。

当前25组统一教学旅程与29项定向测试通过，1395项运行来源核对 `sourceMatches=true / drift=0`。私有账号文件 `/tmp/zhiban-trial-content-NooUM6/accounts.json`；实时状态以 `pnpm trial:zhiban:info` 为准。重建前旧讨论课堂双库和账号已私密备份至 `/home/zxm/.local/state/zhiban-trial-backups/profile-20261018-195616`，不冒称恢复到新合成课堂。

以下账号／运行数字属于历史记录，不能替代当前info和[最终收据](docs/v2/evidence/zhiban-profile-directory-local.json)。下一步按原P3补新版教学资源的课程归属／发布差额；建议 GPT-6.1 Sol / medium。

## 当前课程讨论交付（2026-10-18）

默认3461已完成教学班讨论完整本地旅程。教师／学生进入课程后点击“课程讨论”：教师建草稿并开放，师生发言／回复，教师填写原因隐藏／恢复、查看管理记录，关闭后只读并可重新开放。主题、发言、管理记录分页；不计学习完成或成绩。见[产品包](docs/v2/zhiban-v2-course-discussion-local.md)。

当前启动核对 **RUNNING_LOCAL_DISPOSABLE / sourceMatches=true / drift=0**。新账号文件 `/tmp/zhiban-trial-content-ufZnB3/accounts.json`，实际运行状态仍以 `pnpm trial:zhiban:info` 为准。旧试讲双库及账号已备份到 `/home/zxm/.local/state/zhiban-trial-backups/discussion-20261018-190550`（私有权限），新课堂不冒称恢复旧数据。下文较早账号、运行状态及4个UI漂移仅保留历史适用范围。

> 当前候选已升级官方 OpenMAIC 1.2.0（2026-10-17，LOCAL）。默认入口仍为 [3461](https://127.0.0.1:3461/zhiban)，启动／查看／停止命令不变。运行 `pnpm trial:zhiban:info` 获取当前三角色账号的私有文件路径和新教学班链接；重启会创建新的合成数据，旧书签中的 tenant／offering 不能作为当前授权。版本与验收范围见 [全量升级记录](docs/v2/zhiban-v2-openmaic-120-upgrade.md)。


> 2026-10-18：已增加[课程学习与测验完整本地包](docs/v2/zhiban-v2-course-learning-quiz-local.md)，含单选／多选／简答、练习隔离、教师发布与更正、封卷回看。包含明确标记的本地 Quiz 扩展；原生 Runtime／AI 仍未启用。

**当前产品主入口：** `pnpm trial:zhiban` → [3461统一教学版本](https://127.0.0.1:3461/zhiban)。同一owned PG16／HTTPS接教务、章节、文本／PNG、基础课堂、文字／扫描附件、人工评分、成绩簿CSV和统计。师生课程侧栏新增“学习中心”，按已发布单元阅读／作答并前后导航；1.2.0含storage升级已完成LOCAL候选；课程测验通过正式扩展子路径接入，见[产品包](docs/v2/zhiban-v2-course-learning-quiz-local.md)。用 `pnpm trial:zhiban:info` 查看是否运行、来源漂移和私有账号文件；`pnpm trial:zhiban:stop` 停止并删除该owned cluster。启动生成新的合成数据，不恢复旧课堂。ClamAV profile及pin缺失／不匹配时拒绝启用，配置见[扫描说明](docs/v2/zhiban-v2-submission-scanner-local.md)。

实施顺序只认[原移植计划](docs/v2/zhiban-v2-migration-completion-plan.md)。`dev:zhiban`仍为3443固定host，本轮不改真实55433。下面3462–3467及旧默认条目保留历史／专项验证用途，不再代表产品默认入口；不能根据旧段落推断进程仍运行。

## 历史与专项记录


**真实附件最新入口：** [3467 ClamAV 扫描接线](docs/v2/zhiban-v2-submission-scanner-local.md)，PDF／TXT≤1MiB，扫描失败或检出风险不创建提交。`pnpm trial:zhiban:trusted-files` 启动，`:info` 获取账号路径，`:stop` 清理该 owned cluster。扫描命令、profile pin 与更新配置见链接。3466仍是原合成样例模式；以下旧条目均按其日期和证据范围理解。

**附件首版状态：** [3466本地附件样例闭环](docs/v2/zhiban-v2-submission-files-local.md)已接PDF／TXT、提交绑定、受控下载与教师评分；**其3466样例模式不接受真实文件；真实扫描另见3467**。`pnpm trial:zhiban:submission-files:info`提供账号；旧3463／3464／3465当前均STOPPED，历史运行记录不代表当前状态。

**最新增量：** [3465成绩簿当前页CSV导出](docs/v2/zhiban-v2-gradebook-csv-local.md)可用，最多50人×10项、500条记录，权限与公式防护已验证。`pnpm trial:zhiban:gradebook-csv:info`获取账号；原3463／3464数据保留。普通Chromium文件读回通过，内置浏览器仅确认生成提示，下载句柄兼容项待验。

**最新产品入口：** [3464教师课程成绩簿](docs/v2/zhiban-v2-gradebook-local.md)已可试用：教师课程 → 学生成绩，双向分页、搜索、具体提交评分及保留筛选返回。`pnpm trial:zhiban:gradebook:info`获取账号路径；独立合成环境，不替代3463课堂数据。3464当前1项前端来源漂移，3463当前14项源码漂移，旧receipt均保持。

[当前可用功能、剩余移植项与下一产品包](docs/v2/zhiban-v2-product-status-next.md)：下一项为教师课程成绩簿首版；现有基础课堂旅程已完成，不再重复基础复评。

2026-10-17 [课堂结束与历史回看](docs/v2/zhiban-v2-classroom-ended-local.md)通过：试讲课堂已结束为版本8，学生入口移除，原提交v1及93／88分保留，平均90.5%；3463继续运行。

2026-10-17 [3463连贯试用](docs/v2/zhiban-v2-classroom-schedule-journey-local.md)已完成教师改期、学生提交v1、教师发布93分及学生反馈核对；原88分保留，平均90.5%。无阻断，CEJ-01已补活动筛选与原课堂返回，见[修复记录](docs/v2/zhiban-v2-classroom-grading-entry-local.md)；当前3项预期前端来源漂移，旧receipt保持。

**2026-10-17 最新状态：** [3463 课堂草稿编辑／时间调整候选](docs/v2/zhiban-v2-classroom-edit-local.md)运行且来源漂移 0。使用 `pnpm trial:zhiban:classroom-edit:info` 获取私有账号路径。初查原3461／3462已停止、旧目录缺失，本轮未清理或恢复；下文相关运行记录属历史状态。默认命令仍指3461，本轮未替换。

2026-10-17 新增独立[基础课堂候选与账号说明](docs/v2/zhiban-v2-basic-classroom-local.md)：当前可访问 [3462](https://127.0.0.1:3462/zhiban)，状态／停止使用 `trial:zhiban:classroom:info`／`trial:zhiban:classroom:stop`。原 3461 默认入口和数据保留，两个环境切换可能需要重新登录。

2026-10-17 TJ-01／02／03 页面修订已在原3461课堂完成定向浏览器复验：学生文案、课程直接退出、取消保留文字及教师评分标题通过；作答及92分保留。旧启动receipt不改写，info报告3个预期UI源漂移，见[体验修订记录](docs/v2/zhiban-v2-p1-teaching-ux-local.md)。

2026-10-17 连贯教学试用已在原 3461 实例走通：学生“连贯备课：检查记录”首次正式提交，教师发布 92/100 和反馈，原 88 分及历史数据保留。本轮未重建实例，三处非阻断体验项详见 [试用记录](docs/v2/zhiban-v2-p1-teaching-journey-local.md)。账号及实时状态仍以 `pnpm trial:zhiban:info` 为准。

当前推荐 **[3461 统一试用](https://127.0.0.1:3461/zhiban)**：教务、文本／PNG 讲义、学生作答、人工评分与统计在同一入口。**2026-10-17 本轮已新建独立试用环境并验证 RUNNING，sourceMatches=true。** 已接旧版风格登录、三角色导航壳与课程列表，见 [P1 记录](docs/v2/zhiban-v2-p1-portal-local.md)。这是新合成课堂，历史试讲数据没有恢复；实际状态及新账号文件以 info 为准。

```sh
pnpm trial:zhiban:info  # 状态、三角色 ID、私有账号文件及页面入口
```

| 角色 | 账号名称 | 主要入口 |
| --- | --- | --- |
| 管理员 | 王管理员 | 教务管理、名单／导入／转班、操作历史 |
| 教师 | 周老师 | 讲义文本／PNG 发布、学习活动、待评分、统计 |
| 学生 | 陈同学 | 当前讲义、作答／重交、成绩与公开反馈 |

密码只从 info 指向的本机 0600 `accounts.json` 读取，不粘贴到聊天或提交到仓库。使用完整 UserId 登录；切换角色先退出。同一浏览器不同标签页、127.0.0.1 不同端口不能作为隔离账户使用。

仅在没有运行实例、且需要新建合成环境时启动：

```sh
pnpm trial:zhiban
```

结束试用并确认不再需要当前数据时：

```sh
pnpm trial:zhiban:stop
```

**停止会删除本实例双库、账号、讲义、作答和成绩；重新启动生成全新数据。** 此前课堂记录为安全巡检报告尝试 #1／提交 v2／96 分、旧 v1／94 分和另一活动 88 分；当前原根已缺失，这些是历史证据，新实例不会自动恢复这些课堂动作。

[当前试用指南](docs/v2/zhiban-v2-trial-guide.md) · [入口交接与默认命令替换范围](docs/v2/zhiban-v2-trial-entry-handoff.md)

默认 `trial:zhiban`、`:info`、`:stop` 和 `verify:zhiban:trial` 已统一到 **3461**；原显式 `trial:zhiban:content`、`:content:info`、`:content:stop` 与 `verify:zhiban:trial-content` 保留兼容。旧 **3459** 仅通过 `trial:zhiban:legacy`、`:legacy:info`、`:legacy:stop` 和 `verify:zhiban:trial:legacy` 显式进入；旧根最后核对已不存在，legacy 启动不会恢复历史课堂。验证命令会新建实例，不要在当前 3461 运行时执行。

LOCAL 未提交候选，Runtime／AI／真实维护仍关闭；原生刷新／关闭保护按用户要求延期、未签收，编辑后先显式保存。真实 55432/55433 与生产部署不在试用范围。原 OpenMAIC 文档及启动方式保留各自范围。

后续产品主线已改为[旧界面恢复与完整迁移](docs/v2/zhiban-v2-migration-completion-plan.md)，第一批先做登录、三角色导航壳和课程列表。
