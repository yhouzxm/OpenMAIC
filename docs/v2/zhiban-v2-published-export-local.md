# P3 已发布单元 PPTX／离线 HTML

状态：**LOCAL 产品包通过，已接默认 3461**。基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，dirty worktree；NO COMMIT / NO PUSH / NO CI DISPATCH。

## 产品范围

统一 3461 学习中心的讲义和教学资源单元提供“导出 PPTX／导出离线 HTML”。师生沿用当前任教／Enrollment 读取权限；管理员无代理入口。按当前已发布目录中的单元导出，不导出草稿、测验／作业、答案、尝试、成绩、讨论或人员目录。资源正文重新分页，PDF 原排版及原文件仍由原下载入口提供。空解析正文拒绝导出，不以空白文件冒充成功。

PPTX 复用新版原生布局生成器，保留可编辑文本并内嵌 PNG；HTML 复用新版 manifest 准备／清洗、单文件组装和离线播放器，下载后可以无网络阅读。没有新解析器、无账户数据或 owner 课堂链接。当前每次导出一个单元；不是整门课程打包、Office 文档转换或成绩簿导出。

Office／OCR／音视频解析继续待真实服务配置；完整 Runtime、AI、UNKNOWN／RESERVED 维护交付及历史原生刷新／关闭手工签收仍独立待办。

## 接线与边界

- 复用已有认证 GET API：先核对当前已发布目录，再读取当前发布讲义／资源正文；PNG URL 绑定 publicationId＋slideId。请求 same-origin、no-store、x-zhiban-request，任何失败取消整个文件。
- 文件生成后、触发下载前，再读取资源与目录：当前资格失效、资源撤回／隔离、publicationId／publicationNo／digest 或目录版本变化均拒绝下载。生成中离开页面会中止，防止旧单元在新页面完成下载。已获得的本地副本不随线上撤权删除；不声称跨 HTTP 请求存在全局事务或可以撤回读出的字节。
- 原 native Hook 的媒体依赖显式注入拆出的 `pptx-builder.ts`，其原默认行为由 Hook wrapper 保持。智伴使用 data-only 默认，只允许文本／内嵌 PNG，无 owner ID、原生场景、媒体任务、链接或远程背景；实际浏览器依赖闭包检查排除 owner store／provider／server paths。
- HTML 仅由投影后的 slide manifest 构造；文本先转义，再走原生清洗。stage 不含课程／tenant／账户 ID，无 classroomUrl、agent 或 narration。图片全部为已授权 PNG 的 data URI。离线 CSP connect-src none 仅位于下载文件，不放松线上 CSP。静态播放器路径仅允许固定 JS／CSS 两项，不接受文件路径参数。
- 最多 200 页、32 MiB 输出；单 PNG 最多 4 MiB，全部 PNG 最多 32 MiB；90 秒取消；教学资源每行 34 Unicode 码点、每页 14 行，超限拒绝，不静默截断。原文件最大 1 MiB 的扫描／解析政策不变。
- 不新增数据库表／migration／权限；不改变已应用 SQL、Native／Identity／Bridge 合同。只在 owned disposable PG56517／HTTPS3461 验证，LOCAL／githubActions:false。

## 启动与数据

`pnpm trial:zhiban` 在构建前用官方脚本生成离线播放器，并将播放器、导出依赖闭包和 bundle 纳入 runtime source/hash。默认仍为 3461；启动创建新合成课堂。切换前双库及账号私有备份记录见 [backup.json](evidence/course-export/backup.json)。该备份保留本轮前 material 课堂，不等同于恢复此前已删除的旧 profile 实例。

## 验证与证据适用范围

当前 `RUNNING_LOCAL_DISPOSABLE / sourceMatches=true / sourceDriftCount=0`；1528 项运行来源/hash匹配；31 组统一旅程通过。私有账号 `/tmp/zhiban-trial-content-sFuJer/accounts.json`，新合成课堂；切换前 material 课堂的备份保留，不冒称自动恢复。

- 88 项导出／原生 PPTX 定向测试通过；85 项离线导出／新增边界测试通过，两组有 11 项重合（162 个不同用例），不重复累计。
- `tsconfig.export.json` 类型检查、定向 lint 与浏览器依赖闭包通过。补齐 native vendor 类型声明，未用 any 降低类型边界；既有 content-client 32 项 explicit-any lint 基线未改。本轮不是全仓 lint／全仓测试签收。
- 师生各对讲义／资源执行两种格式，共 8 次真实下载；解包核对 PPTX 可编辑文字、PNG 和无外部 rels。4 份真实 HTML 均在 offline 浏览器通过 file:// 打开、点击播放、查看场景目录，文字／PNG可读，零网络请求、零 pageerror。
- 新增边界测试拒绝未发布／越权、教师草稿目录引用、生成中发布或目录变化、下载前资格失效；实际来源 API 还拒绝管理员代理、外租户和退班成员。模拟时序属于定向边界测试，实际权限／撤权由当前 PG16 资源旅程核验，不混称全部真实并发故障切点。
- 28 个既有 migration 文件逐字 hash 不变；无 SQL、migration 或授权 ACL 新增。

首轮启动在成绩发布前的 CSRF 读取遇一次 503，既有页面进入“按原命令号重试”；随后关闭页面时，网络记录器 response.finished 的拒绝未捕获，导致 Node 非正常退出。已仅修复记录器异常留痕，未放宽 Identity 限流或生产授权；首轮日志及专用实例清理证据保留。第二轮完整 31 组通过；不能据此声称已消除所有瞬时 503。最终记录分别见 [journey.json](evidence/course-export/journey.json)、[实际离线播放](evidence/course-export/offline-play.json)、[运行核对](evidence/course-export/runtime-info.json)，完整 hash 收据见 [最终 LOCAL 收据](evidence/zhiban-published-export-local.json)。

内置浏览器已核对受信任 3461 登录页可访问并保留入口；实际下载／file:// 由普通 Chromium验证。内置浏览器下载句柄兼容性、历史原生刷新／关闭手工签收没有在本轮扩展签收。旧 Material 30 组／1448 hash、旧 Identity／Storage CI 与 receipts 仅证明各自当时 SHA、输入和能力；不会因本轮导出而扩展为整个项目或生产签收。

下一步：沿原 P3 核对账户开通／启停／标识与角色管理差额，再以完整产品包实施；服务配置依赖继续列待补。建议 GPT-6.1 Sol / medium；涉及跨租户授权设计变更时再提高推理档位。
