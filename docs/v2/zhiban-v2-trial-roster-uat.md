# 管理员试用：批量导入、名单调整与转班

2026-10-16（Asia/Shanghai）。分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。状态 **COMPLETED_WITH_LOCAL_FIX**。实际内置浏览器操作本地 disposable 3459 / PG16 56515，全部数据为既有合成试用数据；没有连接真实 55432/55433、Native／维护输入。NO COMMIT/PUSH/CI。

## 实际走通的流程

| 操作 | 实际结果 |
| --- | --- |
| 上传现有私有 roster-example.csv，预览并确认 | 识别王悦，可新增 1 行；确认后已导入，原班 2/20 → 3/20 |
| 从已有学生目录选择王悦、批量学生甲、批量学生乙，生成 CSV | 预览可新增 2、已在班 1；确认后王悦跳过、甲乙导入，人数 5/20 |
| 搜索王悦并移出 | 原班 4/20，“已退班”过滤显示王悦及恢复入口 |
| 将已退班王悦重新放入 CSV 预览 | 需处理 1，提示“曾退班，请在工作台单独恢复”，确认禁用；没有借批量导入恢复 |
| 输入重复甲 ID 和无效 ID | 逐行显示“文件内重复”“成员 ID 格式无效”，确认禁用 |
| 已退班名单显式“恢复入班” | 原班人数回到 5/20，再切回在班可查王悦 |
| 通过课程／学期选择器新建 TRY_TRANSFER / 试用转班目标 | 同课程、同学期、开放，容量 1，未指定任教和行政班 |
| 王悦转入空目标班 | 源班 4/20；目标班 1/1，目标名单显示王悦 |
| 批量学生乙转入已满目标班 | 显示“目标教学班容量已满。请刷新名单”；刷新确认乙仍在源班，目标仍只有王悦 |
| 操作历史过滤“转班” | 仅一条成功转班，涉及成员王悦；未将失败请求显示为成功历史 |

上传、预览、生成、确认、逐行结果、跳过、错误输入、显式恢复和转班均由真实界面完成，没有用直接 SQL替代这些手工业务操作。正常的批量导入仍是逐行原子，不将本次成功样例解释为整批原子性或完整故障切点验收。

## UAT-04：失败后误启用分页边界

优先级 **P3，LOCAL_FIXED**。满员转班被服务器正确拒绝，数据未受损；但失败后，当前仅一页的源名单与目标选择器的四个分页按钮均被误启用。点击这些按钮仍受原事件处理边界约束，不声称出现越界数据读取；问题是界面显示了无效操作。[修复前](evidence/zhiban-trial-roster-transfer-full-before-local.png)。

原因是 `management.js` 的通用 `disable(false)` 把全部控件直接设为可用，丢掉各控件原有禁用状态。修复在请求开始时保存原状态，结束后只恢复这些状态；未知结果重试保留首次快照，不用已经全禁用的界面覆盖它。新列表保留各自绘制的边界，视图销毁清理快照。未改变 Enrollment／TRANSFER、权限、容量、CAS、审计或原键重试合同。

内置浏览器重新加载后，再次向已满目标班转入乙：提示仍准确，源名单与目标列表的上一页／下一页保持禁用，搜索、取消等有效操作恢复可用。[修复后](evidence/zhiban-trial-roster-transfer-full-after-local.png)。

## 定向验证与证据范围

`pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --roster-trial`：独立 PG16 56516、受信 HTTPS 3460，**9/9 PASS**，包含五项统一试用短冒烟和四组 UAT-04 定向检查：

- 目标满员的真实 409 后，四个分页边界保持禁用、有效控件恢复；源成员和转班审计不变。
- 真实拒绝响应故意丢失后，页面暂停其他操作；按原命令号重试，明确拒绝后恢复首次控件状态，没有重复转班或审计。
- 对目标 Enrollment 的预读注入 403，恢复控件原状态且不发送转班命令；这只证明读取失败处理，不宣称真实撤权协议已经完整验收。
- 用原受保护命令空出目标容量后，转班成功且只记一次；空源搜索页仍正确禁用分页。

[定向证据](evidence/zhiban-trial-roster-fixes-local.json)绑定当前源码／bundle；自建 PG已停、临时根目录已删。定向 TypeScript／ESLint／Prettier 通过。没有重复运行旧全套模块、单元测试、全仓 build 或远端 CI；既有 16 个 migration hash 不变，没有 helper／ACL／receipt profile 或冻结生产语义变更。旧证据保留原 hash 和原适用范围。

## 当前试用实例保留

**本轮没有重启统一实例或重置账号／数据。** 当前原班 TRY_01 为 4/20（陈同学、李明、批量学生甲、批量学生乙）；新目标班 TRY_TRANSFER 为 1/1（王悦）。原教学活动、提交与成绩数据保留。目标班未赋任教，不声称教师已获得该班访问权限。

现有服务每次 GET 都从工作区读取静态页面，响应 `Cache-Control: no-store`。本次刷新加载新 management.js，原运行服务 bundle 和数据库保持。通过已信任 CA 的 HTTPS 读取脚本，核对服务返回内容 hash 等于当前文件：[静态补丁证明](evidence/zhiban-trial-roster-served-asset-local.json)。未绕过证书校验。

因此启动 metadata **保留原样，不重签或伪装源码零漂移**。`trial:zhiban:info` 会显示启动源码发生漂移：management.js 和两份验证／打包脚本三项；新增定向脚本另列本轮候选。原服务 bundle、lib 后端和其他启动清单内源码均未变。新参数与验证脚本没有进入旧进程；本轮只签收明确的静态补丁组合，不声称运行了新构建后端。以后需要全新构建仍使用原受限 stop/start，届时合成数据和账号会重置。[本轮机器记录](evidence/zhiban-trial-roster-uat-local.json)分别绑定原实例、静态补丁、独立定向构建和截图，供核对。

[导入结果](evidence/zhiban-trial-roster-import-local.png)、[退班记录](evidence/zhiban-trial-roster-withdraw-local.png)、[禁止批量恢复](evidence/zhiban-trial-roster-restore-guard-local.png)、[目标名单](evidence/zhiban-trial-roster-transfer-target-local.png)、[成功转班历史](evidence/zhiban-trial-roster-history-local.png)。当前入口 [智伴工作台](https://127.0.0.1:3459/zhiban)，账号仍为原本机私有 0600 文件，无密码写入证据。

下一步建议：核对名单变更后的教师／学生课程访问与历史作答展示。建议模型 GPT-6 Sol / medium。本轮没有验收大名单性能、跨进程批次恢复、真实撤权及全部安全故障场景；M5 及真实维护输入隔离保持。
