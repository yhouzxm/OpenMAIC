# 统一试用：讲义／PNG 接入边界

2026-10-16（Asia/Shanghai）。状态 **SCOPE_READY_FOR_IMPLEMENTATION**，本轮仅核对代码并确定接线方案，尚未启用内容服务。分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留当前未提交候选。依据 [M5 范围](zhiban-v2-m5-scope.md)、[A/B 交付](zhiban-v2-m5-ab-local-closeout.md)、[PNG 交付](zhiban-v2-m5-c-png.md)及[统一试用指南](zhiban-v2-trial-guide.md)。

## 首批产品范围

“讲义”定义为现有受控 slide 文本＋已登记 PNG。教师从同一个工作台进入本教学班的内容目录，使用现有编辑器创建／编辑草稿、预览、上传／选择 PNG、显式发布和撤回；学生在同一登录会话中查看本班当前发布讲义和图片。管理员继续管理教务，不凭管理员角色取得内容编辑或学生内容阅读授权。

沿用 M5-A/B/C 现成能力，不重新设计 editor、存储格式或发布协议。讲义浏览不创建 Attempt／Submission、成绩、完成率或学分；M3 文字活动、M4 人工成绩和 M6 统计仍保持独立。界面用“教学讲义”表达用途，教师标明编辑／发布入口，学生标明只读入口。

首批不接 PDF／PPTX／Office 导入、学生附件、外链抓取、SVG／HTML、音视频、AI、交互 Runtime、多场景课堂执行或虚拟实验。不会把 slide 预览写成 Runtime 已启用。

## 已确认的接线缺口

| 位置 | 当前实际情况 | 本次候选应做的增量 |
| --- | --- | --- |
| `verify-m6-catalog.mts` | 统一试用内容页面固定返回 `trial-content-closed.html`；未组合 ContentService／内容 HTTP | 在独立统一候选中组合现有 ContentService 和 contentHttp，挂载真实目录／预览／PNG gateway；未通过启用核验时拒绝启动内容候选 |
| 统一 PG | 当前业务库包含 Identity／Academic／Learning 等；没有独立 Native 内容库接线 | 新自建实例使用同一业务库＋独立 Native 库，按已有版本和 ledger 安装 Content／PNG 候选及 Native 角色，不改旧 migration |
| `verify-m5-png.mts` | 已有独立双库公开 provider 实际旅程；直接组合服务，不能当成普通 receipt loader 验收 | 复用其安装顺序及真实公开 provider；将统一候选的启动核验／来源绑定显式实现，不照搬其测试 bootstrap 作为安装证明 |
| `content.ts`／`content-receipt.ts` | 普通 loader 绑定固定开发库、端口、数据目录和私有配置 | 保留固定开发入口原检查；候选用显式 disposable target 描述及独立核验入口，复用内容／ACL／ledger 校验，不让原 loader 接受任意 DSN 或假装 55433 安装 receipt |
| 内容客户端／CSP | 现有独立编辑器 bundle 和 PNG 局部 CSP 可复用 | 候选构建到自身私有目录，绑定公开包来源／lock／artifact hash，只在内容页应用 PNG CSP；不放宽普通工作台 CSP |

实现时优先复用现有 PNG 固定 expected profile。若统一 M6 依赖闭包导致参考不匹配，须列出精确 SQL／ACL 差异，并从隔离参考构建生成有来源的候选 profile；不能把目标实时 catalog 的 hash 反抄为可信期望，也不能省略不匹配检查。预计无需新增业务 migration／helper／ACL；若实际发现需要增量，先记录具体差异及影响范围。

## 必须保持的服务边界

1. **授权**：每次目录、预览、发布及图片请求仍由真实 Session、当前 Tenant／User／Membership／grant 和精确任教／Enrollment 判定。教师写入沿用原 Origin、CSRF、command key 和 CAS；不提供匿名静态图片、假教师 actor 或常量通过 gate。
2. **版本**：草稿与不可变发布分开，学生只能读本班当前可用版本；保存不隐式发布。撤回／切换后拒绝后续旧版本请求；失败保留旧发布，UNKNOWN／RESERVED 仍隔离，不重放、不对账激活。
3. **PNG**：沿用原 RGB/RGBA、非交错校验及 4 MiB／边长 4096／4,194,304 像素限制，精确资源／场景／版本绑定；gateway 保持 GET／HEAD／单 Range、private no-store、nosniff 和有界撤权检查。浏览器不获 Native 地址或凭据，已下载字节不声称可远程收回。
4. **公开包与来源**：复用固定公开 DocumentStore／AssetStore、editor／renderer exports；记录源、锁文件、构建 artifact、SQL、profile、provider 和 TLS hash。不能只替换 CLOSED 页面成带 mock 内容的页面。
5. **隔离**：Runtime／AI／control／维护及终态恢复入口继续关闭；不访问真实 PG 55432／55433，不读 Native／维护凭据 staging，不清任何真实维护旗。真实部署和完整 enabled gate 的 deferred 状态不被此次 disposable 接线覆盖。

## 新实例与当前数据交接

先实现并行候选，拟固定 **HTTPS 3461／PG16 56517**，业务库 `zhiban_trial_content_disposable`、Native 库 `zhiban_trial_content_native`；PG 仅 owner-only Unix socket，拒绝 TCP。实施前核对端口占用，若已被其他进程使用则明确失败，不接管或自动换端口。

建议入口 `pnpm trial:zhiban:content`，并提供对应 `:info`／`:stop`。候选使用独立 metadata、PID／启动时间、双库／临时根、build／receipt hash 和随机三角色账户，不覆盖原 `trial:zhiban` 的启动记录或停止目标。候选停机只清理其自建资源，校验停止后再删根目录；失败保留可定位的诊断与隔离状态。

当前 3459／56515 和五次历史提交、88／92／96 分等课堂数据保持原样。候选使用新合成数据，含既有三角色教学功能和两页文本／PNG 讲义。统一指候选内三角色共享一个 origin／租户／教学班，不把 3444 与 3459 拼接跳转，也不迁移浏览器 session。不同端口共享 Cookie，验证时按角色正常重新登录并关闭会自动刷新的其他试用标签，不伪称跨端口账号隔离。

候选验收后再形成默认入口切换清单。不会在本轮边界梳理中停止原实例或删除其数据；需要替换时先明确当前数据去向和新账号交接。

## 本地验收与证据范围

实现阶段一次完成真实 UI → Identity → Content／Bridge → 双库公开 provider：教师上传／编辑／预览／发布；学生从工作台打开文本＋PNG；教师撤回及改版；同时确认既有学习／评分入口可用。必要负向限定为未登录／非任教／未选课、跨班／草稿／旧版本／未引用图片、错误 PNG、发布失败与未知结果保持旧版本及隔离。复用既有下层 M5 证据，不重跑全部基础测试或 GitHub CI。

新的 LOCAL receipt 必须绑定实际 target／双库、PG16、受限角色／ACL、ledger／expected profile、provider／artifact／TLS hash、启动状态及停止／清理边界；错误 target、来源 hash 或 ACL 不匹配时 fail closed。现有 M5 23/23、历史 A/B 和 CI 只保留原 SHA／实例适用范围，不移植成新统一候选通过证据。

本轮没有执行新 PG／构建／测试，也没有接线或打开 capability。下一步实现上述并行 disposable 候选，完成一次定向本地教学旅程后再交接默认入口。建议 GPT-6 Sol / medium；涉及实际 SQL／ACL／receipt 校验差异时单独做精确评审。NO COMMIT / NO PUSH / NO CI DISPATCH。
