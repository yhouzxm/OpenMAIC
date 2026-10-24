# 3461 统一试用入口交接与默认替换范围

2026-10-17 TJ-01／02／03 页面修订已在原3461课堂完成定向浏览器复验：学生文案、课程直接退出、取消保留文字及教师评分标题通过；作答及92分保留。旧启动receipt不改写，info报告3个预期UI源漂移，见[体验修订记录](zhiban-v2-p1-teaching-ux-local.md)。

2026-10-17 连贯教学试用已在原 3461 实例走通：学生“连贯备课：检查记录”首次正式提交，教师发布 92/100 和反馈，原 88 分及历史数据保留。本轮未重建实例，三处非阻断体验项详见 [试用记录](zhiban-v2-p1-teaching-journey-local.md)。账号及实时状态仍以 `pnpm trial:zhiban:info` 为准。

> 2026-10-17 P1 更新：已新建 3461 disposable 试用实例，三角色导航与课程列表已接线；新租户／教学班及账号以 `pnpm trial:zhiban:info` 为准。本页下方旧 PID、路径和 ID 只属历史记录。详见 [P1 本地记录](zhiban-v2-p1-portal-local.md)。

> 历史核对（P1 重建前）：原 3461 PID／临时根已不存在且端口未监听，当时未重建。下文运行数据与账号根属于交接时的历史状态；默认命令接线仍有效。后续按[界面与功能统一计划](zhiban-v2-migration-completion-plan.md)推进。

2026-10-16，LOCAL。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。文档交接后的命令接线现已实施：**默认启动／info／stop／verify 均指向 3461，显式 content 兼容入口与 legacy 旧模式入口并存**。没有启动、停止、重建、迁移或重签 receipt。实际核对见[接线记录](zhiban-v2-trial-entry-wiring-local.md)。

## 当前可直接交接

- [工作台](https://127.0.0.1:3461/zhiban?space=01a14505-1e98-752c-b372-1cc669735ff5&offering=01a14505-3417-71cd-8a33-fbb7246e2ed4)：当前空间与教学班活动接续。
- [教师待评分](https://127.0.0.1:3461/zhiban/grading?tenant=01a14505-1e98-752c-b372-1cc669735ff5&offering=01a14505-3417-71cd-8a33-fbb7246e2ed4)、[教师统计](https://127.0.0.1:3461/zhiban/analytics?tenant=01a14505-1e98-752c-b372-1cc669735ff5&offering=01a14505-3417-71cd-8a33-fbb7246e2ed4)。
- [学生概览](https://127.0.0.1:3461/zhiban/progress?tenant=01a14505-1e98-752c-b372-1cc669735ff5&offering=01a14505-3417-71cd-8a33-fbb7246e2ed4)、[管理员名册](https://127.0.0.1:3461/zhiban/roster?tenant=01a14505-1e98-752c-b372-1cc669735ff5&offering=01a14505-3417-71cd-8a33-fbb7246e2ed4)。

直达链接仍要求正常登录及相应课程授权。跨角色先退出；不同标签、127.0.0.1 不同端口不能当作独立账户会话。上述租户／课程 ID 在重建后失效，后续以 info 为准。

```sh
# 现在先执行，只读查看当前实例
pnpm trial:zhiban:content:info

# 仅在无运行候选、需要全新合成环境时执行
pnpm trial:zhiban:content

# 仅在不再需要当前课堂数据时执行；会删除 owned 双库、账户和数据
pnpm trial:zhiban:content:stop
```

角色为王管理员／周老师／陈同学。账号 ID 与密码从 info 所指的本机 0600 账户文件读取；当前根为 `/tmp/zhiban-trial-content-CkNgQo`，不在此文档复制密码。结束试用前应明确决定保留还是丢弃当前合成数据，不能为了命令改名自动停止它。

当前 TRY_01 为 2/20；安全巡检报告已到尝试 #1／提交 v2／96 分，旧 v1／94 分保留；另一活动 88 分保持，学生平均 92%。初始 fixture 与此不同，重建不继承这些记录。详细操作见[当前指南](zhiban-v2-trial-guide.md)。

## 默认命令替换（已实施）

以下四项已成组切换，直接复用既有 content 参数：

| 公共命令 | 切换前目标 | 已实施的精确脚本值 |
| --- | --- | --- |
| `trial:zhiban` | 旧 3459，`--trial --serve` | `tsx scripts/zhiban-local/run-m6-catalog.ts --trial-content --serve` |
| `trial:zhiban:info` | 旧 metadata／3459 | `tsx scripts/zhiban-local/trial-control.ts info --content` |
| `trial:zhiban:stop` | 旧 metadata／3459 | `tsx scripts/zhiban-local/trial-control.ts stop --content` |
| `verify:zhiban:trial` | 旧无内容 disposable 验证 | `tsx scripts/zhiban-local/run-m6-catalog.ts --trial-content` |

保留现有四个 `:content` 显式命令作为兼容入口，仍指向同一固定目标。默认验证命令的替换只是让验证范围与默认试用一致，不意味着在运行中的 3461 旁再执行一次；它会尝试占用同一固定端口，应在计划的新建 disposable 环境中运行。默认启动本身仍包含既有构建与启动核验，本轮不拆改或扩张这些行为。

旧 3459 模式保留为显式 legacy 入口，避免继续占用“默认”名称：

| 已新增命令 | 精确脚本值 |
| --- | --- |
| `trial:zhiban:legacy` | `tsx scripts/zhiban-local/run-m6-catalog.ts --trial --serve` |
| `trial:zhiban:legacy:info` | `tsx scripts/zhiban-local/trial-control.ts info --legacy` |
| `trial:zhiban:legacy:stop` | `tsx scripts/zhiban-local/trial-control.ts stop --legacy` |
| `verify:zhiban:trial:legacy` | `tsx scripts/zhiban-local/run-m6-catalog.ts --trial` |

**`--legacy` 已实现，上述命令现已可用；启动和停止仍会新建或删除相应合成数据。** `trial-control.ts` 的参数解析和展示名称已同步调整：接受显式 `--legacy`，拒绝 `--legacy --content` 组合及未知参数；legacy 模式继续使用旧固定端点／metadata／argv 校验，输出的 start／stop／错误帮助一律指向 `trial:zhiban:legacy`。直接无 flag 的旧调用继续保留 legacy 语义，并输出 legacy 命令；旧模式 info 不再提示执行已切到 3461 的默认 stop。

## 最小文件与边界

本轮应用代码只修改两处，另补独立参数／目标测试：

1. `package.json`：四个默认脚本改指 content，新增四个 legacy 脚本，保留显式 content 脚本；其他模块／OpenMAIC 命令不动。
2. `scripts/zhiban-local/trial-control.ts`：上述模式参数及命令名称调整；原 origin／PG／数据库／metadata／owner／PID／启动时间／准确 argv／构建 hash 和 stop 清理边界保留。不得根据“发现哪个进程活着”自动选择停止对象。

README.md、README-zh.md、TRIAL.md 和当前指南已同步完成状态。新增 `tests/zhiban/local/trial-control.test.ts` 仅使用模拟文件／进程，未连接真实 PG 或发送真实信号。

不需要修改 `run-m6-catalog.ts` 或 `verify-m6-catalog.mts` 的固定端点、fixture、验证或生命周期：它们已支持 content／旧 trial 两种模式。也不需要新 SQL、helper、ACL、expected profile、冻结生产语义、已应用 migration 或普通固定 55433 loader 的变更。

| 项目 | 3461 content | 旧 legacy |
| --- | --- | --- |
| HTTPS | 3461 | 3459 |
| PG16 私有 socket 端口 | 56517 | 56515 |
| 业务库 | `zhiban_trial_content_disposable` | `zhiban_trial_disposable` |
| 内容 Native 库 | `zhiban_trial_content_native` | 无本轮统一内容库 |
| metadata | `zhiban-trial-content-demo-local.json` | `zhiban-trial-demo-local.json` |
| close receipt | `zhiban-trial-content-demo-close-local.json` | `zhiban-trial-demo-close-local.json` |

保持各自 metadata、PID／启动时间、根目录、双库及停止目标，不复制或覆盖旧证据。旧 3459 根此前最后核对已不存在，其课堂数据不可声称仍可恢复；显式 legacy 启动也是新合成环境，不是恢复历史。

## 定向核对与后续生命周期边界

- 静态核对默认四项、content 兼容四项、legacy 四项脚本值及控制器模式选择／帮助一致；未知／冲突参数必须在读私有文件或发信号前拒绝。
- 使用当前 3461 仅做默认 info 和显式 content info 的只读一致性核对，不能为验证 stop 而停止正在使用的课堂实例。针对端点／PID／argv／构建绑定不符，用隔离 fixture 检查拒绝且不发信号。
- 只有在另行计划新建／清理 disposable 实例时，才做一次相应启动／停止生命周期验证；不重跑已完成课堂或 GitHub CI。若代码只改上述别名与解析，不改安装／provider 接线，不要求重新验证全部 M5 故障切点。
- 命令改名不迁移现有数据、不变更运行中进程的 argv、不重签其 receipt。package.json／控制器的新漂移另行记录。今后完整重建再生成真实匹配的新 metadata／receipt，不能把旧文件改成“零漂移”。

## 交接状态与延期项

本轮 info 确认 3461 为 RUNNING_LOCAL_DISPOSABLE；启动来源现有 content.html、learning.js、workspace.js、package.json、trial-control.ts 五项漂移，静态补丁与后续课堂证据按各自范围适用。原 12/12 及旧 CI 只保留原构建／SHA 范围，不扩张签收。

原生刷新／关闭提示与取消按用户要求延期、未签收，不阻塞当前课堂；页面内离开保护已验证。跨页课程自动定位、真实身份入驻、真实数据迁移及生产容量未交付。Runtime、AI、真实 55432/55433、Native／维护输入、UNKNOWN／RESERVED 处置及完整 enabled gate 继续隔离。M5 在本候选的文本／PNG 接入不代表这些门禁已开启。

原[交接清单](evidence/zhiban-trial-entry-handoff-local.json)保留修改前状态和 hash。本轮新增[接线证据](evidence/zhiban-trial-entry-wiring-local.json)，绑定当前文档与源码；不改写原 receipt。仅运行本地模拟参数／目标测试及真实只读 info，没有启停实例、执行课堂套件、CI、提交或推送。

下一步：通过 `pnpm trial:zhiban:info` 继续当前课堂使用；仅在需要全新合成环境并接受丢弃当前数据时，另行计划启动／停止生命周期。无需重复已完成课堂或 CI；常规产品工作建议 GPT-6 Sol / medium。
