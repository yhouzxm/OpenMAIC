# P1 第三片：讲义、评分与统计进入课程布局

后续管理员教务布局统一见 [第四片记录](zhiban-v2-p1-admin-layout-local.md)。本页保留第三片验收时点与证据范围。

2026-10-17，LOCAL 工作树候选。基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，分支 `refactor/zhiban-v2`。本轮无 commit、push、CI dispatch。

课程内“讲义与图片／课程资源”“学生成绩／学习成绩”“教学分析”直接展示业务界面：文本／PNG 编辑预览、待评分列表与评分表单、教师统计、学生个人概览。页面保留课程标题、教学班／学期／版本及课程内导航。无需经过上一片的“打开…”中间页，也不再跳出课程布局。

本地 host 对已明确开放的课程路径作精确 HTML 映射：`resources` 使用 content.html；教师 `grades` 使用 grading.html；学生 `grades` 使用 progress.html；教师 `analytics` 使用 analytics.html。其他已支持课程路径继续使用 index.html。未知角色、未知分区与不合法路径不匹配。讲义路径保持已有 Content/PNG 专用 CSP；没有扩大为全站策略，没有 iframe、外站或 inline script。

共享 course-page.js 将路径中的课程及 role、查询中的 space/offering 正规化为业务页参数。业务页启动前，读取同一空间的当前受限课程投影，并校验课程、教学班、有效任教／Enrollment 及角色。失败时不挂载业务界面。URL 仅为导航上下文，业务 API 的 CSRF、版本、任教、Enrollment 与内容／成绩权限仍逐次校验。旧的独立 tenant/offering 入口保留兼容；带完整课程上下文的旧入口也采用课程外层。

讲义编辑和人工评分增加未保存离开确认：取消课程导航保留输入；保存成功或恢复原始字段值后清除对应脏状态。内容继续使用现有显式保存、发布和 UNKNOWN 处理。评分刷新／发布已保存成绩前也检查未保存字段。新页面收到会话广播后重新加载并通过课程 gate，避免异步组件恢复已清除的旧会话内容。

共享脚本、课程样式及路由 helper 纳入 disposable Content receipt 的来源 hash 闭包。没有变更已应用 migration、SQL、ACL 或真实 55432/55433 环境。

定向路由验证 7/7 通过；内容及受影响服务／验证脚本的定向 TypeScript 检查通过。改动 JS／服务脚本 ESLint 与语法检查通过；既有 Content TSX 模块仍有 explicit-any lint 债务，本轮对该规则例外后检查其余规则，新增课程桥接接口使用具体类型，不宣称全量 lint 通过。

新独立 PG16（16.15）试用 13/13 检查通过，包含课程内讲义取消离开保字、评分取消切换保反馈、文本／PNG 发布／查看和精确 CSP 校验。内置浏览器实测讲义、评分、教师统计、学生个人概览桌面与 390px 窄屏，未发现全页横向溢出。错角色与错课程编号的业务根均未挂载。当前 `pnpm trial:zhiban:info` 返回 sourceMatches=true、sourceDriftCount=0；运行根 `/tmp/zhiban-trial-content-1mR7Ca`。

验证结果与最新独立试用环境见 [本轮机器证据](evidence/zhiban-p1-integrated-course-pages-local.json)。上一片记录保持其验收时点，不替代本轮证据。

仍待完成：完整章节结构与课程编排、旧版各业务页内部视觉细节，以及 P1 教务页统一布局。当前仅依据旧分支源码恢复信息层级，未签旧应用像素一致性；原生关闭／刷新保护不重复签收此前跳过的范围。

下一步：统一管理员教务页的分区、表格与返回入口，再推进章节结构和课程编排。建议 GPT-6 Sol / medium。
