# CEJ-01 课堂评分入口 LOCAL 修复

2026-10-17，`refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。本轮仅修改classrooms.js、grading.js、grading.html三个前端文件，保留其他候选，无提交／推送／CI。

课堂“查看提交与人工评分”附带严格UUID格式的活动／原课堂片段。评分页以该活动、ALL状态初始化，已发布成绩也可直接查看；刷新保留初始上下文。新增“返回本次课堂”，保留course／space／offering及原课堂anchor，沿用课堂面板现有定位。普通课程评分入口仍为TODO、活动不限。可显式切换状态／清除活动筛选，课堂返回链接仍保留。整页刷新按入口重新初始化，不承诺保留用户后续临时筛选。

片段仅提供导航提示；当前教师课程资格及队列原活动／教学班授权继续校验。畸形classroom-grading片段拒绝，不支持任意return URL。列表汇总该活动的教学班尝试，不冒充仅该课堂派发绑定提交；页面有相应说明。

## 本地核对

在原3463实际入口复验：只出现巡检报告已发布行；重载保留筛选；查看原93/100不写成绩；TODO无匹配、ALL恢复；返回URL含原课堂anchor并显示原1／1／1计数；清除筛选出现3项活动；普通入口仅保留待处理作业；畸形上下文拒绝；学生复制教师链接被课程资格校验拒绝。未发现阻断。

JS语法、Prettier及diff检查通过；三个实际静态响应与源码hash一致（HTML考虑既有课堂脚本注入），使用显式开发CA验证TLS，未关闭证书校验。原启动清单中所有migration hash不变。[结构化证据](evidence/zhiban-classroom-grading-entry-local.json)、[最终页面](evidence/zhiban-classroom-grading-entry-local.png)。

3463无需重启，原93／88分和课堂数据保留；info为RUNNING_LOCAL_DISPOSABLE、sourceMatches=false、sourceDriftCount=3，对应本次三个前端文件。启动receipt不改写，不将旧零漂移记录冒充当前状态。无SQL／权限／后端语义变更、构建或自动化全套回归；真实环境及原生刷新／关闭deferred gates保持。

CEJ-01：FIXED_LOCAL。下一步继续课堂结束与历史成绩回看的产品试用；建议GPT-6 Sol / medium。
