# M6 教学班与 Enrollment 大名单分页

2026-10-15，管理员产品增量。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；在既有未提交候选上增量实现，未提交、推送或派发 CI。

## 页面与行为

工作台管理员入口“教学班与学生名单（分页）”打开 `/zhiban/management?tenant=…`。旧快照超限时，通过独立受权目录探测仍展示入口；教师和学生不能使用管理员分页 API。

- 教学班按名称、编号、课程名称或完整教学班 ID 搜索，筛选开放/关闭，10/20/50 条翻页。
- 单班 Enrollment 按姓名或完整成员 ID 搜索，筛选在班/已退班/全部，同样分页。返回本页条数及当前页序号，不虚构全局页数。
- 在班人数沿用原 `status=ACTIVE` 容量口径；修改班名/容量/开放状态、目录选一名学生入班、退班和显式恢复入班均可操作，批量入口继续使用现有预览/确认导入。
- 转班目标独立搜索/分页，只显示同课程、同学期的开放教学班；提交前查询目标学生现有 Enrollment revision。权限、状态、CAS、容量及排序锁仍由原命令事务决定，目标失败不移出源班。
- 响应丢失或 5xx 显示结果待确认，暂停其他操作，保留原 payload/commandKey 重试。已知成功后的刷新失败单独提示，不改判 UNKNOWN。待确认信息仅保留在当前页面内存中；不提供跨刷新/重启查证保证。

## API 与事务边界

新增管理员 GET `/api/zhiban/management/:tenant/offerings` 与 `/enrollments`（后者必需 `offering`）。参数有严格白名单，读取最多 limit+1 行，按 UUID keyset；姓名使用参数化 `strpos` 字面子串匹配，`%`/`_` 不作为通配符。Enrollment 只联接目标班名单/姓名，教学班读取有界投影及选中班的 ACTIVE 人数，不载入整租户 people/enrollments。

游标绑定租户、管理员 Membership、列表种类、目标、搜索、状态及每页条数；只是可继续读取的位置，不是授权能力、签名或固定快照。每次请求重新通过 Session/空间成员关系和管理员当前授权，沿用原 Bridge、RLS 和角色隔离。跨页变化可能导致页变空，提供上页/重新搜索恢复。

新增 POST `/api/zhiban/management/:tenant/commands` 返回 `{commandKey,type,status:COMPLETED}`。`AcademicService.acknowledge` 复用严格命令解析、原 store 锁/提交屏障、durable command key 和审计，**不在写事务中调用整租户 snapshot**。原 `/academic/:tenant` 的响应合同及快照上限不改；新接口不声称已改造所有旧读写入口。使用同源 cookie、CSRF、Origin、正文上限和并发限制；本地网关仅为新增只读查询开放编码 query，路径与旧 Identity 限制保持。

没有新增 migration、helper、ACL、receipt profile 或原有表权限，不修改已应用 migrations 和冻结 Identity/Bridge 语义。

## 本地验证与证据适用范围

命令 `pnpm verify:zhiban:m6:management`（验收后清理）或追加 `--serve`（验收后保留隔离演示），使用自建 PG16 端口 56505、仅 Unix socket、数据库 `zhiban_m6_management_disposable`，HTTPS 3449 使用已有受信开发证书并校验来源/hash。fixture 通过实际受限角色、真实 Identity 会话及业务事务，不使用证书校验绕过。

最终 PG16/HTTPS/UI **12/12 PASS**，源文件、依赖、执行 bundle 指纹以 [LOCAL 演示记录](evidence/m6-management-demo-local.json) 为准。演示是 `RUNNING_DISPOSABLE`，不声称已停止/删除；停止后才由脚本写 close 记录。失败尝试已停止其自建 PG，失败目录可保留，不作为通过证据。

验收数据包含 623 个教学班、初始 629 条 ACTIVE Enrollment 和超过 500 个姓名档案。覆盖完整遍历无重复、中文/空结果、游标错配、越权/跨租户/CSRF、快照超限下写入、命令重放、CAS、退班恢复、最后席位竞争、转班失败原子性、浏览器分页/目标翻页/目录选人/修改、提交响应丢失、390px 和退出登录。相关单元/依赖回归 27/27，定向 TypeScript/ESLint 通过；不宣称全仓构建、负载基准或 CI signoff。

[教学班列表](evidence/m6-management-offerings-local.png)、[移动端 Enrollment](evidence/m6-management-enrollments-local.png) 来自隔离浏览器验收；[内置浏览器第二页截图](evidence/m6-management-iab-local.png) 验证正常登录、管理员独立入口、中文筛选及每页 10 人第二页；未绕过证书校验。旧目录、导入、统计、PNG 和 CI 证据只保留其原 hash 与原范围，不因本轮共享 store/launcher/工作台变化而回填。

55432/55433、真实 Native/维护 control、凭据 staging、HBA 及用户“保留待补”输入全部保持原隔离，本轮不操作。

## 后续产品范围

课程、学期、行政班及任教关系管理和教师/学生旧教务入口仍受原快照上限约束；新建教学班的课程/学期选择仍走旧界面。本轮完成管理员教学班及 Enrollment 大名单日常管理，不宣称整个 AcademicSnapshot 已分页。

下一建议为课程/学期/行政班的分页查询及新建教学班的有界选择器，再接任教管理；导入历史与跨重启查证继续单列。建议模型：GPT-6.1 Sol / medium，属于普通业务接线，无需默认 high。
