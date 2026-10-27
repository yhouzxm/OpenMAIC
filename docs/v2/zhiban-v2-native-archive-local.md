> 2026-10-27：[原生整课视频导出＋教师控制的课堂共享](zhiban-v2-course-video-sharing-local.md)已 LOCAL 接通并完成真实渲染／下载及双浏览器旅程。同步限定固定课件位置、播放状态和教师公开板书文字／小结，私人 AI 内部状态不广播；永久视频归档和大班／长课容量未据此签收。

# 原 P3／P6：原生全格式课件归档与恢复（LOCAL）

2026-10-26。沿原计划第 6 节资源与附件大包，复用 OpenMAIC v1.2.1 原生 manifest、PPTX／互动资源包、standalone HTML、Markdown／DOCX 讲稿及隔离 PPTX 解析器；仅补课程授权、固定来源和安全恢复。不另建课件编辑器，不改已应用 migrations。

## 使用入口与格式

默认 `pnpm trial:zhiban`，入口 `https://127.0.0.1:3461/zhiban`。任教教师从课程原生备课工作台点击「课件归档与恢复」，先保存当前文档再进入；也可在已发布完整课件查看页点击「课件导出与恢复（教师）」进入，按 resource／publication 固定来源。

| 格式 | 内容及用途 | 恢复边界 |
| --- | --- | --- |
| `.maic.zip` | 原生兼容 manifest、四类场景、动作／讲稿、Quiz／PBL 设计、生成 Agent 设计与已存储媒体；智伴扩展保留全局白板和完整设计及 SHA256 | 本包完整设计恢复入口；新 owner／stage／scene／asset，不带任何源课程授权 |
| `.pptx` | 原生 PPTX builder；图文、公式、音视频；Quiz／互动／PBL 使用原生占位页 | 隔离原生解析器转为静态幻灯片；不承诺反向还原互动逻辑／PBL 或 Office 像素一致 |
| PPTX＋互动资源 `.zip` | 原生资源包生成器；PPTX 与自包含互动 HTML | 交付包，不作为 `.maic.zip` 恢复入口 |
| 离线 `.html`／大型内容 `.zip` | 原生离线播放器、媒体、讲稿和自测／项目简报；大型内容按上游规则回退 ZIP | 可离线查看；在线 AI 仍需原课程登录和当前开关；不带本人 AI／PBL 状态 |
| Markdown／DOCX | 原生讲稿编排及文档生成器 | 讲稿交付，不是完整课件恢复格式 |

实际 PPTX 转换已出现原生 OMML→LaTeX／DOM 及视频编码识别警告；其静态页数和新副本恢复通过，公式、音视频与版式的反向保真不在签收范围。需要完整设计及资产时使用 MAIC。

上游实验性 MP4／视频渲染仍受 feature flag 及真实渲染服务限制，本包明确未启用。不能把上述稳定格式称为包括实验视频的全部能力。

## 恢复与发布

选择本地 `.maic.zip` 或 `.pptx` → 核对结构、摘要与资产数量 → 可信扫描 → 创建本课程、本人新的原生编辑副本 → 打开原生工作台核对 → 采用为独立课程草稿 → 显式发布。检查文件不写数据库；恢复不覆盖其他课件，也不自动发布。恢复可从其他课程的合法离线归档创建新副本，但文件内 tenant、成员、发布标识和来源摘要均不能授予权限。

恢复记录在新文档 `outline.restoredFrom` 保存归档 SHA256、格式、时间与本机可信扫描引用。原 sourceDigest 仅是来源标签，文件内容的原始 SHA256 与每个媒体摘要另行验证；这些不是数字签名，也不证明归档由某位教师签发。

同文件、同 command 的请求用确定性目标与 PG advisory try-lock 查证既有副本，重试不重复导入或覆盖后来编辑。保存文档／认领本人待绑定资产是原 Native 原子提交点；提交后丢失 ACK 通过查证副本处理，不盲目删除。孤立的未认领资产沿用 Native pending GC。新的 command 表示另建副本。

## 授权、清理与并发

- 每次读取、下载交付、恢复资产写入和最终文档保存均核对原请求的当前 Identity／任教授权；不以可变化的 owner 全局绑定替代请求授权。管理员身份本身不授予教师作者权限。
- 草稿只读本人 owner；已发布导出检查当前课程访问与指定活跃 publication，构建结束再核对。页面缓存课件后每次下载前仍检查；已下载的离线文件无法撤回，校内内容交付按此边界管理。
- 导出与恢复最多两个重任务；HTTPS 入口读取原始归档前另限两个上传槽位。扫描／格式转换不持有长 Identity／发布锁；短写重新获取原冻结授权屏障。
- 归档压缩体 ≤64 MiB、展开 ≤128 MiB、单项 ≤32 MiB、≤512 项。PPTX 另沿用上游 ≤8 MiB、≤80 页、隔离转换超时。路径／重复文件／加密／符号链接／CRC／虚报解压大小／缺失或未知媒体项拒绝，不向磁盘展开归档路径。PPTX 恢复显式使用原生 worker 的可选离线模式，只允许包内 data／blob 字节，HTTP／HTTPS／相对公式服务请求在派发前拒绝；普通原生导入默认行为不变。
- 恢复必须具备实际 `TRUSTED_SCANNER.checkArchive`。沿用受限 ClamAV profile、文件 hash／权限、数据库新鲜度及执行前后 pin 核对；专用受控归档参数和缓存分域，原作业附件扫描参数及 receipt 不变。无 scanner、恶意文件、超限或扫描失败均拒绝恢复。
- 学生成绩、Attempt、Enrollment、聊天、个人 PBL 执行／评价／报告、课程完成与可信 Runtime receipt 不写入归档。PBL 通过原生设计模板清理；旧 Native 维护链仍隔离。

## 定向验证

```bash
pnpm exec vitest run tests/zhiban/native-archive tests/zhiban/learning/scanner.test.ts tests/export/pptx-export-hook.test.ts
pnpm exec tsc -p scripts/zhiban-local/tsconfig.native-authoring.json --noEmit
pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --classroom-ai-focus --native-archive-focus
```

命令使用独立 disposable PG16／HTTPS 与真实可信扫描器，不运行模型、无关课堂全回归或 GitHub CI。编解码与故障单测中的注入 scanner／store 只证明对应故障边界，不能替代真实扫描与 PG 成功。实际结果、下载摘要、页面与默认持久入口以本包 evidence／closeout 为准。

本轮源码尚未纳入历史 P7 源码／密文包，原远端 run 40096542805 PASS、既有模型证据保留各自原 SHA／source 与适用范围。下一完整包为统一持久化交付：一次纳入新原生备课、课堂、自主 PBL、归档恢复及 UI 的稳定源码／配置／安装恢复说明；真实跨机运行仍需具体授权。常规整合建议 GPT-6.1 Sol / medium，复杂身份／恢复并发用 high。

本包实际证据：`evidence/zhiban-native-archive-local.json` 为 disposable PG16 授权／真实扫描／采用发布与六格式下载旅程；`evidence/zhiban-native-archive-downloads.json` 记录实际文件 hash／大小；mobile／offline PNG 为原生页面截图。默认 3461 的恢复及重启范围单列 `evidence/zhiban-native-archive-persistent-local.json`；全部源码／证据与本轮检查汇总见 `evidence/zhiban-native-archive-closeout.json`。这些均为 LOCAL，模型调用为零，未提交／推送／CI。

最终收尾差额：disposable 旅程完成后补了导出端单项／展开总量上限，避免生成自身无法恢复的文件，并为归档 PPTX worker 加离线网络限制。前者有边界单测及默认 MAIC 页面旅程；后者有拒绝派发检查、原生导入回归及最终 3461 真实 PPTX 导出／可信扫描／静态恢复，未为这两项重跑其他已通过格式。

签收状态：最终 3461 持久实例 `sourceMatches=true`、漂移0；原账号 SHA256 不变，原两份已完成 PBL 报告及新 MAIC 副本在重启后仍可读取。最终离线 PPTX 页面恢复通过，随后完成包含新副本的三库热备份。无模型调用、提交、推送、CI或生产部署。
