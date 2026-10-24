# M6 管理员工作台直接接分页教务入口

2026-10-15。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留既有未提交候选；本轮为 `LOCAL_VERIFIED / UNCOMMITTED_CANDIDATE`，NO COMMIT/PUSH/CI。

## 产品接线

管理员登录、选择空间后，直接在原工作台显示教务管理：教学班、课程、学期、行政班分类，搜索、状态、10/20/50 条分页及新建表单；不再先读取旧 AcademicSnapshot、等待 500 条超限，再通过目录权限探测显示链接。管理员模式只由服务器 workspace bootstrap 决定；读取失败留在当前错误／重试界面，不回退旧快照。教师／学生继续进入各自的课程工作台。

`management.js` 改为可挂载、可销毁的共享组件。主工作台和独立 `/zhiban/management?tenant=…` 共用原有分页界面、目录选人、Enrollment 修改／恢复／转班、主数据编辑发布和建班选择器；独立页面由 `management-page.js` 校验参数并挂载。任教、行政班成员、学生目录和批量导入入口保持。未知写入结果继续保留原命令号并暂停其他写入，确认提交后不因刷新失败降为 UNKNOWN。

切换空间、根节点移除、会话广播和离开页面时终止旧请求，销毁选择器／监听并清空挂载内容及待提交状态；旧响应不能回填新空间。切回空间重新请求第一页，不携带旧筛选／游标。退出会清除其他标签页尚未提交的表单；不会把原空间的未知命令自动重发到新空间。bfcache 恢复时重新加载，重新核验会话。

没有修改业务服务、冻结生产语义、已应用 migrations、helper／ACL／receipt profile；原管理写入仍使用服务器授权、CAS、相关身份屏障、容量约束和审计事务。旧 AcademicSnapshot API 及其上限继续保留兼容范围。

## LOCAL 验证与使用

`pnpm verify:zhiban:m6:admin-workspace` 复用已有 catalog disposable harness，增加明确的 `--admin-workspace` 模式，不复制一套安装器。专用 PG16 **56509**，Unix socket 与数据库 `zhiban_m6_admin_workspace_disposable`；受信 HTTPS **3453**，不绕过证书校验。追加 `--serve` 可保留本地演示；凭据仅写入演示根目录的 0600 `accounts.json`。

[清理完成的 PG16／HTTPS／页面验收](evidence/m6-admin-workspace-local.json) **23/23 PASS**，真实初始 623 个教学班、629 条 ACTIVE Enrollment，课程／学期／行政班各超过 500 条。覆盖主页面直接接入、各列表分页／搜索／写入、提交响应丢失后的原键重试、建班选择与归档竞态，以及 bootstrap／管理读取 503 重试、参数拒绝、师生越权拒绝、延迟响应下空间切换、跨标签页退出清理和 390px 布局。测试中主动核对主工作台没有旧 academic 请求，目录选人前没有目录权限探测请求。测试用的旧快照超限断言仅用于确认兼容 API 仍拒绝超量，不是产品启动步骤。

相关单元／依赖回归 **53/53 PASS**（workspace、academic、management、directory、roster、learning、progress、analytics），定向 TypeScript、ESLint、Prettier 通过。验收记录绑定源码、相关测试、package／lockfile 和实际执行 bundle hash；已停止／删除的仅为该次自建根目录。未执行全仓 build、压力测试或 GitHub CI。

[持续演示记录](evidence/m6-admin-workspace-demo-local.json) 单独标记 `RUNNING_DISPOSABLE`，不声称已清理；正常退出才生成 close 记录。工作台入口为 [本地演示](https://127.0.0.1:3453/zhiban)。旧 M6／CI 证据保留原 hash 与适用范围，不回填为本轮候选证据。真实 55432/55433、Native／维护输入、HBA／凭据 staging 和“保留待补”隔离不变；本 fixture 不能证明 M5 内容 provider 已启用或完成发布签收。

[内置浏览器实际截图](evidence/m6-admin-workspace-iab-local.png)确认管理员登录后直接进入原工作台的教务管理并完成教学班搜索；未绕过证书校验。[最终核对](evidence/m6-admin-workspace-checkpoint-local.json)记录 23／53、定向检查及源码 hash 一致性。

下一建议：学习活动及提交记录分页；课程负责人选择器、操作历史继续单列。建议模型 GPT-6.1 Sol / medium。
