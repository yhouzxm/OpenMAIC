> 后续 2026-10-23：[受限跨页CSV产品包](zhiban-v2-gradebook-export-local.md)已增加独立入口。下文保留原当前页包的日期、hash与证据范围，不能据旧浏览器限制推断当前下载能力。

# 成绩簿受限CSV导出 LOCAL交付

2026-10-17，分支refactor/zhiban-v2，基线HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。在未提交候选上接成绩簿导出，无提交／推送／CI。

## 产品范围与字段

教师课程→学生成绩→课程成绩簿→“导出当前页 CSV”。只导出当前已查询的学生页×活动页，不拼全班或其他分页；未提交的搜索框文字不改变已查询范围。学生每页10／20／50，活动每页5／10，最多500条明细、2MiB；空名册／空活动页仅输出表头。导出期间本页控件禁用，离开后取消请求，不产生延迟下载。

采用长表：一名学生×一个活动为一行。13字段为查询时间UTC、教学班ID、成员ID、学生姓名、活动ID、活动标题、活动发布版本、尝试次数、提交版本、状态、得分、满分、成绩版本。缺交、未开始与待发布成绩的得分／满分留空，不记0，不计算总评／排名／及格；不导出答案、反馈、公开更正正文或评分草稿。

CSV沿用当前名册、当前发布版本、最新Attempt／Submission及该Submission最新公开成绩的口径；下载时重新查询，在同一SQL语句快照中生成两轴数据。因此与较早屏幕快照可能不同，文件每行含服务器查询时间。不支持后台任务、跨页整班导出或历史成员批量导出。

## API与文件安全

`GET /api/zhiban/assessment/:tenant/offerings/:offering/gradebook.csv`，参数与成绩簿一致：q／limit／activityLimit／cursor／activityCursor；复用严格参数和双轴cursor绑定。每次读取重新验证身份、租户、当前任教及教学班权限；先前能看成绩簿不意味着撤权后仍能导出。无新增角色、表、ACL或migration。

所有字段用双引号包裹，内部引号加倍；UTF-8 BOM、CRLF。对开头（含前导空白／控制字符）的=、+、-、@以及开头制表／换行等输入加单引号，按文本导出；不以CSV引用替代公式防护。固定ASCII文件名仅含已验证的教学班UUID，不含用户姓名或查询值。响应text/csv、attachment、no-store、nosniff、same-origin资源策略；超限拒绝，不发送截断的成功文件。

新增后端csvPageExport能力标记。旧3464重载后无导出按钮，原94分仍可读；共享静态JS不向旧后端显示失效动作。导出服务只读，不修改任何提交或成绩。

## 验证与证据边界

4/4成绩簿／CSV合同单测、定向类型闭包、受影响ESLint、JS语法及diff检查通过。独立PG16 160015共10组准备及旅程通过，其中CSV覆盖当前页和第二活动页记录数、中文筛选、空表头、分数和缺交空值、公式输入、私有文本排除、非法参数、学生／管理员／跨租户／撤任教拒绝。普通Chromium实际下载并读回文件，证明未查询输入不扩大范围。

内置浏览器从教师课程页查询陈同学并点击导出，页面显示已生成；但download事件等待未获得可读取句柄，未声称内置宿主文件落盘已通过，也未反复重试。该客户端兼容项保留，不用页面提示冒充文件证明。另通过同一受限HTTPS API、真实合成教师登录和显式开发CA，获取[样例文件](evidence/zhiban-gradebook-current-page-local.csv)：5条明细、13字段，作为API产物而非冒充内置浏览器下载文件。

[启动来源／10组结果](evidence/zhiban-gradebook-csv-demo-local.json)、[收尾证据与样例hash](evidence/zhiban-gradebook-csv-local.json)、[普通浏览器下载](evidence/zhiban-gradebook-csv-download-local.png)、[内置浏览器页面状态](evidence/zhiban-gradebook-csv-browser-local.png)。最终info为RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、漂移0；既有migration hash全部未变，receipt未重签。

## 运行交接

[3465独立CSV候选](https://127.0.0.1:3465/zhiban)，固定PG16 56521／zhiban_gradebook_csv_disposable，私有root `/tmp/zhiban-gradebook-csv-3SyWeH`。账号路径由info提供，密码不入仓库／聊天。新合成数据，不冒充原课堂；3463／3464未重启清理，原93／88与94分分别保留。3465不启用Content／完整Runtime，不替代统一内容入口。

```sh
pnpm trial:zhiban:gradebook-csv:info
pnpm trial:zhiban:gradebook-csv:stop
pnpm trial:zhiban:gradebook-csv
```

停止会删除本实例合成数据；默认入口未替换。旧环境来源随共享候选变更而漂移，旧receipt保留历史适用范围，不声称它们加载了新CSV后端。真实55432／55433、Native维护、UNKNOWN／RESERVED、Runtime／AI及原生刷新关闭deferred gates不变。未执行GitHub CI或整仓回归。

下一项产品功能：作业附件提交首版，先在同片明确允许格式、大小、存储和授权访问，再接上传／提交／教师查看；内置浏览器下载句柄兼容项单列，不把它变成普通产品工作的串行前置。建议GPT-6 Sol / medium。
