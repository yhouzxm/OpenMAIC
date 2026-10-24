# 固定发布版本的 OpenMAIC 原生 PPT 播放（LOCAL）

2026-10-20，原 P4。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。使用当前已升级的 OpenMAIC v1.2.1 候选；不提交、不推送、不触发 CI。

## 实现

直接导入 `lib/standalone-player/App.tsx`：PPT 画布、播放控制、页码、场景目录、键盘导航和全屏均为 OpenMAIC 自带实现。未复制一套播放器、未改原生 App／引擎。新增的 `published-player.tsx` 仅负责读取宿主数据、授权／版本存活检查和卸载；CSS 只限定宿主页的上下文条与可用高度。原生 CSS 复用现有 standalone-player 构建产物。

课程资源的已发布预览、课程学习中心的讲义单元均提供“使用 OpenMAIC 原生 PPT 播放器”。进入前仍经过课程的离开保护。播放器同标签打开；“返回课程页面”使用浏览历史回到原课程、单元或课堂资源上下文，原生翻页只 replace 场景 hash，刷新恢复该场景。

本包只播放**现有固定发布的文本／PNG slide 场景**。服务端将经过 Content／Bridge／Native 校验的不可变发布结果转成原生 manifest，文字按 HTML 文本转义，PNG 只使用带 publicationId 与 slideId 的受限资源网关；不读取可变草稿，不直通 AI 原始文档。采用前已经明确不采用的原生布局、任意 HTML、动作、音视频和其他场景类型不会因此恢复或启用。本入口自主浏览；上一包课堂讲义页的教师跟随仍保留，不把自主播放当作同步或完成记录。

## 发布与授权

`GET /api/zhiban/content/:tenant/offerings/:offering/resources/:resource/player?publication=:UUIDv7` 必须精确匹配当前 ACTIVE 发布。现有 Content READ 的 Identity／Membership／课程任教或 Enrollment、业务上下文锁、Bridge active generation、来源／摘要和 Native final check 全部沿用。新读入口不增加角色、ACL、migration 或生产身份语义。

播放器每 5 秒、重新可见／联网及 pageshow 时通过原有预览 API 带 `x-zhiban-publication-id` 重新核对。保存新草稿不影响旧发布；发布新版本、撤回或撤权后卸载播放器，不偷偷改播 latest。断网暂留已读页面，重新进入则须重新认证；已交付客户端的内容无法离线撤回，不承诺即时远程擦除。

播放 HTML 使用 `private, no-store`、`nosniff`、`DENY/frame-ancestors none`，只允许本源脚本／图片／连接，阻止 frame、媒体、worker、object 与外部资源。仅此独立文档允许原生 React 画布所需 inline style；没有 inline 可执行脚本／eval，课程编辑页原 CSP 不变。嵌入 JSON 使用上游序列化函数转义 script 终止符。普通文档导航在严格 Fetch Metadata 下进入同一认证读路径，不把 URL 当作授权。

## 验证与证据

专项命令：`pnpm verify:zhiban:native-player`。只验证受影响的教师发布、学生原生播放与授权／换版边界；不调用模型，不伪造生成 run，不重复 AI、附件扫描、导出、完整课堂或 GitHub CI。

定向类型检查、manifest 注入／资源引用检查与新增文件 ESLint 通过。受影响的真实浏览器旅程包括：教师文本／PNG 草稿保存和显式发布、师生两入口、PNG 网关读回、原生目录／前后页／键盘／全屏、刷新恢复、移动端无横向溢出、返回原课程；负向覆盖匿名／管理员／无关成员、畸形／跨站／错误固定版本、Enrollment 撤销、草稿与发布隔离、新版替换和撤回。浏览期间没有写请求或外部请求，没有产生讲义 Attempt／完成或成绩。第一次恢复测试只改 hash，没有重新进入已停用页面，已按真实重载修订；保留失败记录，最终专项 PASS，失败和成功的 owned cluster 均已停止／清理。

结果以[专项 LOCAL receipt](evidence/zhiban-native-player-local.json)及[旅程](evidence/native-player/journey.json)为准。旧 3461 在停止前已做[三库备份](evidence/native-player/before-backup.json)，TOC 核验通过，未进行恢复演练；新实例不会被称作旧教学数据恢复。原来的模型与上一包 receipt 保留原适用范围。

## 默认入口与内置浏览器

新默认 3461 已启动，`trial:zhiban:info` 核对源码匹配、漂移为 0。[演示引用](evidence/native-player/default-demo.json)记录新合成课堂／发布 ID；三页文字复用以前备份的真实模型投影，通过普通教师 API 新建、保存、编排和发布，没有重发模型请求，也没有恢复或伪造旧 run。内置浏览器从学习中心实际点击原生播放入口，再点击下一页，显示 2/3 及例题公式；[截图](evidence/native-player/default-iab.png)保留实际原生页面，标签页已留作交付。

[源边界](evidence/native-player/source-boundary.json)确认原生播放器源码／产物、此前已应用 migration 及冻结 Identity 文件未变。专项通过后仅修正宿主页高度：根节点扣除上下文栏，原生 App 占满剩余空间；此 CSS 收尾由默认内置浏览器复验另记，专项 receipt 保留此前 CSS hash，不重签或扩大其来源范围。

当前三库另做[备份](evidence/native-player/default-backup.json)，仍只验证 TOC，未承诺恢复成功。账号路径只从 `pnpm trial:zhiban:info` 获取，密码和模型 key 不进入公共记录。全文件既有 `any` lint 债务未在本包清理，不声称全仓 lint／全仓测试通过。

完整 Native Runtime、Interactive／VirtualLab、Tutor／Agent、可信学习完成与维护 deferred gates 仍未启用。下一完整包按原 P4 核对互动场景的可复用宿主和所需真实 provider；只在合同满足后接入，不把播放页或客户端事件冒作可信证据。常规产品接线建议 GPT-6.1 Sol / medium；新增跨 Identity／并发协议用 high。
