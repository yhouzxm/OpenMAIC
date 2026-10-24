> 历史版本：保留当时范围；当前状态见 [P7统一交接](zhiban-v2-p7-handoff.md)。

# P7 当前本地交接版本

2026-10-24 合并资源／附件、持久化运行与课程AI学习伙伴。原AI测验和此前产品证据见[上一版交接](zhiban-v2-p7-handoff-ai-quiz-history.md)，不重复课堂或CI。

## 启动与保存

```sh
pnpm trial:zhiban
pnpm trial:zhiban:info
pnpm trial:zhiban:backup
pnpm trial:zhiban:stop
```

入口 https://127.0.0.1:3461/zhiban 。默认启动恢复同一批账号、课程、作答及Native文档；正常停止保存新一代私有PG16快照。账号仍仅从info指向的0600文件读取。详见[持久化与异常恢复](zhiban-v2-persistent-local.md)。本轮关机前将主动停库保存，00:58由系统关机。

依赖：Ubuntu PG16、Node22、pnpm10.28.0、本机受信TLS、已有固定版本OpenMAIC 1.2.1。新机安装／不同绝对路径仍需重建可信绑定，不宣称跨主机完成。默认入口只作启动；独立专项验证入口保持。

## 本轮合并范围

- [资源与附件](zhiban-v2-resource-attachment-bundle-local.md)：TXT/MD/CSV/PDF本地解析；Office/OCR/音视频服务接线及明确未配置提示；扩展附件、真实扫描、提交与下载。每文件仍限1MiB。缺服务的真实解析未验收。
- [AI学习伙伴](zhiban-v2-ai-peer-local.md)：教师单独开关、私人固定类型对话、真实原生Agent回答、取消／撤权屏障及本人历史。
- [持久化](zhiban-v2-persistent-local.md)：三库一致备份与恢复、正常重启及HTTPS进程异常退出恢复；保持已有数据与账号。数据库与敏感运行材料存放在私有快照目录，不进入源码包。

## 制品与证据

本轮源码包由 `node scripts/zhiban-handoff.cjs pack` 生成，使用既有敏感输入过滤、稳定双读、逐文件hash与独立archive verify。具体目录／versionId／SHA记录于 `evidence/p7-handoff/persistent-peer/final-closeout.json`（包外收尾，避免自引用）。源码包括既有dirty候选；Git HEAD不是完整交付内容。

来源边界：资源原定向证明保留其fresh owned source范围；本轮三条新增迁移已在本地旧数据恢复副本升级。正常停止／重启和异常退出恢复证明本机同路径运行；真实伙伴模型回答及在途撤权有独立receipt。无完整课堂重跑、CI、commit、push或生产部署。

## 剩余范围

按[集中执行单](zhiban-v2-expanded-delivery-20261024.md)继续：完整课堂／实验／场景编排，PBL，六维证据画像／EMA，证书／跨班学分／自动正式AI评分。用户已授权这些产品方向，仍未完成，不再沿用历史“是否保留待决定”的状态。

真实Native维护凭据／可信receipt、Office/OCR/媒体解析服务、真实身份运营与换机恢复仍独立待补；不会把页面消息或聊天当正式学习／成绩证据。下一完整包为P4课堂／实验／场景编排，建议GPT-6.1 Sol / high。
