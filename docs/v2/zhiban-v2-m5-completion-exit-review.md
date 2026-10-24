# M5 完成组消费与进程退出定向复评

2026-10-13。branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`。结论：**REVIEW_CHANGES_REQUIRED / REAL_DELIVERY_NOT_READY**。本轮仅复评、故障复现和准备输入清单；未修复运行代码，未修改候选inventory、SQL/helper/ACL、已应用migrations或冻结业务语义。无commit/push/CI dispatch，无真实凭据、55432/55433、HBA、信任库或启动门操作。

## R1 — P1：supervisor 的 PG 关闭没有总时限

[ordinary-launcher.cjs:169](candidates/m5-handoff/ordinary-launcher.cjs#L169) 在 child 退出后直接等待 `Promise.allSettled(clients.map(x => x.end()))`，之后才关闭共享lock fd并完成done。child的1.5秒SIGKILL和自身2秒退出兜底都不能限制这段等待。

本地 pg 8.22.0 的 idle Client.end 等待底层 connection 的 end/close；query_timeout 不覆盖空闲连接关闭。使用一个仅在临时loopback端口运行的协议对端，完成最小连接后接收Terminate/FIN但保持对端写端打开。实际launcher stop调用、实际Node child和实际flock复现：**2619ms时child已退出，两个end均已调用，done仍未完成，独占维护锁仍取不到**；销毁故障对端后done完成并释放锁。这里认证/profile/TLS核验被显式stub，仅证明退出等待的位置，不签收真实PG、HTTPS或授权路径。

影响：正常stop、启动失败清理或撤权停机都可能留下常驻supervisor及共享锁，阻塞后续维护。保持锁没有越权放行，但不能据R5正向退出用例承诺supervisor关停有界。

建议修复：统一shutdown deadline；确认child实际退出后对PG连接实行有界graceful end，超时强制关闭本地socket，并查证本地close后完成fd/handler清理。不能仅Promise.race返回而留下未关闭连接；child仍存活时不能提前释放共享锁。若不能确认退出，应返回明确未完成状态并保留隔离。数据库backend是否已排空仍由维护端的物理观测/guard确认，不把本地socket关闭当远端排空证明。

验收：idle peer stall、active query、child拒绝SIGTERM、spawn失败、IPC失联、supervisor SIGTERM/SIGKILL、重复stop；所有失败状态不新建监听、不恢复流量，确认child退出与本地连接关闭后锁才可释放。R5已覆盖端口冲突/门漂移/DB撤权的正常关闭，未覆盖上述故障闭包。

## R2 — P2：完成组后段失败产生不一致消费状态

[receipt-issuer.cjs:185](candidates/m5-handoff/receipt-issuer.cjs#L185) 先耐久写 `issuance-complete.json`，再逐个写leaf sidecar；[receipt-completion.cjs:5](candidates/m5-handoff/receipt-completion.cjs#L5) 仅检查当前leaf sidecar及两份leaf字节，不要求对方sidecar。

对实际内部publisher在最后一个TLS sidecar写入处注入故障：调用抛错；master和两份signed leaf已存在；**compatibility消费检查成功，TLS消费检查因缺sidecar拒绝**。issueHandoff只检查compatibility完成凭据，因此该状态具备进入后续验证的条件；普通launcher仍要求TLS凭据，未证明可绕过TLS或直接启动。

这是组消费/失败状态契约缺口：不能同时宣称“所有部分失败均不可消费”，又允许抛错后的半套sidecar被下一阶段消费。master既已耐久，历史上可以将它定义为提交点；此时失败必须分类为已提交但交付ACK未知，并有明确只读查证入口。当前代码没有该分类，R5故障测试只在第二个signed leaf处失败，尚未覆盖提交点后的每个marker写入。

建议在修复前明确唯一提交点。优先由一个canonical signed完成manifest验证全组，sidecar作为非授权索引；提交前失败保持不可消费，提交后错误返回/查证COMMITTED_ACK_UNKNOWN，不能重签或自动修补。若选“全部sidecar齐备才提交”，则master必须最后发布且所有消费者检查同一master。两种方案不能混用。

验收：两个leaf、master、各sidecar、目录fsync及返回ACK每个切点；提交前全部消费者拒绝，提交后统一分类，字节/同代/来源/签名错误仍拒绝；查证无重签、覆盖或文件恢复权。

## 已确认的保留边界

现有完成凭据验证Ed25519 purpose/LOCAL/source和全组leaf hash，拒绝路径越界、错签名或leaf字节变化；owner seal另核验receipt/ACK/prepare/challenge/read token绑定。普通listener必须有signed gate和匹配DB COMMITTED/ACTIVE/最新epoch/空claims/profile/ledger，完成凭据单独不能清旗。child继承共享fd；父进程还活着时不能因child崩溃获得未批准业务授权。未发现本次复现能绕过owner或普通启动授权。

## 来源与证据范围

仍为R5 inventory `f85d3c1801e07839388d28dd1a1cc36b9936159b431cb06977a081e0a795595b`；handoff0001 SQL aggregate `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`；terminal prerequisite inventory `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`。本轮保持48文件候选及其源绑定原字节。

[可复现脚本](evidence/repro-m5-completion-exit-review.cjs)和[LOCAL故障证据](evidence/m5-completion-exit-review-local.json)记录两个REPRODUCED，并绑定三份被审代码的hash。publisher使用临时生成authority并经测试专用入口调用内部函数，未覆盖独立review/build/PG批准链；退出复现显式stub认证/profile/TLS，使用实际pg Client、实际子进程及flock。所有临时文件/私钥/协议对端/child均清理，无实际HTTPS或已有PG连接。

R5原25/23/15和更早CI/本地证据保留原适用范围；没有改写为“全部失败边界通过”，本轮不重复PG/CI正向套件。`git diff --check`及复现脚本syntax通过。

[真实交付输入清单](zhiban-v2-m5-real-delivery-inputs.md)已准备，状态仅INPUTS_PENDING；本轮不将未知真实文件、OID、authority、CLOSED、profile或CA信任标为已核验。

下一步先修复R1/R2，补上述切点验证并更新候选hash；随后按清单收集独立输入，再提出真实操作的具体授权范围。建议GPT-6.1 Sol / medium负责这两项已明确的局部实现；若修复改变批准/恢复协议，再做独立安全复评。该选择是工作量判断；模型与medium支持参见[OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。
