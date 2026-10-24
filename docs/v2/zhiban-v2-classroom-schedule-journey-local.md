# 3463 改期、作答、评分 LOCAL 试用

2026-10-17，内置浏览器真实操作，合成教师／学生账号。同一3463实例，分支 `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。开始／结束 info 均 RUNNING_LOCAL_DISPOSABLE、sourceMatches=true、来源漂移0。

## 实际结果

1. 教师将“内置浏览器：已编辑课堂”改为北京时间2026-10-17 00:00至2026-10-18 23:59，派发“试用：安全巡检报告”发布版本1，课堂最终revision7。
2. 学生从课程“学习活动”看见改期课堂并进入；页面沿用已有第1次尝试，显示原草稿，未被迫新建下一次尝试。填写巡检步骤、保存草稿后正式提交v1，页面显示已提交与提交正文。
3. 教师课堂面板准确显示进入1人、提交1份、已发布成绩0份；进入评分，保存93/100和反馈，再发布成绩v1。该项从默认待处理列表移出。
4. 教师课堂面板更新为进入1人、提交1份、已发布成绩1份。学生“学习成绩”显示93/100及公开反馈，原88分保留，已发布2项，平均90.5%；另一项待评分作业仍未发布。

本次可签收改期后的正常教学链路，无阻断问题。不扩张为所有改期边界、整仓回归或原生刷新／关闭验收。

## 具体体验待办

**CEJ-01（轻微，现已 FIXED_LOCAL）：** 课堂“查看提交与人工评分”进入整个教学班的待评分列表，页面显示“活动：全部”，仍需手动选择本次活动。两项待处理时可以完成评分，大名单会增加查找成本。已接活动筛选及原课堂返回，见[修复记录](zhiban-v2-classroom-grading-entry-local.md)；原任教与教学班权限不变。

学生课程入口实际为“学习活动”，教师为“课堂与互动”；本轮按各角色实际导航完成，未将名称不同视为功能失败。

## 证据与保留状态

[结构化记录](evidence/zhiban-classroom-schedule-journey-local.json)、[教师改期派发](evidence/zhiban-classroom-schedule-journey-teacher.png)、[学生提交](evidence/zhiban-classroom-schedule-journey-submission.png)、[教师发布成绩](evidence/zhiban-classroom-schedule-journey-grade.png)、[学生成绩反馈](evidence/zhiban-classroom-schedule-journey-student.png)。截图均为实际操作时状态；最终浏览器留在学生成绩页。

3463继续运行；改期窗口、派发、提交与93分为本轮新增合成数据，停止owned cluster后删除。未修改业务代码／SQL、未构建或重启、未跑自动套件、未提交／推送／CI。原55432／55433、Runtime／AI／真实维护和deferred gates保持原边界；不重签启动receipt。

下一步：修复CEJ-01课堂评分入口的活动筛选与返回上下文，仅做本地定向页面核对。建议GPT-6 Sol / medium。
