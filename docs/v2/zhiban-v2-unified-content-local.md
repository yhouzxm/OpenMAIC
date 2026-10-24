# 统一文本／PNG 内容候选

2026-10-16（Asia/Shanghai）。**LOCAL_VERIFIED_RUNNING_DISPOSABLE**。分支 `refactor/zhiban-v2`，基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，未提交／推送／派发 CI。

## 入口与账户

当前候选已运行：**https://127.0.0.1:3461/zhiban**。内置浏览器保留学生的真实文本＋PNG 预览页面。三角色使用同一 origin／租户／教学班，M1–M4／M6 教务、学习和成绩入口与内容入口共存。

```sh
pnpm trial:zhiban:content       # 新建独立候选，已有实例运行时不要重复启动
pnpm trial:zhiban:content:info  # 当前三角色 ID、私有账户文件及各页面
pnpm trial:zhiban:content:stop  # 仅停止并清理本内容候选
```

密码仅在 info 给出的本机 0600 `accounts.json`，临时根为 0700。退出后再切换角色；127.0.0.1 不同端口共享 Cookie，不将不同标签页视为隔离账户。停止删除本候选双库、账户、讲义及其他合成数据，重启生成新账号。

候选 PG16 56517 只监听 owner-only Unix socket，不接受 TCP；业务库 `zhiban_trial_content_disposable`，Native 库 `zhiban_trial_content_native`。沿用原受信开发 CA，Node HTTPS 和内置浏览器均验证证书，没有绕过安全警告。原 `trial:zhiban`／3459 命令未自动切换为此候选。

## 实现与实际旅程

`trial-content.ts` 在新自建双库安装已有 Content 0001／PNG 0002 候选及公开 Native schema；复用固定 PNG expected profile 与 Native 指纹，**无需新 SQL／helper／ACL／profile**。安装阶段用管理连接核对原 16 个 ledger；加载阶段使用原 Bridge／Native 受限角色核验内容 ledger、profile、部署 binding、角色图／ACL及 Native catalog，未扩大运行角色权限。

候选私有 receipt 绑定固定 origin／端口／双库／根目录／socket、部署 ID、SQL、固定参考、公开包 src／dist、lock、实现、私有 editor bundle、CSP 和 TLS hash。`content-receipt.ts` 只抽出原数据库检查供复用；普通 loader 的固定 55433 端点／来源检查仍保留。纯参数负向已确认普通 loader 拒绝本候选端点，没有连接真实 55433。

公开 DSL／Storage／Editor／Renderer 源与当前 HEAD 比较后重新构建；候选 editor 输出在自身临时根内，不覆盖共享 `content-client.js`。统一宿主组合原 ContentService／HTTP，内容页使用原 PNG 局部 CSP，图片响应按原 gateway 流式传递及取消，不将 Native 字节路径公开。

教师从原工作台进入内容页，创建“课堂讲义：急停与安全复位”，保存文字草稿；畸形 PNG 被拒绝，正确 320×180 PNG 登记、加入 slide 后保存并显式发布。学生从本人工作台进入，只读看到文本和解码图片，无编辑／上传按钮。随后改版使旧图片 URL 拒绝；撤回后预览拒绝；教师显式重新发布后学生读取当前版本。最终保留一页文本＋PNG 示例，图片为合成图，不是外部素材。

## 验证与证据

[运行 metadata](evidence/zhiban-trial-content-demo-local.json)记录 **12/12 PASS**：2 项安装／loader 检查、5 项统一试用准备／短冒烟、5 项内容旅程。包括错误 target／artifact hash／额外数据库 TEMP 权限拒绝；草稿保护、无效 PNG、真实发布／解码、HEAD／Range／no-store／CSP；管理员／未入班／外租户／匿名资源拒绝和学生写入拒绝；改版／撤回／重新发布。管理员目录按原合同返回空列表且 `canEdit=false`，不误报成资源可读。

[核对补充](evidence/zhiban-trial-content-checkpoint-local.json)绑定内置浏览器截图及 metadata hash，确认当前源码清单零漂移、16 个已应用 migration hash 不变。定向 TypeScript、新文件默认 ESLint、既有动态 JSON 文件关闭 no-explicit-any 的定向 ESLint、格式／空白检查通过，不声称全仓库 strict lint／tsc 或全套 M5 回归通过。

前两次失败记录单列：首次把基础 ledger 校验放在没有该读取权限的 Bridge 角色上，已保留在安装阶段且未增权；第二次误断言管理员目录必须 403，已按原空列表合同修正。失败自建 PG 均已停止，两个诊断根已按 owner／准确路径／无 postmaster 校验清理。最终成功候选保留运行，尚未停止，不声称它已清理。

## 原 3459 状态与限制

本轮最后只读核对发现：原 metadata 指向 PID 12716／`/tmp/zhiban-trial-pdjLeW`，该进程及临时根均已不存在，3459 未监听。现有 close receipt 属于另一个旧根，不能用于解释该实例何时或由谁停止。**本轮未向旧进程发信号或删除旧根，也无法声称旧课堂数据仍可恢复。** 旧 metadata 和课堂截图／证据保留；候选使用新合成数据，不承接旧五次作答或 88／92／96 分记录。此前“原实例继续运行”的表述据此更正。

本次实现启用的是 disposable 内容预览／编辑发布，不是 Runtime、AI、真实 55432／55433 升级、维护恢复、终态对账或完整 enabled gate 签收。UNKNOWN／RESERVED 隔离保持，PDF／PPT／附件／音视频及互动课堂不接入，讲义浏览不产生提交、成绩或完成事件。历史 M5／CI 证据只保留原适用范围，本轮没有重跑其全部故障切点。

下一步建议在 3461 做一次“教师讲义授课 → 学生文字作答 → 教师评分”的连贯课堂试讲，优先修复实际阻碍，再决定默认入口交接。建议 GPT-6 Sol / medium。NO COMMIT / NO PUSH / NO CI DISPATCH。
