# P3 本人头像与受限目录展示

2026-10-23，LOCAL 产品包。本人在“个人资料与账户”上传、替换或移除本空间头像；管理员在原有受限成员账户目录看到头像，无头像时显示占位文字。不同空间的 Membership 独立，不自动同步到全局账号、其他空间、课程名册或公开页面。

## 格式与治理

首包只接受完整 PNG，最大96×96像素、12 KiB；不支持JPEG、SVG、GIF/APNG、外部URL或任意HTML。复用现有 `validatePng` 的结构／CRC／解压长度／过滤器检查和附属元数据剥离。服务端再次检查规范base64、尺寸及字节上限，浏览器校验只作提示。头像以内联PNG投影经原已认证资料／目录API读取，不创建公开文件链接。只有profile.html的局部CSP增加 `img-src data:`，脚本等策略不放开；所有JSON仍no-store。

PNG校验是封闭图片格式验证，不声称完成通用杀毒扫描。扫描附件／材料门禁保持原状态，未依赖不可用的scanner来伪造成功。

## 数据、授权与并发

新增 `0002_avatar.sql` 候选，增加 tenant RLS 的 avatars 和只增审计／幂等表 avatar_commands；运行角色仅SELECT/INSERT和头像列UPDATE，无DELETE、schema CREATE或Identity写权限。未改既有0001或其他已应用migration，只在新owned disposable PG16应用。

原 `POST /api/zhiban/profile/:tenant/me` 接 `SAVE_AVATAR`、独立revision和png/null，目标固定当前Membership，不接受目标ID。管理员不能经members端点替别人上传；学生、教师无管理员目录访问权。复用原Session／Membership／RoleGrant当前性屏障、CSRF和事务终检。

独立目标锁＋revision CAS只允许一个并发更新胜出；command key＋actor＋规范内容hash保证原命令重试不重复写，不同内容重用key冲突。审计只存摘要和版本回执，不复制图片；移除保留版本墓碑，旧null版本不能覆盖后来的头像。头像更新不改变文字资料revision，前端也保留未保存的文字输入。结果未知时按原命令重试，不盲目重发新版本。

## 本地验收

- `pnpm exec tsx scripts/zhiban-local/build-profile-reference.ts`：独立新PG16构建两份migration的expected catalog／ACL参考；loader核对两行ledger、各source hash和完整catalog，旧环境缺0002时拒绝启用。
- `pnpm verify:zhiban:avatar`：只跑本包真实PG16／Identity／HTTPS／浏览器旅程。验证本人写、受限管理员读取、跨租户拒绝、无会话拒绝、伪造目标拒绝、非法／超尺寸／超长度图片拒绝、幂等重试、并发CAS和文字版本独立；浏览器上传→移除→替换，保留未保存显示名，并确认图片实际解码；管理员目录也确认实际解码。
- [本包receipt](evidence/zhiban-avatar-local.json)、[本人页面](evidence/zhiban-avatar-self-local.png)、[管理员目录](evidence/zhiban-avatar-directory-local.png)。证据仅LOCAL，不是生产部署／GitHub签收。
- 原profile合同和PNG测试定向通过；`tsconfig.avatar.json` 和本轮源文件ESLint检查通过；较宽的原 `tsconfig.profile.json` 仍报告既有onboarding verifier额外store参数差异，不作全仓类型签收。未跑全仓或无关模型／附件／导出／课堂回归。

原3461实例在开始切换前已不运行，尝试为其新增备份因旧socket不存在而失败，没有宣称本轮备份成功或恢复了旧数据。历史P3／P7私有备份仍保留原范围。默认入口重新启动后生成全新合成账号与课堂，请使用 `pnpm trial:zhiban:info` 指向的当前账号；不复用旧ID。

旧P7源码包及先前跨页导出receipt保留原hash／适用范围，不包含本轮头像增量。更多图片格式／裁剪缩放／全局或课程名册展示不在首包；不扩大管理员目录给学生读取。下一完整包建议P7更新统一交接版本，纳入跨页成绩簿与头像增量；建议 GPT-6.1 Sol / medium。

默认3461已重启，sourceMatches=true／漂移0；真实浏览器本人上传64×64 PNG并解码，管理员目录解码同一头像通过。页面证据：[本人](evidence/zhiban-avatar-3461-student.png)／[管理员](evidence/zhiban-avatar-3461-admin.png)。演示头像为合成色块，非真人资料。
