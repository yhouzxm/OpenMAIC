# 课堂草稿编辑与开放时间调整 LOCAL 交付

2026-10-17。分支 `refactor/zhiban-v2`，基线 HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。保留既有未提交候选，未提交／推送／CI。

已实现教师 DRAFT 标题、说明及开放／关闭时间编辑；PUBLISHED 只调整时间，包括尚未结束的过期课堂。ENDED 不可重开。按北京时间输入；不改变原 Attempt、活动截止、重交次数、提交或成绩。[精确设计](zhiban-v2-classroom-edit-design.md)。

## 本地验证

4/4 Classroom 单测、定向类型闭包、JS 语法与 diff 检查通过。真实 PG16 160015／HTTPS 定向旅程 11 组通过，包括身份和任教拒绝、草稿隔离、严格字段／窗口、幂等、旧版本冲突、编辑与发布竞争、关闭与进入屏障、窗口恢复沿用原 Attempt、终态拒绝、审计不复制说明，以及缺失列权限／多余 DELETE 的 loader 拒绝。未重跑整仓套件或 CI。

实际页面自动验证草稿保存后重载、取消与冲突保留输入、页面内取消离开、时间推迟隐藏学生入口及清空恢复。内置浏览器另完成“新建草稿 → 编辑标题和说明 → 发布 → 保存 2099 年北京时间窗口 → 清空窗口”；最终“内置浏览器：已编辑课堂”为版本 5、时间不限。截图记录保存窗口后的版本 4，不冒充最终窗口状态。

[完整启动来源与 11 组结果](evidence/zhiban-classroom-edit-demo-local.json)、[收尾证据](evidence/zhiban-classroom-edit-local.json)、[内置浏览器截图](evidence/zhiban-classroom-edit-browser.png)。收尾 info 为 RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、sourceDriftCount=0。启动 receipt 不重签。

## 试用入口与边界

[3463 独立候选](https://127.0.0.1:3463/zhiban)，owned PG16 56519，业务库 `zhiban_classroom_edit_disposable`／独立 Native 库。账号与密码只在私有 `/tmp/zhiban-classroom-edit-dXQB1k/accounts.json`，不入文档。教师进入课程工作区 → 课堂与互动。

```sh
pnpm trial:zhiban:classroom-edit:info
pnpm trial:zhiban:classroom-edit:stop
# 停止后 owned cluster 和合成数据会删除；重启不恢复历史数据
pnpm trial:zhiban:classroom-edit
```

仅在新 disposable 中安装追加的 `0002_classroom_edit.sql`，只授予四列 UPDATE；既有 0001 hash 不变，真实环境 migration 未应用。精确 ledger／ACL 只读启动校验覆盖两条 migration。Content／Native 固定 profile 单独核验，不将新增 Classroom ACL 冒充原 profile 权限。

本轮初查原 3461／3462 均 STOPPED，旧临时目录均不存在；本轮没有停止、删除或恢复这两套环境。先前文档中的运行／成绩保留表述仅为当时历史证据。当前 3463 为新合成数据，默认 package 入口仍指 3461，未自动替换。

真实 PG55432／55433、Runtime／AI／维护仍隔离；原生刷新／关闭确认仍为延期未签收项，本轮页面内离开保护不代替该验收。

下一步：在 3463 接续一次教师改期 → 学生进入／作答 → 教师评分的课堂试用，仅处理实际阻碍；建议 GPT-6 Sol / medium。
