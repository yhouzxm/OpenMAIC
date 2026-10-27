# 原生 AI 课堂课程宿主（LOCAL）

沿原 P4／P6 复用 OpenMAIC 1.2.1 的 `ClassroomSurface → Stage → PlaybackEngine`、ChatArea、Pi Director、多角色圆桌、白板及原生 Quiz。没有新增平行的讲授或聊天引擎。

## 产品入口与数据

教师在课程「讲义与图片」通过原生备课工作台生成／编辑、采用并明确发布完整课件。固定发布播放器提供「进入原生 AI 课堂」；任教教师对该发布版本明确启用后，当前选课学生可进入。新发布版本默认关闭，不能沿用旧版启用设置。

课堂源始终取已发布、hash 校验的不可变快照，不接受客户端替换 stage、scenes、agent persona 或模型凭据。宿主仅给浏览器派生的本人／发布版本 stage alias，不创建可编辑的原生文档副本。独立 HTML 演示沿既有 opaque sandbox frame 隔离；PBL 场景在本宿主显示原生项目简报，协作仍走已有课程 PBL。

原生问答、讨论、白板及课件自测记录持久化在专用原生课件库，与成员、课程和 publication 绑定；其他成员不能读写该记录。撤回或换版后旧版课堂／练习入口关闭；此处的本人历史是有效发布版本内的恢复，不增加跨版本阅读授权。问答、播放、自测、白板不会自动生成智伴正式 Attempt、完成或成绩。正式活动及课堂派发继续使用既有教学规则和成绩流程。

## 授权与并发

- 启停须当前 Identity、实际任教关系和固定发布版本有效；CAS revision 防止并发覆盖，启停与不可变审计事件同事务提交。
- 短原生读写持有当前 Identity／Enrollment、资源、Bridge slot 和 policy SHARE 锁；停用、撤回或撤权在其后生效，后续写入拒绝。
- 长模型请求不长占业务事务；每个 SSE 事件和 native whiteboard commit 重查资格，宿主每两秒探测；失去资格或客户端断开中止 upstream。同一成员在同一发布版本最多一个模型流、宿主最多八个，并在调用 provider 前占位。
- 页面每五秒重核资格与启用状态；失效卸载课堂。源文档的所有写接口、原始配置写入、全局运行记录清理和其他成员会话均不开放。
- additive private policy schema 只安装在专用 LOCAL 课件数据库，校验 SQL hash、列、owner／ACL 和审计 trigger；未修改已应用业务 migrations。

## 验收及适用边界

当前验证结果见 `evidence/zhiban-native-ai-classroom-closeout.json`；隔离 PG16 旅程与真实模型旅程分别记录，构建缓存不能替代产品证据。

当前真实外部服务配置单列。缺 TTS／ASR 时不能声称语音讲授或语音提问已真实验收；保留原生服务接口并使用现有文本／已发布音频能力。自主 PBL、全班共享 AI 内部状态及旧冻结 Native CREATE／APPEND／COMPLETE 正式证据链不由本包启用。真实维护输入待补与 UNKNOWN／RESERVED 隔离维持，普通原生课堂不依赖该维护链。

默认持久化启动仍为 `pnpm trial:zhiban`。专项为 `pnpm exec tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --classroom-ai-focus`，仅新建 disposable PG16，不改已有账户和教学历史；真实模型验收单独执行。未提交／推送／触发 CI，本地证据不得标记 GitHub Actions 或远端验收。

实际真实模型旅程完成了教师与助教两个 native child（default-1／default-2）、白板工具写入、SSE done、刷新后的原生对话面板与白板回看。首次观察器曾将白板确认的 204 误当主流结束，已改为精确匹配主流 URL；迟到的 visibility ACK 按原生客户端合同允许 404。最终通过原始真实 SSE 的 stage／成员运行记录绑定与浏览器恢复核验收口，`modelEvidenceMode` 明确为真实捕获复验，不重复调用模型、不以合成响应替代。

可单独执行真实模型旅程（会调用已配置模型）：

```bash
node scripts/zhiban-local/verify-classroom-ai-real.cjs \
  --resource=01a16ea2-7546-73b7-b971-297127c754f2 \
  --publication=01a16ea2-77aa-71bc-86a6-f2c5578bebca
```

若刚完成真实调用，可加 `--reuse-captured=/绝对路径/真实捕获.json` 只复验原生记录与页面恢复；须本人持有的 0600 常规文件，校验固定发布上下文或派生 stage、原生 projection 序号与数据库本人白板记录。此模式的证据明确标记捕获复验，不能冒充新一轮模型调用。

本轮修正的是原生宿主的 Session CSRF 准备顺序／并发取令牌、自测首次 Runtime miss 错误码，以及取消后晚到 pull 的安全退出。没有改冻结 Identity 合同、正式成绩语义或已应用 migrations。

白板保留原生拖动平移、滚轮缩放及双击复位。演示中模型把新增文字排在初始画布下方，已用原生平移验证两条实际板书可见；未修改模型写入坐标。宿主每次最多接收60条／64KiB消息、6个候选角色，Director最多3次角色执行及每角色6个动作；这些上限属于本地宿主请求边界。
