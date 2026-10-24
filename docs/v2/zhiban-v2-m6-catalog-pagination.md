# M6 课程、学期、行政班分页与新建教学班选择器

2026-10-15，管理员教务产品增量。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；沿用既有未提交候选，不提交、推送或派发 CI。

## 可使用的范围

管理员从工作台“教务管理（分页）”进入，在教学班、课程、学期、行政班之间切换。三个主数据列表均支持名称、编号、完整 ID 搜索和 10/20/50 条 keyset 分页，搜索重置页位置，切换分类保留每页条数。课程可按草稿、已发布、已归档筛选；学期和行政班不虚构生命周期状态。

课程页可以新建、编辑、发布、显式确认归档。编辑保留既有负责人，发布继续生成不可变版本；已归档课程不能编辑或重新发布。新课程默认无负责人，本轮没有新增教师负责人选择器。学期和行政班支持新建；不新增原命令模型没有的修改或删除操作。

新建教学班包含三个独立选择器：已发布课程、学期、可选行政班。每个选择器独立搜索、设置条数、前后翻页，显示当前所选名称/编号，选项只存在当前页面内存中。搜索或翻页不清空已选项，行政班可显式取消关联。必需选择课程和学期，再填写编号、名称、容量后提交；成功后按编号查询显示新班，不依赖新记录在第一页的位置。

选择器显示的课程版本只反映读取时状态，教学班仍由原 CREATE_OFFERING 事务绑定**提交时**的已发布版本。选择后重新发布时使用新版本；选择后归档或转为草稿时拒绝建班，保留表单供重新选择。不会因关联行政班而自动添加教师或学生。

## 实现与安全边界

新增管理员 GET `/api/zhiban/management/:tenant/courses|terms|classes`，与既有分页路由使用相同 Session、空间成员关系、TENANT_ADMIN、Bridge 屏障和 tenant RLS。SQL 从封闭源码映射选取三个表及明确投影，始终按 tenant/UUID 查询最多 limit+1 行，不读取整租户 AcademicSnapshot 或 Identity users。

参数白名单和课程状态分别验证；主数据不能携带 offering/member/source。游标继续绑定租户、管理员、列表种类、筛选和条数；只是实时列表位置，不是签名、权限凭据或冻结快照。日期以 SQL text 投影，保留日历日期。

写入复用原 Academic 命令解析、锁、CAS、审计与 durable command key，通过已有 ACK 路径返回结果。不改变原 snapshot 接口、冻结 Identity/Bridge 生产语义或已应用 migrations；没有新增 schema、helper、ACL 或 receipt profile。网关编码例外只扩展到这些新增只读 query，路径和 Identity 查询限制保持。

课程负责人编辑、班主任/任教管理和行政班成员管理仍保留原入口及原适用范围；教师、学生工作台旧 snapshot 上限未在本轮解除。课程简介遵守原领域和有界请求验证。提交结果不确定时使用原命令号确认；当前页之外的 UNKNOWN 恢复仍未实现。

## 本地证据

`pnpm verify:zhiban:m6:catalog` 创建并清理独立 PG16；追加 `--serve` 则验收后保留演示。固定独立端口 56506、仅 Unix socket、数据库 `zhiban_m6_catalog_disposable`，受信 HTTPS 3450。只读取已有开发证书/CA/证书 receipt，校验 hash，不绕过证书验证，不读取真实环境数据库认证来源。

最终 PG16/HTTPS/UI **19/19 PASS**；[当前演示来源与验收](evidence/m6-catalog-demo-local.json) 记录实际检查、源文件/依赖/执行 bundle 指纹、PG16/Node、私有账号文件位置和 `RUNNING_DISPOSABLE` 状态。正常退出后脚本才写 close 记录并删除自己的目录；此前失败尝试只保留失败证据，不能当作通过或 CI signoff。

数据包含初始 621 门课程、621 个学期、620 个行政班，以及继承的 623 教学班、629 条 ACTIVE Enrollment。覆盖完整分页、过滤/空结果、权限/RLS/游标错配、跨租户引用、草稿/归档/容量拒绝、重复命令只建一个班、课程发布版本竞争、行政班清空，以及已有 Enrollment/转班/响应丢失确认旅程。相关单元及依赖回归 **28/28**，定向 TypeScript、ESLint 通过，不宣称全仓构建、负载基准或 CI 验收。

[课程管理](evidence/m6-catalog-course-local.png)、[分页选择器](evidence/m6-catalog-selectors-local.png)、[建班结果](evidence/m6-catalog-created-local.png) 为实际浏览器旅程产物。内置浏览器正常登录后实际完成三个选择器搜索、课程每页条数切换与建班，见[选择状态](evidence/m6-catalog-iab-selectors-local.png)及[成功结果](evidence/m6-catalog-iab-created-local.png)，没有证书绕过。旧目录、名单、统计及 CI 证据只保留原 hash 与原适用范围；3450 演示用于本轮候选，不将旧演示地址作为当前来源。

55432/55433、真实 Native/维护 control、HBA、凭据 staging 及“保留待补”输入继续隔离，本轮不操作。

下一建议：任教关系与行政班成员的分页管理，接上教师受限搜索，逐步解除剩余管理员整表依赖。建议模型 GPT-6.1 Sol / medium。
