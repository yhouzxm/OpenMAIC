# CL-01／CL-02 本地修复

2026-10-16，`refactor/zhiban-v2` / 基线 `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。两项课堂试讲问题已修复并定向验证，未提交／推送／派发 CI。原[课堂试讲报告](zhiban-v2-classroom-trial-local.md)及其证据保留发现时状态，不回写原 hash。

CL-01：教师尝试筛选提示完整成员 ID 格式、允许清空，并说明姓名查询可使用待评分队列。格式不符在发请求前就地拦截；服务端读取失败仍保留可编辑的筛选表单和当前条件，移除旧结果，给出查询相关提示，可改条件或重新读取。没有扩展姓名搜索或授权范围。

CL-02：不可重交的尝试点击“最终提交”后，先显示“本次尝试提交后不可修改或重交”的确认／取消区；确认期间锁定正文，确认发送当时显示的正文快照，取消恢复编辑。确认前不取 CSRF、不发业务写命令；确认后沿用原 SUBMIT／幂等路径。可重交活动的首次提交及新版本提交保持原操作方式。

## 定向验证

独立 PG16 56516／受信 HTTPS 3460，运行：

```sh
pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --classroom-fixes
```

[本地 receipt](evidence/zhiban-classroom-fixes-local.json)为 **13/13 PASS**（5 项共享试用准备／短冒烟，8 项定向场景）：

- CL-01 无效成员输入不发送请求，表单保留；注入服务端 INVALID_INPUT 后可修正重查；403 后清除旧作答，恢复请求后可重读。
- CL-02 打开／取消确认不写入且保留正文；确认遭遇 409 后正文可继续编辑；提交成功但响应丢失时，以同一命令号重试仍只有一份提交；不可重交仍被服务器拒绝；允许重交仍产生正常 v1／v2。

JS 语法、定向 ESLint、TypeScript 检查通过。原 16 个已应用 migration hash 与前次名册修复 receipt 对比无变化。没有改变后端业务合同、冻结 Identity／Bridge 或真实 55432／55433、Native／维护隔离。

前两次验证未构成通过证据：第一次 fixture 把 START_ATTEMPT 的 `id` 误写为 `activityId`；第二次故障注入用的 Playwright 请求上下文未加载本地受信 CA。修正为原命令字段及既有受信 HTTPS helper 后最终通过，没有关闭证书验证。失败用自建 PG 已停止、目录清理；第一次 FAIL receipt 及清理补充分别保留，不冒充最终 PASS。最终成功实例已正常停止并删除。

## 原试用实例接续

原 3459／PG16 56515 进程和合成数据保留。本轮在原内置浏览器只做教师只读筛选复核：姓名输入就地提示、清空后正常恢复查询，没有新增业务数据。该进程每次读取静态文件；[补充证明](evidence/zhiban-classroom-fixes-checkpoint-local.json)确认受信 HTTPS 返回的 learning.js hash 与当前文件一致，并绑定原启动 metadata。

启动清单现在如实显示 5 项漂移：既有 management.js、verify-m6-catalog.mts、run-m6-catalog.ts，加上 learning.js 与已适配新确认步骤的 verify-uat-fixes.ts。新定向 verifier 不在旧启动清单内。不是当前源码全新构建；原证据不扩大适用范围。

下一步建议继续课堂试讲，优先记录新的真实阻碍；M5 统一内容展示仍为独立范围缺口。常规产品工作建议 GPT-6 Sol / medium。NO COMMIT / NO PUSH / NO CI DISPATCH。
