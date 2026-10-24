# P3 成绩簿受限跨页导出

2026-10-23，LOCAL 产品包。复用已有成绩簿、冻结 Identity／任教授权和 CSV 防护，不增加表、migration、ACL、导出凭证或后台任务。

## 教师使用

统一 [3461 工作台](https://127.0.0.1:3461/zhiban) → 教师课程 → 成绩簿，先查询学生，再点击 **按查询条件跨页导出 CSV**。导出忽略当前学生页／活动页和每页大小，包含已查询条件匹配的全部当前在班学生 × 全部当前已发布的正式活动。未点击查询的输入不改变范围；原 **导出当前页 CSV** 继续保留。

硬上限同时满足：500 名学生、100 项活动、10,000 条学生×活动记录、UTF-8 文件 8 MiB。超限返回 HTTP 413／`EXPORT_LIMIT`，整个文件拒绝，不静默截断；人数／记录数超限可缩小学生筛选，活动数超限可用当前页导出。无匹配学生或无活动时返回表头；活动维度本身超限即使无匹配学生仍拒绝。

每格只导出当前发布版本的最新尝试、最新提交及其最新公开成绩。未开始／未提交／待发布成绩不记零分；不含答题正文、反馈、评分草稿、课程总评或历史退班名册。13 个字段和既有当前页导出一致；BOM、CRLF、全字段引号、公式前缀转义、固定文件名及 no-store／nosniff／same-origin 下载头继续复用。文件一旦下载不受后续撤权撤回，应按教学数据保管。

## 授权、快照和边界

新增只读端点：`GET /api/zhiban/assessment/:tenant/offerings/:offering/gradebook-export.csv?q=...`。仅接受 q；分页游标、尺寸、重复参数或未知参数拒绝。POST 拒绝；学生、管理员、未任教教师、其他租户及无会话不能下载。

每次重新走现有 Session／Membership／RoleGrant／课程／Assignment 检查与事务锁。单条 SQL 将两个维度、发布版本和全部格子投影在同一 statement snapshot；各维度以 cap+1 探测，超限时跳过格子计算并拒绝。没有拼接多个分页请求，下载内容可能与先前页面查询不同。事务保留原 Identity 当前性／过期终检；不另建绕过撤权的缓存下载地址。生成完整 CSV 并检查字节数后才交付响应。

浏览器使用已提交筛选、10 秒中止、下载期间禁用控件、离页中止与结果状态提示；超限显示缩小范围／当前页导出建议。本地网关仅对精确导出路径允许编码查询，不放开路径编码或任意端点。

## LOCAL 验证和证据

- `pnpm verify:zhiban:gradebook-export`：独立 disposable PG16／真实 Identity 会话／受限业务角色／受信 HTTPS；不占用 3461，不触碰 55432／55433。
- [定向 receipt](evidence/zhiban-gradebook-export-local.json)：12×12 两轴跨页、144 个唯一格子、一个查询时间；浏览器从两轴第二页实际下载并读回；未提交搜索不影响导出，中文查询 12 条、旧当前页 5 条、空筛选表头。
- 同一旅程接受 100 项活动、500×20=10,000 条；101 项活动、501 人及 500×21 超限拒绝。浏览器超限无下载、提示明确且按钮恢复；教师撤权后下一次导出拒绝。初始公开成绩 88/100、缺分留空、私有正文不进入 CSV。
- 两份 gradebook 单测覆盖公式／引号／换行、查询合同、精确网关路径、完整矩阵／重复格子／截断拒绝及字节上限。定向 TypeScript 配置 `scripts/zhiban-local/tsconfig.gradebook-export.json` 与 ESLint 验证本包；旧宽范围 members 配置仍有既有 onboarding verifier 参数类型差异，不宣称全仓类型通过。
- 默认3461内置浏览器已真实下载并读回6条合成记录、BOM和88/100公开成绩，见[入口证明](evidence/gradebook-export/iab-3461.json)及[页面截图](evidence/gradebook-export/iab-3461.png)；运行 sourceMatches=true／漂移0。
- [下载截图](evidence/zhiban-gradebook-export-download-local.png)／[超限截图](evidence/zhiban-gradebook-export-limit-local.png)。数量级 fixture 只在 owned 临时库由 owner 种入无凭据主体／Enrollment／发布活动，不能当作产品开户成功或真实运营授权；成功后专用 cluster 删除。

默认 3461 经受控停止／重启加载本包源码，生成新合成课程、账号和口令；以 `pnpm trial:zhiban:info` 为准。旧实例三库及 control 私有文件已[备份并核验 TOC](evidence/gradebook-export/private-backup.json)，未做恢复演练。此前 P7 源码包保留原 sourceDigest，**不包含本轮增量**；未重签历史证据。当前启动检查与本包定向证明分开，不重跑无关完整课堂／模型／扫描／导出／GitHub CI。

总评、申诉、历史名册／历史版本导出、持久快照／异步大文件／跨教学班导出仍在本包之外。下一完整功能建议沿原 P3 补本人头像与目录展示，复用已有文件治理；建议 GPT-6.1 Sol / medium。
