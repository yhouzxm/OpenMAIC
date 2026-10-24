> 后续增量：已新增独立 [3467 真实 ClamAV 扫描候选](zhiban-v2-submission-scanner-local.md)。下文3466与原证据仍仅代表合成样例模式，不追溯升级。

# 作业附件首版：本地样例闭环与真实文件启用边界

2026-10-17。`refactor/zhiban-v2`，基线HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。在既有未提交候选上追加，NO COMMIT／PUSH／CI。**当前只签收LOCAL已登记合成样例闭环；真实文件接收尚未启用。**

## 已实现

文字作答保留，正式SUBMIT可带1个PDF或UTF-8 TXT，≤1MiB。选择／移除在本标签内完成，正式提交才上传；保存文字草稿不会上传文件，重画表单仍保留内存中的选择。导航离开时纳入未保存保护；显式放弃会清除待提交附件。文件选取不代表已上传，刷新／关闭后的附件选择不自动恢复。

Learning事务沿用当前学生／Enrollment、活动发布、教学班OPEN、最新Attempt、deadline、重交及次数规则。文件通过SubmissionFileAssetPort写入，同一PG事务固定到精确Submission，不能客户端指定他人提交或替换历史文件。幂等键和revision沿用原命令；同键同payload不重复写入，同键异内容／并发旧revision拒绝。文件或配额失败时文字、Submission、事件、文件一起回滚。重交不自动沿用旧附件；旧版本仍可授权回看。

当前PostgresSubmissionFileAssets适配器在独立 `zhiban_learning_files` schema存字节、大小、摘要及放行标识，不把文件写到用户命名的磁盘路径，也不复用Content／Native／Bridge资源ID。每次下载核对当前身份、租户、教学班与Submission归属：学生仅本人，教师须当前任教，管理员不默认可读；失去关系后拒绝，不删除历史。下载时校验摘要，返回application/octet-stream、attachment、no-store、nosniff、sandbox及same-origin策略；无站内预览、公共URL或任意远端资源读取。

大小／数量配额：每尝试10MiB／100份附件，学生在同教学班累计100MiB／1000份，单提交1份；配额包含历史文件，以教学班＋成员锁串行核算，取得锁后重新检查服务器截止时间。没有删除／释放配额入口；配额耗尽可改为不带附件提交，不静默删历史。

## 精确API与追加SQL

- 原Learning POST命令新增仅SUBMIT可选的 `attachment:{name,mime,base64}`。名称≤120字符、禁止路径与控制字符，后缀／声明类型／字节格式必须对应；base64规范且解码后有界。文字仍必填，不是独立文件作业类型。TXT必须有效UTF-8且无禁止控制字符；PDF仅做容器识别，不冒充恶意软件扫描。
- `GET /api/zhiban/learning/:tenant/offerings/:offering/attachments?submission=UUID` 只返回该提交附件元数据；加 `file=UUID` 下载精确字节。不支持POST下载、跨Submission复制文件ID或任意路径。
- `0001_submission_files.sql` 独立ledger、append-only文件表、复合Submission外键、FORCE RLS、仅SELECT／INSERT；`0002_file_clearance.sql` 追加放行标识。均仅在本轮owned PG应用。已有Learning 0001及其他已应用migration未改，附件0001首次验证后也未改，放行字段用0002追加。
- 只读loader验证两条source／ledger hash、表闭包、owner、精确RLS和列／表ACL；额外DELETE拒绝。启动不做DDL；普通standalone即使发现这套schema也保持附件关闭，待可信扫描组合具备后再明确启用。

## 3D扫描门槛与未完成项

[执行计划3D](zhiban-v2-execution-plan.md)要求“按批准规则实施malware检查，无生产扫描配置不能默默跳过”。本机未发现clamscan／clamdscan，也未收到可信扫描服务配置。因此：

- 应用默认无clearance provider，未放行文件返回ATTACHMENT_NOT_CLEARED，**不产生文字／文件提交**。
- 3466显式注入LOCAL_SYNTHETIC_PINNED提供者，只接受源码登记的三个精确SHA256合成内容（报告TXT、测试PDF、配额用1MiB文本）。它是固定样例通道，不是扫描器，也不代表真实文件安全。
- 数据记录为LOCAL_SYNTHETIC_PINNED并携带 `local-synthetic-sha256:<digest>`；页面显示“本地样例，不代表真实扫描通过”。已有行经0002默认UNVERIFIED，不隐式授予放行；UNVERIFIED下载拒绝。
- 真实扫描器的执行、隔离／扫描失败恢复、可信扫描证明及正式启用仍待完成；已询问受限命令／配置／socket路径，不索取凭据。接口类型并不构成真实扫描实现，不能把LOCAL标志改名来通过Gate。

真实保留、备份及删除策略仍属于上线包。LOCAL由本实例所有者保管；停止owned cluster删除本轮库和临时root，不执行生产清理。无人工删除历史附件接口。

## 已完成验证

Learning定向29/29单测通过（含3条附件格式／大小／命令规则用例）；定向类型闭包、受影响核心／AssetPort／验证器ESLint、JS语法、diff检查通过。PG16 160015共9组准备与旅程通过：

- 字节／摘要与正式提交原子绑定、同键重放／冲突、畸形与超大文件拒绝、跨学生／管理员／跨租户拒绝、撤任教／退班拒绝。
- 未登记文件拒绝且不留提交、UNVERIFIED下载拒绝；TXT／PDF原样下载、两个同revision提交仅一成功、10MiB配额失败无部分提交、过期提交无记录。
- exact ledger／RLS／ACL检查，注入额外DELETE失败后恢复。
- 普通Chromium真实选文件→保存文字草稿保留选择→提交v4→历史下载，读回字节完全一致，无页面脚本错误。

内置浏览器从教师课程→待评分列表→“试讲：附件巡检报告”提交v4，确认71字节“页面巡检.txt”与LOCAL标记可见，保存并发布95/100成绩v1。截图为真实教师页面，未把下载按钮存在当作内置宿主下载落盘通过；此前内置下载句柄兼容项仍保持未签收。

[完整启动来源／9组结果](evidence/zhiban-submission-files-demo-local.json)、[收尾边界与hash](evidence/zhiban-submission-files-local.json)、[学生提交／下载](evidence/zhiban-submission-files-student-local.png)、[教师附件与95分](evidence/zhiban-submission-files-teacher-local.png)。最终sourceMatches=true、漂移0，receipt未重签；既有migration hash比较均未变。不声称整仓测试／生产启用／完整双库Runtime通过。

## 试用入口

[3466附件样例候选](https://127.0.0.1:3466/zhiban)，PG16 56522／zhiban_submission_files_disposable，当前root `/tmp/zhiban-submission-files-uRbdOx`。账号路径由info提供；密码不入仓库和聊天。可选[固定TXT样例](evidence/zhiban-submission-file-fixture.txt)，它的精确内容已登记，任意真实文件会被拒绝。

```sh
pnpm trial:zhiban:submission-files:info
pnpm trial:zhiban:submission-files:stop
pnpm trial:zhiban:submission-files
```

本轮只启停自己的3466候选，未启停或清理旧3463／3464／3465。收尾只读info显示这三套旧环境已STOPPED，不宣称旧数据库仍在或已恢复；此前运行／成绩记录只保留当时证据。本轮新合成95分属于3466，不是继承旧课堂成绩。默认入口未替换，Content／Runtime／AI及真实55432／55433、维护／UNKNOWN／RESERVED隔离保持。

下一步：取得可信扫描器配置后实现真实文件扫描／失败隔离并开放真实附件；在此之前保留合成样例模式。建议GPT-6 Sol / medium。
