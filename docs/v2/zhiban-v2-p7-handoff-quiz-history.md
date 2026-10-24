# P7 统一试用版本与交接包

2026-10-23 更新：一次纳入[判断题与测验复制](zhiban-v2-quiz-reuse-local.md)、[填空题](zhiban-v2-quiz-fill-local.md)、[匹配题](zhiban-v2-quiz-matching-local.md)、[排序题](zhiban-v2-quiz-ordering-local.md)，保留已交付的进度规则、总评／申诉及普通入口。上版见[进度／总评交接历史](zhiban-v2-p7-handoff-progress-history.md)；旧归档和功能证明保留原范围。

## 版本与启动

分支refactor/zhiban-v2，基线HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留dirty候选。OpenMAIC固定1.2.1及pin `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`。仅checkout HEAD不能重现交付；包身份由外置HANDOFF.json的versionId、sourceDigest、逐文件hash和归档SHA256确定，见[本轮最终记录](evidence/p7-handoff/quiz-bundle/final-closeout.json)。

```sh
pnpm trial:zhiban:info
node scripts/zhiban-handoff.cjs status
node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz
# 已有实例时不重复启动；无实例才执行：
pnpm trial:zhiban
```

入口为[3461工作台](https://127.0.0.1:3461/zhiban)。当前账号仅从info指向的owner-only accounts.json交付，不进入源码包或聊天。停止删除当前owned实例；普通启动创建新账号和合成数据，不能恢复现有总评、作答或申诉。本轮接续当前进程／root，不停止、不重建、不执行业务写入；只登录及GET核对受影响入口。当前产品源码匹配；状态工具报告的一处漂移为启动后修订的verify-quiz-ordering验证脚本，详见runtime-drift，不修改旧运行metadata来消除提示。

UbuntuPG16私有socket56517及业务／Content Native／Lesson Native三库，Node22、pnpm10.28.0、本机受信CA。换主机／路径需重建绝对路径绑定参考、依赖和bundle，并独立准备CA／模型／扫描配置；不操作55432／55433。源码包不是数据库备份、生产制品或干净主机安装证明。

## 纳入的完整产品范围

- 判断题快捷创建复用single；当前教学班内题目／已保存草稿／固定发布版本复制为独立新草稿，复制不带学生记录或作答规则，不自动编入目录。
- 填空题1–10空，逐空分值和答案变体，trim后区分大小写精确匹配；匹配题2–10左右项，右项可重复，逐左项计分。
- 排序题2–10项目，唯一标准顺序，未确认草稿可保存续作，明确确认后整题精确匹配计分；移动已确认项目需重新确认。全部复用原发布、固定Attempt、教师成绩发布／更正及封卷回看。
- 新增Learning迁移0003–0005只在fresh disposable安装，原迁移不改。旧卷算法不重标、旧Attempt不回算；预期profile参考独立构建，旧参考随包保留。生成器并未因此获得新题型输出能力。

- 教师教学班目录可显式发布正式提交／已发布成绩阈值的完成与先修规则；学生查看本人必修进度和阻拦原因。默认关闭；仅拦新Attempt及新课堂进入，已有作答与历史保留。阅读、HTML消息及聊天不计正式完成。
- 教师配置固定正式活动版本和100%权重，缺分待齐，显式发布不可变总评快照；来源变更只提示需重算。学生可对本人发布版本申诉；教师须说明或关联实际重发总评结案，改分仍走原单项更正。总评位于原课程成绩页；原CSV仍仅导出单项成绩。
- 新finalgrade migration仅已装入fresh owned disposable环境；旧已应用migrations及冻结Identity／单项评分合同不改。独立reference构建与只读loader、ACL/RLS、参与者授权及CAS随源码交付。
- 普通旧课程列表、当前活动及课堂精确入口已接通，既有两项检查问题已修正；旧Native ID不自动转换。原七组兼容入口、头像、受限跨页CSV和既有P1–P6本地产品保留，详见原计划及功能矩阵。

## 制品与证据

交付目录 `~/.local/share/zhiban-handoff/<versionId>/` 含source.tar.gz、HANDOFF.json、SHA256SUMS、VERIFY.json和P7-EVIDENCE旁包。源码归档包含dirty源码、文档、公开LOCAL证据及预期参考；账号、密钥、私有模型配置、dump、日志、Git历史、node_modules、临时构建、运行metadata和P7自引用证据目录不进入源码包。旁包保存本轮closeout、运行状态、来源覆盖和归档独立读回结果。

沿用现有pack的稳定双读、HEAD检查和敏感输入拒绝；verify独立只读归档，不提取，核对条目集、大小及逐文件hash。本轮比对归档与当前工作区、四产品包receipt的当前适用范围和运行源码覆盖。哈希一致不等于生产验收。新建源快照才执行 `node scripts/zhiban-handoff.cjs pack`，不覆盖旧版本。

四包功能旅程、授权／并发证明保留其原root/source适用范围。较早包的共享模型、宿主、算法和固定参考已由后续包演进，不能声称四份旧source hash均与当前一致；逐文件差额及当前排序包／匹配回归的覆盖见本轮evidence-applicability。本轮只读入口核对不重签旧receipt为全量回归；归档包含公开JSON证据，原日志被排除，必要结果日志可在P7旁包提供。旧入口版关于registrations断言和verifyOnboarding TS2353的失败属于历史；已由普通入口包修复，后续build类型及定向检查通过，不再列为当前待办。

## 保留边界与下一步

Scanner当前不可用时新附件／资源上传仍关闭；Office／OCR／音视频解析、完整Native Runtime／维护恢复输入、真实身份与运营审批／交付、外部目录同步、换机安装和恢复演练仍待。PBL／EMA／AI Peer及画像维度继续REVIEW。跨教学班学分、证书、教务二审、总评CSV及用户延期的原生刷新／关闭复验未包含。

本轮无commit、push、CI或生产部署。下一完整产品建议沿原P3复用原生Quiz生成输出，接教师采用为正式测验草稿→审核发布；不默认让模型写入正式成绩或声称原生支持新增三型。模型与依赖输入只阻塞对应能力。涉及课程授权／采用并发建议GPT-6.1 Sol / high，常规接线medium。
