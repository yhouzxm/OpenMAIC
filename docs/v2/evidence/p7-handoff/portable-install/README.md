# 本机隔离安装／恢复签收

2026-10-24。`closeout.json` 是本轮索引，记录最终包、源码 digest、逐文件代码 hash、证据 hash 与待验范围。用户选择本机隔离；没有第二台目标机器，也没有生产部署授权。

最终交付使用 `/home/zxm/.local/share/zhiban-portable/release-kit/`，manifest SHA256：

`103cea12346762c01794464d7b79c1a196818ba2f05806f596cdca810ff07af0`

源码 digest：`a310b5758e14af73e614935f44dde97b933b4b2f9f15f6ddbd2a41548e47a18d`，5897 个源文件。外层 `ZHIBAN_INDEPENDENT_INSTALL_V1` 增加 baseline／官方 shallow Git anchors 和独立安装器，复用内层 source handoff 的文件校验，不改写旧 P7 交付或历史 CI 证明。

私有恢复包为同父目录的 `restore-kit/`，仅由当前用户私有保管；它含合成账号／授权材料／TLS 私钥／三库，不公开归档。总 manifest pin：`c2ab07cd0e69586d13ba62d3b26d767d93bc9d031a2b7a8bee4e7342baa17e76`。pin 保证指定内容完整性，不代替可信交付来源；包未加密。模型密钥、外部扫描器授权和旧 Native 维护授权均不随包交付。

`workspace-release/` 通过最终包从零安装，独立 Git、独立 node_modules，无源目录 symlink 或 Git alternates；依赖来自本机 pnpm store、frozen lock。`instance-release/` 独占快照与 TLS。首次显式 source rebind、三角色登录／工作台、受信浏览器、正常停止保存、普通重启无升级参数均通过。`release-validation.json` 核对三库全部非 Identity 的212表、572行逐行指纹及原账号文件；`normal-restart.json` 证明 receipt 字节和数据均保持，不以重新签发掩盖普通恢复。

换目录实际发现任教、开户、登录标识及导入 loader 中的旧绝对来源路径。已改为唯一规范来源名解析，依赖只读取当前 checkout，保留原 SHA256、实时 ledger/catalog/ACL 及 fingerprint；歧义、穿越和目标依赖不匹配拒绝。旧 reference JSON 未重签或改写。`source-binding-negative.json` 使用隔离副本 bootstrap 的临时不匹配，未执行 SQL，finally 恢复，证明不存在回读仍然有效的旧 checkout。未编辑已应用 migrations。

`partial-release-install.json` 是最终 bootstrap 的依赖退出43切点；没有成功 receipt，保留 incomplete 标记。`partial-import.json` 是合成 PG_VERSION 夹具的 TLS 复制故障切点，不启动 PG，只清理本轮新建 state。`live-target-rejection.json` 使用真实已校验备份，源 root 存在时拒绝覆盖。`missing-pointer.json` 证明不意外 seed。`boundaries.tap` 和 `reference-tests.log` 覆盖 hash、额外文件、链接、权限、命名及配置白名单。

`isolated-patched-*`、`original-interim-*` 仅记录问题定位阶段，不冒充最终归档从零安装证明。最初旧候选构建曾滞留 renderer，已停止该候选进程；最终归档 fresh install 正常完成。全仓 tsc 在默认 V8 堆限制下终止；改动 TS 入口及其导入依赖的定向 tsc、改动文件 lint／格式均通过，不把未完成的全仓检查写成通过。没有重跑课堂、模型、扫描或 CI。

最后已停止隔离实例并保留其快照，默认源目录经普通启动恢复。`original-final.json` 核对原账号、全部非 Identity 数据、原受信扫描选择、HTTPS和sourceMatches=true／drift=0。入口仍为 https://127.0.0.1:3461/zhiban 。账户仍从原私有 accounts.json 读取。

精确签收边界：同机不同源码／依赖／Git／状态目录；保留原 `/tmp/zhiban-trial-content-*` 内部 PG 根、56517私有socket、3461 origin和既有签名。真实跨机／不同UID、空缓存网络安装、新主机CA信任、PG任意路径重定位／跨版本／架构转换未签收。真实账户运营、解析服务及冻结Native授权隔离按原主线集中待补。原 Git 分支和 HEAD 保持，无 commit／push／CI。

下一完整交付：目标主机与服务输入齐备后，一次进行真实跨机安装、CA／受限配置交付和恢复验收；常规接线建议 GPT-6.1 Sol / medium，若改变 Identity／授权或并发边界再用 high。
