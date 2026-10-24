# 默认试用命令接线（LOCAL）

2026-10-16。按[交接清单](zhiban-v2-trial-entry-handoff.md)实施默认与 legacy 接线。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；原有大量未提交候选保留，本轮不提交／推送／派发 CI。

## 已实施

- `trial:zhiban`、`:info`、`:stop` 和 `verify:zhiban:trial` 成组指向既有 `--trial-content`／`--content` 目标：HTTPS 3461、PG16 56517、自建双库、content metadata。
- 原显式 content 四项命令不变。新增 `trial:zhiban:legacy`、`:legacy:info`、`:legacy:stop` 和 `verify:zhiban:trial:legacy`，分别保留旧 3459 启动与验证，以及显式 `--legacy` 控制。
- `trial-control.ts` 在读取 metadata 或发信号前拒绝未知、冲突、重复、多余和错位参数。直接不带 flag 的历史调用继续使用 legacy 语义；legacy 的状态、启动提示、stop 提示使用 legacy 名称，不会指向新默认实例。
- 原固定端点／metadata、owner、PID／启动时间、准确 argv、bundle hash 及清理路径校验保持，没有自动发现或接管其他实例。

应用代码只改 package.json 与 trial-control.ts，另补独立测试文件 `tests/zhiban/local/trial-control.test.ts`；README／TRIAL／指南和交接清单已同步。未改 runner、安装／provider／receipt 接线、SQL、helper、ACL、expected profile 或冻结生产语义。

## 本地参数与目标核对

```sh
pnpm exec vitest run tests/zhiban/local/trial-control.test.ts
pnpm trial:zhiban:info
pnpm trial:zhiban:content:info
```

**24/24 PASS**，测试全部使用模拟文件系统与进程信号，不连接 PG：

- 12 个公共脚本值与目标关系一致：默认四项＝content 四项，legacy 四项指向旧模式。
- content／显式 legacy／无 flag 历史 info 选择相应 metadata 与端点；只输出账号最小字段，不输出测试密码。
- 10 类无效调用在任何文件访问或信号前拒绝，包含两种顺序的 `--content --legacy`、重复 flag、未知参数、缺少动作、错误动作与额外参数。
- legacy 进程已停止时，提示显式 legacy 启动，不推荐新的默认启动。
- 错 origin／PG 端口／数据库，以及 PID 启动时间、argv、bundle 内容、文件权限不符，均拒绝 stop 且不发信号。
- content 与 legacy 的有效 fixture stop，仅调用模拟的记录 PID／SIGTERM，再模拟退出确认及正确 close receipt 名称；没有运行真实 stop。

真实默认 info 与 content info JSON 完全一致，仍返回原实例 RUNNING_LOCAL_DISPOSABLE；stop 字段给出可兼容的 `pnpm trial:zhiban:content:stop`，与默认 stop 是同一脚本和固定目标。独立 TypeScript 检查、定向 ESLint、Prettier、git diff 空白检查通过。测试初次独立类型检查暴露参数表的空数组泛型推断，补显式泛型后最终通过，没有修改控制器业务逻辑。

## 保留的实例与证据范围

当前 PID／启动时间／owned 根和原 metadata 不变，仍为 `/tmp/zhiban-trial-content-CkNgQo`。本轮未读写课堂数据库，不启停、不重建、不迁移或重签 receipt；此前提交 v2／96 分课堂状态仅沿用[第二轮手工记录](zhiban-v2-classroom-revision-local.md)，本轮没有重放 UI。

info 如实显示 `sourceMatches=false`、`sourceDriftCount=5`：原 content.html、learning.js、workspace.js 三项，加 package.json、trial-control.ts 两项。不是当前源码全新构建／零漂移签收。旧 12/12、原交接清单及历史 CI 不扩大范围；本轮证据单列[接线记录](evidence/zhiban-trial-entry-wiring-local.json)，绑定当前源码／文档 hash。16 份既有 migration 文件 hash 与启动清单一致。

**未执行默认启动或验证 runner，未执行真实默认／content／legacy stop，未验证新的完整启动／清理生命周期。** legacy 真实旧实例不存在，本轮只核对模拟目标，不声称恢复旧数据。原生刷新／关闭补验继续按用户要求延期、未签收；Runtime／AI、真实 55432/55433 与 Native／维护输入隔离保持。

现在先用 `pnpm trial:zhiban:info` 接续现有 3461，已有运行实例时不要再次启动。只有在需要全新合成环境、明确接受停止会删除当前双库／账号／课堂记录时，再安排新建／清理；无需为命令切换重复已完成课堂或 GitHub CI。常规产品工作建议 GPT-6 Sol / medium。
