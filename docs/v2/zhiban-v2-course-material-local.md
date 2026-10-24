# P3 教学资源归属与发布本地产品包

2026-10-18，LOCAL 未提交候选，沿[原P1–P7主线](zhiban-v2-migration-completion-plan.md)。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，需连同当前dirty工作树及最终来源收据使用。

## 可用范围

教师在课程“讲义与图片”的上传区上传有效UTF8 TXT、Markdown或PDF，先查看解析草稿，再显式发布。章节目录有“本章上传资源”，上传后可“返回原章节并加入资源”；保存／发布目录后，学生从学习中心进入对应MATERIAL单元，查看已发布解析文本，下载该publicationNo对应原文件。

直接复用官方1.2.0 `resolveWorkbenchMaterialMime`、`extractDocument`、`plain-text`和`unpdf`，不新建第二套解析器，不把原生owner素材API当作租户课程授权。详情见[设计及授权合同](zhiban-v2-course-material-design.md)。现有PNG讲义、活动、测验、评分、讨论与个人资料保留原产品范围。

源文件、解析结果及每次发布不可变。替换文件只更新教师草稿，学生仍读上次发布；再发布才切换。当前有访问权的学生可以读取已发布历史版本；退课后预览及下载拒绝。归档后学生立即失去访问，目录引用停止展示；已关闭教学班仍可读发布历史，写入拒绝。资源写权限限当前任教的原创建者，不以管理员身份代写。

单文件≤1MiB，每教学班100份资源、历史字节合计32MiB，每份20个源版本。解析输出≤100000字符，纯文本呈现，不执行Markdown内嵌HTML。PDF保持原件下载，文本预览不保留排版、图片／表格；扫描件无文字时明确提示，不能冒称OCR成功。Office／OCR／音视频服务未接入，不展示为可上传格式。阅读不产生学习完成、成绩或AI事件。

## 验证与证明边界

新增独立 `zhiban_material` schema，旧27个migration字节不变，无Identity／Bridge／Native ACL扩张。只在默认owned PG16 56517／HTTPS3461安装；独立PG16 56526构建expected catalog／ACL后清理。运行只读loader核验来源hash、ledger及完整schema／ACL。原Content／PNG／Profile／Discussion参考保留各自范围，组合全部通过后才启用。

资源原件在可信ClamAV扫描通过后调用官方本地解析；扫描与提取结果按字节hash绑定。解析通过无凭据环境的独立Node进程执行，30秒／256MiB JS heap限制，直接加载tsx，结束／超时终止实际进程。来源闭包含document／pdf源码、esbuild计算出的本地依赖、tsx loader、SDK及lock，参考构造不代替真实产品旅程。

每次操作检查Session／Tenant／Membership及当前任教／Enrollment。处理文件前授权，处理后重新授权，随后CAS和配额校验；文件／提取文本／指针／账本同事务，故障回滚。未知结果按原命令重试，已提交重放不依赖扫描器重新可用。下载通过携带原身份头的fetch及临时blob，服务端不放宽到裸导航，强制attachment、nosniff、no-store和sandbox CSP。

定向用例覆盖原生TXT／Markdown／真实PDF解析与坏PDF拒绝、注入／尺寸／格式校验、未发布保密、角色／跨租户、固定版本及历史原件、并发发布、EICAR、事务切点重试、归档／关闭／退课、不可变ACL和扩权loader拒绝。结果：5个定向文件21项通过；默认统一教学旅程30组通过，其中5组为新资源包。另在最终运行host完成章节入口UI接续：本章上传→原生解析→发布资源→返回原章加入→保存／发布目录→学生进入新单元→实际下载原件，5项检查通过。内置浏览器随后以当前合成学生账号从工作台进入课程学习中心，确认新资源正文及publicationNo=1下载入口可读；真实字节下载由上述Chromium旅程验证，不冒充内置浏览器下载句柄签收。

受影响依赖闭包TypeScript通过；新增及其他受影响源码ESLint通过，原内容页的既有32项explicit-any以基线对照单列、无新增。27个旧迁移hash不变；当前1448项运行来源匹配，`sourceMatches=true / drift=0`。完整来源与范围见[最终交付收据](evidence/zhiban-course-material-local.json)、[统一资源旅程](evidence/zhiban-material-journey-local.json)及[章节UI接续](evidence/zhiban-material-chapter-flow-local.json)。

原内容页有32处既有explicit-any ESLint错误，本轮与变更前快照逐条规则／消息计数对照相同，无新增；不把它们记为本轮全部lint通过。新增与其他受影响源码分别检查。首轮统一旅程在已有成员目录测试中抢先展开旧查询结果，导致表单重绘后输入不可见；仅给该用例补“查询结果只剩目标一人”的等待屏障，未修改资料生产逻辑。初次失败日志保留，不计为产品PASS。后续真实上传页面发现新上传区未向课程壳登记表单根节点，导致“扫描并解析”误触离开确认；已补root引用，最终30组与章节UI接续均通过，章节用例额外核对上传过程中没有错误离开对话框。

原生脏页刷新／关闭人工签收仍deferred；Native Runtime／AI及真实维护输入隔离，旧GitHub CI只覆盖其各自SHA／来源范围，不签收本包。

## 数据交接

本轮有一次备份操作失误：前置校验将metadata中的PG端口56517误当作HTTPS3461，校验失败，但后续停止命令仍执行，旧 `/tmp/zhiban-trial-content-NooUM6` 资料试用实例已删除，未生成本轮可恢复备份；不能声称其数据已保留或已恢复。此前 `/home/zxm/.local/state/zhiban-trial-backups/discussion-20261018-190550` 与 `profile-20261018-195616` 两份私密历史备份仍在，只适用各自旧范围，不含该资料实例。已向用户说明；后续生命周期命令使用前置成功才继续的执行方式。

当前重建为新合成课堂；在最终旅程及章节接续通过后，已对当前新实例完成私密双库dump与账号备份至 `/home/zxm/.local/state/zhiban-trial-backups/material-delivery-20261018-203858`（目录0700、文件0600）。[备份范围](evidence/zhiban-material-backup-local.json)明确它仅覆盖新资源课堂，不恢复已删除的上一P3资料实例。当前账号文件 `/tmp/zhiban-trial-content-49kok0/accounts.json`；实时入口以 `pnpm trial:zhiban:info` 为准。NO COMMIT／PUSH／CI，不访问真实55432／55433，不改写已应用迁移。

下一步沿原P3接新版PPTX／离线HTML导出与课程已发布内容授权；Office／OCR另待已配置解析服务。建议 GPT-6.1 Sol / medium。
