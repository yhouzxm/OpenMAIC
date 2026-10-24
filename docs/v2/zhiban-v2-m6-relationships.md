# M6 任教关系、行政班成员分页与教师受限搜索

2026-10-15，管理员产品增量。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留既有未提交候选，NO COMMIT/PUSH/CI。

## 页面与操作

分页教务管理中，教学班卡片／详情提供“管理任教”；行政班卡片提供“管理成员与班主任”。两种模式共用 `/zhiban/relationships?tenant=…&offering=…` 或 `&classId=…`，目标必须二选一。

- 任教关系按姓名或完整成员 ID 搜索，筛选任教中／已结束／全部，10/20/50 条 keyset 翻页。支持指定任教、结束及显式重新指定。
- 行政班成员同样搜索和分页，区分在班／已移出／全部；从现有分页学生目录选择一人添加，或移出／恢复已有成员。行政班关系与教学班 Enrollment 独立，不自动入教学班。
- 任教和班主任均使用独立教师搜索器，支持姓名／完整成员 ID、条数及前后翻页。班主任显示姓名（无姓名则 ID），可以设置或清除；设置使用当前行政班 revision，不清空其他班级成员。
- 原命令号和 payload 在当前页面内存保留，结果不确定时暂停其他操作并显式确认；已知成功后的列表刷新失败不改判 UNKNOWN。会话变化和离开页面清空列表／选择，不使用持久化浏览器存储；未提供跨刷新／重启查证。

## 权限、查询及写入边界

新增管理员 GET `/api/zhiban/management/:tenant/assignments|class-members|teachers`。任教要求 offering，班级成员要求 classId；教师搜索必须提供其中一个有效目标。参数白名单、状态、10/20/50 条数和游标均独立验证。只读取当前租户目标及本页关系，姓名使用参数化字面子串匹配；每次重新验证 Session、空间成员及 TENANT_ADMIN，并沿用 Bridge 和 RLS。

教师候选限制为当前租户 ACTIVE Membership 及当前有效、未撤销 TEACHER grant。这个筛选与原指定任教／班主任的角色资格一致，**不承诺目标课程的访问权限**：TEACHER grant 的 TENANT／COURSE／CLASS 范围和 ACTIVE 任教关系仍共同决定原访问授权；搜索、指定任教及设置班主任都不创建或扩大 Identity 角色。非匹配课程范围的教师可有任教记录，依然不能据此获得课程访问。

目录型姓名搜索一次最多扫描 201 条匹配档案，再用独立受限 Identity 连接过滤最多 200 个候选，返回最多 limit 条；可能出现带 nextCursor 的空页，页面允许继续翻页。完整 ID／无条件搜索直接走成员 keyset。结果只含成员 ID、姓名与成员状态，不读取 users、登录状态、凭据或原始 grant 清单；不能将候选列表当作账号可用性的最终证明。

写入通过已有 ACK 接口复用 ASSIGN_TEACHER／END_TEACHER／CLASS_MEMBER／CLASS_HEAD_TEACHER，保持原相关身份锁、CAS、状态验证、durable command key 和审计。指定任教／添加成员前按目标和成员精确查找旧关系 revision，再由事务重新验证；搜索之后撤权或停用不能继续通过正常写入。班主任设置保留旧 class revision 作为并发屏障，冲突时要求刷新。这里不重写原命令对历史／不可用成员的处置规则。

没有新增 migration、helper、ACL、receipt profile 或数据库权限，不修改冻结 Identity/Bridge 语义及已应用 migrations。教师查询只在现有 business／Identity 角色分离连接之间传递有界成员 ID；不增加冻结 related participants 数量。网关编码例外只扩展到三个新增只读 query。

## LOCAL 验收与演示

`pnpm verify:zhiban:m6:relationships` 自建 PG16 56507，仅 Unix socket，数据库 `zhiban_m6_relationships_disposable`；HTTPS 3451 使用原受信开发证书及 hash 校验，不跳过 TLS 验证。追加 `--serve` 则在同样验收后保留独立演示。

[清理完成的验收](evidence/m6-relationships-local.json)：真实 PG16/HTTPS/UI **10/10 PASS**，已停止并删除自己的目录。覆盖 621 条任教关系和 620 名行政班成员完整遍历，当前／撤权／停用／未来／过期／跨租户教师，稀疏空页继续、字面 `%_`、越权／目标错配／游标错配、CAS、重复命令审计、撤权后提交拒绝、响应丢失确认、浏览器操作、390px 和退出登录。

[演示记录](evidence/m6-relationships-demo-local.json) 另行绑定自身 source/dependency/bundle hash、端口、PG16/Node 版本、PID 及私有账号文件，状态 `RUNNING_DISPOSABLE`，不声称当前演示已经清理。相关单元／依赖回归 **29/29**，定向 TypeScript、ESLint、格式检查通过，不宣称全仓 build、压力基准或 CI signoff。

内置浏览器已正常登录并通过教师姓名搜索、20 条搜索设置、班主任提交和 10 条关系筛选，见[实际结果](evidence/m6-relationships-iab-local.png)，无证书绕过。

[行政班与班主任截图](evidence/m6-relationships-class-local.png)、[移动端截图](evidence/m6-relationships-mobile-local.png) 来自真实隔离浏览器。旧主数据、Enrollment、目录、统计及 CI 证据保留其原 hash 和范围，不用来覆盖本轮共享 store／网关／页面新来源。

55432/55433、真实 Native／维护 control、HBA、凭据 staging 及“保留待补”输入保持隔离，本轮未操作。

下一建议：教师／学生工作台课程分页，解除旧整租户 AcademicSnapshot 对普通用户入口的限制；课程负责人选择器及跨重启操作查证继续单列。建议模型 GPT-6.1 Sol / medium。
