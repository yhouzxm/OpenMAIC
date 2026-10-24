# M5 同代签发与普通 HTTPS：定向复评及本地接线

2026-10-13；branch `refactor/zhiban-v2`，HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，保留已有dirty worktree。**LOCAL_ISSUER_TLS_HTTPS_WIRED / REAL_TARGET_UNAPPLIED**。没有commit/push/CI dispatch，没有读取真实私有凭据或连接55432/55433。

## 定向复评与修复

1. **签发权限**：受信结果必须源于固定代码实际执行。新增独立reviewer Ed25519 pin，批准绑定controlDirectory、source、operational issuer pin、精确payload/validation输入。compatibility旧receipt通过实际文件hash由reviewer批准其适用性；签名不自动扩大旧证据。HANDOFF签发器亲自调用新challenge child，不接受外部resultPath或“全true”JSON。issuer私钥不进入release/普通host/validator；固定根单次permit阻止换outputDirectory重放。两把key区分审核与签发，但同OS owner仍属于信任边界，不等价于部署了双人/硬件隔离。
2. **部分签发与消费**：全部leaf fsync后才签ISSUANCE_COMPLETE组凭据；seal/launcher要求完成签名和全组字节。中断留下INTENT/部分叶，无消费资格，不覆盖、不自动重放；换新批准须先查证旧状态。完成凭据后ACK未知仍须精确查证，不能重新签一代或自动清旗。
3. **部分构建与秘密暂存**：物理闭包验证和子目录fsync先于artifact完成标记；TLS staging前后漂移拒绝。validation request含旧凭据，只经private fd交付且finally删除；无秘密challenge/result继续保留。
4. **host寿命边界**：旧control loader观察后即释放锁不足以覆盖监听进程；新增supervisor持共享锁、fd4继承、IPC检查、退出回收。原socket-only测试判定仅对精确56496专用TCP fixture作补充，真实55433端点规则保持。

## 实现与使用边界

- [receipt-issuer.cjs](candidates/m5-handoff/receipt-issuer.cjs)：proposeBundle / issueBundle / issueHandoff；[完成凭据消费](candidates/m5-handoff/receipt-completion.cjs)。没有任意签名、SQL、凭据轮换或清旗API。transport/shadow、独立ordinary expected和独立clear批准仍为外部受审输入。
- [release-tls.cjs](candidates/m5-handoff/release-tls.cjs)：显式staging证书/私钥/CA，验证日期、IP SAN、serverAuth、RSA匹配、CA签名；builder将原字节纳入同代artifact和TLS receipt。证书信任由客户端明确配置；代码不修改系统/浏览器信任库、不允许跳过TLS验证。
- [ordinary-launcher.cjs](candidates/m5-handoff/ordinary-launcher.cjs)和[实际HTTPS child](../../scripts/zhiban-local/release-https.ts)：只消费同代完整输出和已提交clear gate，检查ACTIVE/最高epoch/空claims/完整profile及ledger；实际M1–M5 composition、页面、renderer/editor与API。固定127.0.0.1:3443，复用原header/path/body限制及局部CSP，代码运行无installer/controller/issuer权限。原开发launcher保持原门禁。

supervisor每请求在入口和body读取后检查，另每秒检查；失败/门变更/源或产物漂移/撤权/IPC失联停止服务，强制终止兜底。维护方先停host再取独占锁。已入场业务请求不承诺在带外撤权瞬间回滚；原领域事务屏障保持，完整并发撤销/OS崩溃矩阵另验。Node permission与JS guard用于受审代码约束，非恶意native addon或管理员沙箱。

## 证据适用范围

独立0700 `/tmp/zhiban-release-pg16-*`，PG16/56496，只监听loopback；临时CA和两个临时签名authority，最小Native、合成CLOSED/profile和旧receipt。测试经实际seal/clear，再运行真实HTTPS；finally结束所有child/连接并停删cluster。检查全部既有业务/terminal行digest（本轮允许clear创建controller_authorizations控制记录，显式排除该一表），ready/claims不变。未进行真实账户登录/发布旅程、真实Native全结构、浏览器系统CA信任或生产验收。

旧R4/R3/terminal/Storage/Identity证据保留各自原SHA/inventory和适用范围；不将新源码借用旧PASS，也不重复远端CI。所有模板仍UNISSUED；真实signature/authority/host/gate尚未交付。

本轮候选共 **48 文件**（含inventory），另绑定release-product.ts/release-https.ts及既有接线源；inventory `f85d3c1801e07839388d28dd1a1cc36b9936159b431cb06977a081e0a795595b`。handoff0001 SQL aggregate仍为 `bbede0be2e773562730bb2b1c756d4aceba853143b298b768de7c0d70d624a8e`；terminal prerequisite inventory仍为 `4e5585a55aae259a39ac5c0aa01f40e66c4dbb138d99b2d093c626565c9d662a`。无SQL/helper/ACL/migration改动。

- [实际issuer/TLS/HTTPS + PG16](evidence/m5-issuer-https-pg16-local.json)：**25/25 PASS**，真实bundle/六角色SCRAM、双pin批准、错代/错key/过期拒绝、部分签发无完成凭据拒绝、换目录/维护根重放拒绝、缺证无ACK、实际seal/clear、可信CA握手、workspace/editor/401、Host拒绝、端口冲突、TLS漂移、门漂移/DB撤权停机、锁释放与业务行digest检查。
- [受影响控制执行器](evidence/m5-issuer-https-executor-local.json)：**23/23 PASS**，fixture显式补合成完成组签名；原未知COMMIT/部分发布/撤权屏障保持。
- [静态与source](evidence/m5-issuer-https-static-local.json)：**15组 PASS**，36 SQL / 10 PLpgSQL，PG16.1 grammar。

三份证据一致绑定本轮inventory和SQL aggregate。`git diff --check`通过；branch/HEAD未变。临时cluster、release、签名私钥和CA全部停用/删除；3443监听已退出。证据中的真实代码执行不提升合成expected/旧receipt/管理观测为真实target批准。

下一步：定向复评完成组消费、监督进程退出/已入场请求边界，再准备真实expected/shadow/transport、受信CA和凭据交付清单。建议 **GPT-6 Astra / high** 处理跨签发、进程与并发授权的复评；本轮局部PASS不授权真实交付。
