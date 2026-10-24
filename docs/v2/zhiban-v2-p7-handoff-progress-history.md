# P7 统一试用版本与交接包

2026-10-23 更新：合并[学习进度、先修与完成规则](zhiban-v2-learning-rules-local.md)、[教学班总评、权重与成绩申诉](zhiban-v2-final-grades-local.md)，同时纳入此前[普通入口批量收尾](zhiban-v2-ordinary-entry-batch-local.md)及全部已交付入口。旧[入口交接版](zhiban-v2-p7-handoff-entry-history.md)、CSV／头像版及初次P7保留原归档／证据，不覆盖。

## 版本与启动

分支refactor/zhiban-v2，基线HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留dirty候选。OpenMAIC固定1.2.1及pin `e19d0d4f45d81b8f7ab599b33ab03b0b8b68d5c0`。仅checkout HEAD不能重现交付；包身份由外置HANDOFF.json的versionId、sourceDigest、逐文件hash和归档SHA256确定，见[本轮最终记录](evidence/p7-handoff/progress-finalgrade/final-closeout.json)。

```sh
pnpm trial:zhiban:info
node scripts/zhiban-handoff.cjs status
node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz
# 已有实例时不重复启动；无实例才执行：
pnpm trial:zhiban
```

入口为[3461工作台](https://127.0.0.1:3461/zhiban)。当前账号仅从info指向的owner-only accounts.json交付，不进入源码包或聊天。停止删除当前owned实例；普通启动创建新账号和合成数据，不能恢复现有总评、作答或申诉。本轮接续当前进程／root，不停止、不重建、不执行业务写入；只登录及GET核对受影响入口。

UbuntuPG16私有socket56517及业务／Content Native／Lesson Native三库，Node22、pnpm10.28.0、本机受信CA。换主机／路径需重建绝对路径绑定参考、依赖和bundle，并独立准备CA／模型／扫描配置；不操作55432／55433。源码包不是数据库备份、生产制品或干净主机安装证明。

## 纳入的完整产品范围

- 教师教学班目录可显式发布正式提交／已发布成绩阈值的完成与先修规则；学生查看本人必修进度和阻拦原因。默认关闭；仅拦新Attempt及新课堂进入，已有作答与历史保留。阅读、HTML消息及聊天不计正式完成。
- 教师配置固定正式活动版本和100%权重，缺分待齐，显式发布不可变总评快照；来源变更只提示需重算。学生可对本人发布版本申诉；教师须说明或关联实际重发总评结案，改分仍走原单项更正。总评位于原课程成绩页；原CSV仍仅导出单项成绩。
- 新finalgrade migration仅已装入fresh owned disposable环境；旧已应用migrations及冻结Identity／单项评分合同不改。独立reference构建与只读loader、ACL/RLS、参与者授权及CAS随源码交付。
- 普通旧课程列表、当前活动及课堂精确入口已接通，既有两项检查问题已修正；旧Native ID不自动转换。原七组兼容入口、头像、受限跨页CSV和既有P1–P6本地产品保留，详见原计划及功能矩阵。

## 制品与证据

交付目录 `~/.local/share/zhiban-handoff/<versionId>/` 含source.tar.gz、HANDOFF.json、SHA256SUMS、VERIFY.json和P7-EVIDENCE旁包。源码归档包含dirty源码、文档、公开LOCAL证据及预期参考；账号、密钥、私有模型配置、dump、日志、Git历史、node_modules、临时构建、运行metadata和P7自引用证据目录不进入源码包。旁包保存本轮closeout、运行状态、来源覆盖和归档独立读回结果。

沿用现有pack的稳定双读、HEAD检查和敏感输入拒绝；verify独立只读归档，不提取，核对条目集、大小及逐文件hash。本轮比对归档与当前工作区、两产品包receipt源hash和运行源码覆盖。哈希一致不等于生产验收。新建源快照才执行 `node scripts/zhiban-handoff.cjs pack`，不覆盖旧版本。

两包功能旅程、授权／并发证明保留其原root/source适用范围。本轮只读入口核对不重签旧receipt为全量回归；归档包含公开JSON证据，原日志被排除，必要结果日志可在P7旁包提供。旧入口版关于registrations断言和verifyOnboarding TS2353的失败属于历史；已由普通入口包修复，后续build类型及定向检查通过，不再列为当前待办。

## 保留边界与下一步

Scanner当前不可用时新附件／资源上传仍关闭；Office／OCR／音视频解析、完整Native Runtime／维护恢复输入、真实身份与运营审批／交付、外部目录同步、换机安装和恢复演练仍待。PBL／EMA／AI Peer及画像维度继续REVIEW。跨教学班学分、证书、教务二审、总评CSV及用户延期的原生刷新／关闭复验未包含。

本轮无commit、push、CI或生产部署。下一完整产品建议回到原P3的更多测验题型与复用差额，先核对新版已具备能力后集中定范围；依赖外部输入的P4／解析门禁保持独立。建议GPT-6.1 Sol / medium；若扩展正式评价授权及并发则high。
