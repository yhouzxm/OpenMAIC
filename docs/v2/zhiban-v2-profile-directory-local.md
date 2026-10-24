# P3 个人资料与账户／目录本地产品包

2026-10-18，LOCAL 未提交候选，沿原 P1–P7 主线补实际差额。基线 `refactor/zhiban-v2` / `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，须连同当前 dirty 候选和本轮收据使用。验证结果以本轮证据为准，不复用旧 CI 签收新源码。

## 交付范围

工作台及独立课程页提供“个人资料与账户”。本人可保存当前空间的显示名、联系邮箱、QQ、微信及简介；显示名同时更新现有名册／讨论的公开姓名来源。联系方式和简介只对本人返回。页面只读显示自己的 UserId、当前成员状态／角色，以及管理员维护的正式姓名和学号／工号。邮箱未验证，不用于登录或找回；业务编号不成为登录别名。

管理员导航新增“成员账户目录”，保留既有“学生目录”。可按显示名／正式姓名／学号／工号搜索，按状态／当前角色过滤，10／20／50 条分页；可维护本租户成员的正式姓名、学号及工号，业务编号各自在租户内不区分大小写唯一。目录不返回本人私有联系方式／简介。当前成员状态和角色只读。

账户安全页面接既有本人改密与退出全部会话 API，继续使用 UserId 登录和冻结的密码规则；成功后需重新登录。密码只驻留输入框及请求，不进入业务命令账本、证据或页面存储。未知结果清空密码，不自动重放。新增开户、成员启停、登录标识管理、角色授权及重置他人密码仍需既有入驻／同意／审批规则和专门授权，不以旧版直接写 Identity 表代替。

[精确设计](zhiban-v2-profile-directory-design.md)对照了固定旧 feature 分支和官方 1.2.0：新版模型／课堂设置不能替代租户档案。此包复用原 Identity 和课程壳，仅补业务档案，不回抄旧版明文账户管理，也不启用 Runtime／AI。

## 数据与并发

新增独立 `zhiban_profile/0001_profile.sql`，只在 owned disposable PG16 安装；所有既有 migration 字节保持。新 schema 包含本人资料、正式档案及只追加命令账本，强制租户 RLS。显式增加 business runtime 对 `zhiban_academic.people.display_name` 的单列 UPDATE 权限，用于同事务更新公开显示名；不扩张 Identity／Native 写权限。

读写均复用当前 Session／Tenant／Membership 与角色锁。写入严格字段白名单、revision CAS；命令锁再目标锁，同一命令号只能重放同 actor／target／payload。私有资料、公开姓名与命令结果同事务，故障全部回滚。管理员正式档案与本人显示资料分表，不互相覆盖。日志和账本不复制联系方式或简介原文。

成员目录通过受限身份客户端读取本租户允许的账户元数据，再与业务正式档案组合。候选扫描窗口上限200，页面最多50；无匹配但仍有候选时明确提示继续翻页。HMAC cursor 绑定租户、actor、过滤与页大小；服务重启后旧 cursor 失效，从第一页刷新。分页不是授权凭据。

页面保留未保存输入、取消离开保护和冲突后的显式读取；未知保存结果只允许原命令号重试。原生刷新／关闭人工签收仍沿先前用户延期范围，不能由本包的 beforeunload 代码或自动化取消离开冒签。

## 安装与证明边界

独立 `build-profile-reference.ts` 在全新私有 PG16 56525 构建预期 catalog／ACL 后清理 owned cluster，生成[档案参考](evidence/zhiban-profile-directory-reference-local.json)。新的单列公开姓名 ACL 同时由全新 PG16 构建[组合 PNG 参考](evidence/m5-png-profile-reference-account-local.json)；旧 quiz／PNG 参考保留原范围。构造参考不算产品旅程。

默认3461统一 host 才选择新组合参考并安装档案迁移；先核验组合 catalog／ACL，再以只读 `loadProfile` 核对新 schema、唯一迁移账本和来源 hash。缺安装不启用，来源／catalog／ACL 不匹配拒绝启动。网站请求不安装 SQL，不用运行目标自签预期参考。其他旧 host 保留原组合参考和关闭范围。

当前课堂重建前，旧双库及账号已备份到 `/home/zxm/.local/state/zhiban-trial-backups/profile-20261018-195616`，目录0700、文件0600；不自动恢复或冒称继承。当前账号路径和状态以 `pnpm trial:zhiban:info` 为准；停止删除 owned 环境，重启生成新合成数据。

## 验证状态

结果：4个定向文件29项通过（档案／讨论输入合同23项，gateway／学习入口回归6项）；受影响依赖闭包 TypeScript与新增及受影响服务／脚本 ESLint通过。默认统一旅程25组通过，其中5组覆盖本轮授权／隐私、CAS／故障回滚、分页／RLS／ACL、双角色页面和本人账户安全。真实扩张DELETE ACL与错误迁移账本hash均被只读loader拒绝，恢复原状态后通过。参考构造独立记为构造证明，不替代这些产品结果。

26个既有migration hash不变；当前1395项运行来源核对匹配，`sourceMatches=true / drift=0`。当前账号文件 `/tmp/zhiban-trial-content-NooUM6/accounts.json`。完整启动、检查及来源见[最终收据](evidence/zhiban-profile-directory-local.json)，本轮五组精简结果见[旅程收据](evidence/zhiban-profile-journey-local.json)。内置浏览器已从学生工作台实际进入个人资料页面；没有执行浏览器改密、原生刷新／关闭人工签收或真实账户操作。

无 commit／push／CI dispatch，未访问真实55432／55433或待补维护凭据。

下一步沿 P3 接更多教学资源格式的课程归属／发布差额，集中复用新版上传解析及导入能力；账户开通等规则单列，不阻塞普通教学。建议 GPT-6.1 Sol / medium，跨 Identity 授权设计时再提高推理强度。
