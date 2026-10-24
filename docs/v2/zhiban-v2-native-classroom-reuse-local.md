# 原生课堂能力复用与演示整包

2026-10-24，沿原P4；当前上游为仓库已固定的OpenMAIC 1.2.1。以下只认本地实际源码，不将“原生”统称为旧维护链。

## 能力与真正的依赖

| 能力 | 复用来源及当前智伴接线 | 旧Native维护链 |
| --- | --- | --- |
| PPT文本／PNG、页码／目录／键盘／全屏 | `lib/standalone-player/App.tsx`、原生SlideScene与renderer；固定Content发布版，通过现有身份及课程资格读取 | 不需要 |
| 自包含HTML互动、SVG／canvas探索 | 原生InteractiveScene／iframe宿主；智伴现有HTML策略、opaque sandbox和局部CSP | 不需要；外链与网络仍不开放 |
| Quiz展示、题型与判分算法 | 原生QuizView／DSL，智伴已交付活动版本、Attempt、提交、正式评分及更正 | 不需要；离线Quiz自测不等于正式成绩 |
| PBL项目／任务模板和展示 | 原生PBL v2，现有智伴小组协作／共同提交与教师评价 | 不需要；自主Agent执行／外部工作空间另需实际服务和治理 |
| 备课／Tutor／私人AI伙伴／EMA | 原生生成／Agent管线，已有课程授权、限额、本人历史与教师审阅 | 不需要旧维护链；实际调用仍需受限模型配置 |
| 课堂派发、讲义同步、暂停／结束、正式提交与结果 | 现有Classroom／Flow／Learning／Assessment API和PG16角色 | 不需要旧维护链 |
| 冻结Native chat Runtime的CREATE／APPEND／COMPLETE组合 | `lib/zhiban/infrastructure/openmaic/runtime`当前只是内部诊断适配；root继续DENIED | 对旧真实目标启用确实需要既有维护锁／可信批准、同代交付和清旗，不使用fixture替代 |
| 自动实验／可信测量 | 当前DSL的scene类型只有slide／quiz／interactive／pbl，未提供独立VirtualLab执行合同；HTML滑块读数属于客户端演示 | 先缺实际执行器与测量来源合同。补齐维护输入也不会自动补出实验引擎 |

因此普通课堂产品接线不再等待维护control／pgpass／公钥pin／签名。旧真实目标55433、UNKNOWN／RESERVED和未签维护包继续隔离；既有LOCAL发布receipt／ACL验证依然执行。

## 本轮实施：原生课堂演示

教师从当前课堂讲义打开完整原生播放器，用原生按钮、目录或键盘翻页后，显式点击“共享当前原生播放器页”。命令复用原 `PRESENT_LECTURE_PAGE` 的教师授权、课堂revision、presentationRevision CAS和审计；本地预览翻页不会自动写课堂状态。

学生从“进入／继续课堂任务”进入同一固定发布版，默认跟随教师；可切换自主浏览再恢复跟随。刷新重新核对课堂与发布并恢复当前共享页；网络中断保留最后已读画面并明确提示，联网后重新核对。错误课堂、尚未进入、暂停／结束、任务切换或当前授权失效时停止播放；poll只在可见且联网时运行，不能声称离线内容被瞬时撤回。

返回按钮固定回到本教学班／本次课堂，避免以浏览历史推断目标。Flow讲义环节和普通课堂入口共用原生播放器；互动＋作答仍使用已有联合派发／Attempt面板。

新增的是宿主上下文适配；没有修改原生播放器引擎、已应用migration、冻结Identity或Native Runtime。课堂读取投影为所有讲义返回现有publicationId，不新增数据表或授权。HTML宿主CSP、sandbox和禁止可信完成消息的边界保持。

## 证据与待办

显式专项命令：`pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --native-classroom-focus`，与默认3461分开。

本轮独立3468／私有socket PG16只验证受影响的原生课堂流程和拒绝边界；没有模型调用、真实目标启动、全课堂回归或CI。结果、最终源码及默认入口更新以 `evidence/native-classroom/closeout.json` 为准；中间失败日志保留原范围。上一P7源码包保持原版本，不自动重打。

剩余完整功能：可信实验执行器及测量来源合同，或真实Native Runtime启用组合。前者不是上游已存在的VirtualLab可直接移植；后者必须等实际受信输入。两者不再阻塞已交付普通课堂。复杂授权／并发建议GPT-6.1 Sol / high；常规原生复用建议medium。

默认3461已正常保存／恢复并绑定当前代码，原账号及210张非Identity表的记录数保持。原PG旅程后仅调整播放器CSS视口布局；桌面／手机布局样本只证明控件位于视口内，不当作真实课堂授权证明。原PG receipt不改写，具体差额见closeout。课堂事务文件的三处既有`any` lint告警继续明确保留，其余本轮相关检查通过。

首次执行误用了旧native-player输出名；已从前一P7归档恢复原receipt的精确字节，故障副本保存在本轮目录。历史journey／source-boundary均与归档一致，本轮独立receipt不替换旧证据。
