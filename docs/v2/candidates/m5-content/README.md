# M5-A/B SQL 来源与本地安装边界

本目录是受控 SQL 来源；不被既有 migration runner 或 web 启动自动加载。2026-10-09 用户授权本地 installer 与文本闭环后，专用 installer 已在自有开发库应用 01/02/03。**不要直接用 psql 重放或扩大到其他环境。** 当前状态见 [本地交付记录](../../zhiban-v2-m5-ab-local-closeout.md)。

完整对象、helper、ACL、source/checksum、receipt 与本地应用边界见 [M5 SQL 清单](../../zhiban-v2-m5-sql-inventory.md)。四类交付分别是 01-schema.sql、02-helpers-and-guards.sql、03-acl.sql、inventory.json + receipt.template.json。

Logical migration `0001_content` = 01/02/03 原始 bytes 顺序拼接；00 是 installer 前置检查，04 仅未来 catalog 采集。SQL 文件中 UNAPPLIED 注释保留生成时历史，不改已应用 bytes；当前仅 LOCAL 开发库已应用。完整 enabled gate 的 receipt.template.json 仍 UNISSUED，技术安装 receipt 单独签发到私有目录。既有 migration 与 Native bootstrap 不修改。

离线 hash/边界核验：`python3 docs/v2/candidates/m5-content/verify-static.py`。如提供 PG16 对应 pglast（6.x），同一脚本追加 SQL/PLpgSQL/动态 DDL 模板解析；没有该依赖则明确 NOT_RUN，不假称语法已核验。无需 PostgreSQL 连接或项目依赖改动。

四项修复与临时 PG16 验证见 [修复记录](../../zhiban-v2-m5-sql-fix-local.md)。`pnpm exec tsx scripts/zhiban-local/verify-m5-sql.mts` 自建/清理独立 Unix-socket-only PG16 fixture；不使用或修改 55432/55433。`refresh-inventory.py` 仅更新 byte bindings，不签发 receipt。

当前候选包含 [SM-01 activation 反向绑定修复](../../zhiban-v2-m5-sm01-fix-local.md)，PG16 53/53 PASS；上述脚本现在输出 `evidence/m5-sm01-fix-local.json`，原四项修复与缺陷复评证据保留旧 hash 边界。
