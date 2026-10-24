# P1/P3 管理员与登录旧入口兼容

2026-10-23，默认3461 LOCAL产品包。只补三个旧入口和登录后上下文，复用既有Identity／受控@登录、Workspace管理员模式、账户目录与管理员导航。不新增API、角色、ACL、表或migration。

## 原分支核对

只读核对本地 `origin/feature/zhiban-mechatronics`／`0fa0a15e8b12ae9e4f7a2d78e80338874599bbae`：`admin/page.tsx`渲染AdminConsole；`admin/users/page.tsx`渲染users模式DirectoryConsole；`login/page.tsx`调用旧auth/login并返回工作台。旧用户目录还含删除和重置密码，旧登录提示支持手机／学号／工号；这些不能随路径兼容重启。当前登录继续只接原UserId及已由独立来源确认的@标识，普通开户、全局启停、凭据／角色变更仍走既有受控产品与运营边界。

| 旧入口 | 当前实现 |
| --- | --- |
| `/zhiban/login` | 复用当前登录HTML／Identity客户端；成功后规范到 `/zhiban?space=...`，已登录访问也恢复当前工作台 |
| `/zhiban/admin` | 经当前会话spaces选空间，再以原Workspace API的ADMIN模式核验，replace进入该空间管理员工作台 |
| `/zhiban/admin/users` | 同样核验后replace进入 `/zhiban/admin/accounts?tenant=...`，原受限目录与管理员壳继续复查权限 |

支持单个 `space` 或 `tenant` UUIDv7；不能混用／重复。无空间的旧书签复用原会话spaces分页：单空间自动选择，多空间让本人选择，未加入空间不能进入。参数只提供导航提示；角色路径、缓存和旧principal权限字符串不供应管理员授权。教师／学生访问两个旧管理员入口会被拒绝，直接打开canonical目录仍由原权限检查拒绝。

匿名管理员链接提供“登录后继续访问”，携带明确空间及固定 `destination=admin|admin-users`。旧登录URL在未登录及刷新期间保留上下文，真实登录后只返回这些固定同源入口，再重新核验角色。已登录不绕开检查。未知destination、任意next／returnURL、重复／畸形参数拒绝，不接受外部URL；入口没有修改密码／存储会话令牌的行为。

管理员目录返回工作台保留空间，原目录分页、筛选、正式档案、成员管理与独立账户开通入口复用。当前网站无需为了使用已交付功能重开旧删除／重置密码接口；全局真实运营审批、身份核验与交付输入继续保留门禁。

## 本地验收

运行 `node scripts/zhiban-local/verify-admin-login-routes.cjs`，仅真实受信HTTPS／Identity／浏览器受影响流程，无fixture或业务写入：

- 匿名users书签→固定登录目标→刷新保留→管理员登录→真实受限目录，查看管理员导航并返回原空间工作台。
- 有／无参数admin及users旧入口；已登录login的tenant兼容；错误空间、重复／畸形／未知参数、任意destination及额外路径拒绝。
- 教师／学生经同一旧入口完成真实登录后不获得管理员权限，旧users和canonical目录均拒绝；旧login恢复本人工作台，不展示管理员导航。

证据：[browser-local.json](evidence/admin-login-routes/browser-local.json)、[目录截图](evidence/admin-login-routes/admin-users.png)、[教师](evidence/admin-login-routes/teacher.png)／[学生](evidence/admin-login-routes/student.png)及[closeout](evidence/admin-login-routes/final-closeout.json)。本轮真实fixture只有一个可用空间，不冒充多空间选择旅程。未重跑完整课堂／PG16专项／模型／扫描／GitHub CI，也未测试新建或重置真实账户。

新路由加载需受控刷新默认实例，旧root三库及control文件已[私有备份并核验TOC](evidence/admin-login-routes/private-backup.json)，未恢复演练。当前为新合成账号与课堂，以 `pnpm trial:zhiban:info` 为准。真实55432／55433、已应用migration、既有dirty候选均不改。

前一P7源码包及个人设置／全局成绩receipt保留各自hash／历史范围，不包含本次入口增量；不重签旧全量证明。本轮未提交、推送或CI派发。

下一完整功能建议沿P1/P5核对并接已有证据型学习画像与风险支持的旧聚合入口，复用已发布观察／规则／补救，维度继续REVIEW；建议GPT-6.1 Sol / medium。
