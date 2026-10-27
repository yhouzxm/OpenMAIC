# PG18 完整源码 checkpoint 审核与单次远端验收

本轮按用户“审核完整源码 checkpoint，再授权一次 GitHub PG18 验收”执行。审查覆盖原 PG18 候选、实际原生构建依赖、冻结输入、私有材料和远端运行边界；原 LOCAL 证明不修改、不改写为 GitHub 证明。

发现并补齐一项阻断：上一清单只记录恢复 host 的部分来源，遗漏 46 个已变化的原生前端／服务端依赖，以及 PG18 CLI 导入的 portable helper。现合并本机 PG18 source witness 与原生 authoring source/import witness；审核起点的两份测得来源均无漂移；提交检查另清除 `lib/usage/aggregate.ts` 文件末尾一空行，不改变代码 token 或行为，并在新来源清单记录前后 hash。完整来源、审核结论和待提交路径见 [本轮审计目录](evidence/p7-handoff/pg18-checkpoint-20261027/review.json)。原清单保留为历史准备记录，不能再单独用于 checkout。

源码 checkpoint 包含这些功能的实际代码与关联测试、静态候选 SQL、必要文档和经审查的公开 JSON 证据。生成的 live demo 元数据、构建缓存和本机截图不作为新的运行证明提交。旧图片证据继续保留本机及原证明范围。数据库、密码、私钥、`.env.local`、`openmaic.yml`、pgpass 和维护输入不上传；已核对候选文本未包含本机配置中的实际密钥值。

远端只使用 runner 现场生成的合成账号、私有证书和 disposable PG18；不复验外部模型／多模态服务，不激活旧 Native 维护权限，也不激活 PG16 导入实例。workflow 仅手动触发，使用环境 `zhiban-pg18-acceptance`、限定分支和审核后的完整 SHA。该单人仓库使用用户本人 yhouzxm 作为 required reviewer；用户本次已授权一次运行，不声称存在第二位独立人工审核。

仅将手动 workflow 注册到默认 main；产品源码留在 `refactor/zhiban-v2`，不整分支合入 main。提交使用 `[skip ci]` 避免无关自动 push／PR CI，手动验收仍按授权执行一次，见 [GitHub 官方跳过规则](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)。默认分支注册要求见 [手动运行文档](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

签收要求整体 run、验收和清理步骤均 SUCCESS，且唯一允许下载的公开摘要为 PASS，run／attempt／SHA／PG18 reference pin 全部一致。失败保留实际阶段，不自动重试或重新派发。提交、远端 HEAD、注册 SHA、环境及唯一 run 的实际身份另存本目录 execution 记录；未取得真实结果前不写“CI 通过”。

下一完整动作：执行本轮已授权的源码 checkpoint 与单次受保护验收。建议 GPT-6.1 Sol / high。
