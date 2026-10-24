# 教师课程成绩簿首版 LOCAL 交付

最新：[当前页受限CSV导出](zhiban-v2-gradebook-csv-local.md)已交付独立3465候选，首版限当前分页；整班跨页导出仍未实现。下一产品包为作业附件提交。

2026-10-17。分支 `refactor/zhiban-v2`，基线HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`；在既有未提交候选上追加，无提交／推送／CI。

## 可用功能与口径

教师课程“学生成绩”默认展示成绩簿，可切换原“待评分列表”；课堂任务直达评分仍保留原活动筛选／原课堂返回，不改变成成绩簿入口。学生成绩页不变。

表格按学生行、活动列独立服务端keyset分页：学生每页10／20／50，活动每页5／10；姓名或完整成员ID搜索。一次数据请求最多50×10格，数据投影在单SQL语句快照中完成，不按单元格发HTTP。双轴cursor分别绑定租户、当前操作者、教学班、查询、两轴大小及轴类型，不作为授权；每次请求仍核对当前教师任教、身份与课程资格。

当前名册采用ACTIVE、生效且valid_until为空的Enrollment；活动仅当前PUBLISHED及精确发布版本。每格依次选该版本最新Attempt、最新Submission和该Submission最新不可变公开成绩，显示未开始／已开始未提交／已提交待发布成绩／得分及满分。不把评分草稿放入表格，不读取答题正文或反馈，不将缺交记0分。新尝试、重交与再发布不沿用旧成绩，更正只展示该提交最新成绩版本。翻页期间各请求反映当前数据，不承诺跨页固定历史快照。

有提交的单元格打开原Assessment精确提交编辑器；保存／发布／更正继续走既有命令。返回成绩簿保留本标签当前搜索、行页、列页和大小，成绩变动后刷新当前表格；不把旧提交成绩冒充新提交。刷新整个浏览器会重新初始化筛选，首版不承诺跨刷新／跨标签恢复临时筛选。

空名册、无活动和失败重试均有状态；小屏表格可横向滚动。首版没有总评、权重、排名、及格、批量改分、CSV导出或历史成员成绩簿；历史提交仍用原学习记录／成绩历史查看。既有只读表权限够用，无新增migration／ACL，已应用SQL及冻结生产语义不变。

## API和实现位置

`GET /api/zhiban/assessment/:tenant/offerings/:offering/gradebook`

参数：`q`、`limit`、`activityLimit`、`cursor`、`activityCursor`。严格字段、大小和cursor校验；其他HTTP方法拒绝。DTO含活动列、学生行、每格的活动版本／尝试／提交／公开成绩标识及状态、两轴nextCursor、查询服务器时间。当前身份与教学班访问继续通过AcademicStore／Learning access，不使用URL赋权。

新增查询合同 `lib/zhiban/application/assessment/gradebook.ts`，AssessmentService和Postgres查询／HTTP接线，`app/zhiban/local/gradebook.js`表格及原grading编辑器适配。加载中禁用视图切换；连续成绩变动触发的刷新会保留后续刷新，避免并发刷新丢失最新成绩。

## 验证和真实试用

- 2/2游标合同单测通过，覆盖操作者／教学班／筛选／大小／轴绑定、畸形和未知输入。
- `tsconfig.classroom.json`定向类型依赖闭包、受影响核心文件ESLint、JS语法和diff检查通过；不声称整仓类型或整仓回归通过。
- 独立PG16 160015／HTTPS共8组准备及定向检查通过，其中成绩簿三组覆盖授权拒绝、无正文／草稿泄漏、更正、重交、新尝试、再发布不串分、学生／活动双轴翻页、中文搜索、退班排除及实际页面。分页专用名册数据验证后删除，最终保留原两名学生；四个额外发布活动保留用于列分页试用。
- 自动浏览器从成绩簿精确提交保存并发布93/100，返回后学生筛选保留；桌面与390px小屏可用。内置浏览器在最终静态文件上再从课程进入、搜索陈同学、查看该提交，发布更正94/100 v2后返回，表格显示94分及v2且搜索保留；原93分v1保留在历史。

[启动来源／8组结果](evidence/zhiban-gradebook-demo-local.json)、[收尾及当前前端hash](evidence/zhiban-gradebook-local.json)、[内置浏览器](evidence/zhiban-gradebook-browser-local.png)、[小屏](evidence/zhiban-gradebook-mobile-local.png)。运行中补了gradebook.js刷新合并，启动来源显示1项前端漂移，未重签receipt；该最终文件已在内置浏览器验证，实际HTTPS响应hash与当前源码一致。所有启动记录中的migration hash仍匹配。

## 入口、数据与限制

[3464成绩簿候选](https://127.0.0.1:3464/zhiban)：教师 → 课程工作区 → 学生成绩。也可通过info中grading地址进入原队列再点“课程成绩簿”。固定PG16端口56520，库 `zhiban_gradebook_disposable`，root `/tmp/zhiban-gradebook-DW6w39`。密码仅私有accounts.json，不写聊天或仓库。

```sh
pnpm trial:zhiban:gradebook:info
pnpm trial:zhiban:gradebook:stop
pnpm trial:zhiban:gradebook
```

这是独立新合成环境，停机会删除其数据；不是3463数据迁移或恢复。3464未启用文本／PNG内容或完整Runtime，不能作为统一内容环境签收。为验证后端没有重启原3463，原课堂／93及88分未重建清理。3463 info为RUNNING、14项源码漂移（包含新后端与验证接线）；旧host没有新gradebook API／静态路由，使用原评分队列回退，不能在3463声称新后端已启用。默认3461入口未替换，两套receipt保持各自范围。

真实PG55432／55433、Native／维护、UNKNOWN／RESERVED及Runtime／AI隔离、原生刷新／关闭deferred gates不变；无GitHub重复验证或上线签收。

下一步：成绩簿受限CSV导出，在同一筛选与当前成绩口径下定义导出上限、字段和文件安全，再同片实现；建议GPT-6 Sol / medium。
