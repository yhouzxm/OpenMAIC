# P1/P3 个人设置旧路由兼容

2026-10-23，复用既有个人资料／头像／账户安全与登录标识，不新增业务表、API、ACL或migration。目标为默认3461统一试用；旧3443专项未组合资料API，不能据公共路由helper推断其具备统一产品能力。

## 旧分支核对与接线

只读核对本地 `origin/feature/zhiban-mechatronics`／`0fa0a15e8b12ae9e4f7a2d78e80338874599bbae` 的实际page和组件：student/settings渲染StudentPersonalSettings，teacher/profile渲染TeacherPersonalSettings。包含本人显示资料、头像、联系信息及只读绑定信息；现有V2资料页、头像包、冻结账户安全和受控@标识承担相应差额，未恢复旧账号／手机号授权语义或旧1MB头像策略。

| 旧入口 | 当前行为 |
| --- | --- |
| `/zhiban/student/settings` | 复用profile.html，解析当前空间后以replaceState规范为 `/zhiban/profile?tenant=...` |
| `/zhiban/teacher/profile` | 同上；资料仍只属于当前会话本人，不从URL推断教师权限 |
| `?tenant=<UUIDv7>` | 保留明确空间；原资料API重查本人的该空间访问资格 |
| 旧入口 `?space=<UUIDv7>` | 兼容空间参数并转为tenant；拒绝与tenant同时出现 |
| 无参数旧书签／当前profile | 经原Identity spaces分页查询会话可访问空间；一个空间自动进入，多个空间显示选择，不任取第一个；无可用空间给工作台入口 |

教师／学生工作台“个人资料与账户”已接各自旧入口，规范URL刷新继续加载当前页面，不产生额外历史跳转。未登录给工作台登录入口，明确空间返回链接保留space；跨空间无权限时不给资料表单。重复／畸形／未知参数、任意next／return地址均拒绝或忽略为受控工作台返回，不接受外部跳转目标。

`/zhiban/student/profile` 和 `/zhiban/teacher/profiles` 是学习画像，不映射到个人设置；教师课程settings也不映射到本人资料。角色路径只是显示入口，任何会话只读写自己的资料；教师／学生URL不提供管理员目录或其他人的数据。

资料页→本人登录标识→资料页保留tenant；资料页→工作台保留space。未保存文字取消离开仍留在原页面且保留输入；账户密码、资料和头像的原授权／幂等／保存行为复用，不改写冻结身份合同。

## 本地验证与运行边界

运行 `node scripts/zhiban-local/verify-settings-routes.cjs`，只针对已运行owned LOCAL3461进行浏览器检查，无fixture或业务写入：匿名两个入口、教师／学生角色导航、本人UserId、裸书签／space兼容、规范URL刷新、登录标识往返、未保存取消离开、工作台返回、畸形／重复／未知参数和无权空间、画像路径与额外段仍404。证据：[browser-local.json](evidence/settings-routes/browser-local.json)及[学生截图](evidence/settings-routes/student.png)／[教师截图](evidence/settings-routes/teacher.png)。真实演示账户只有一个空间，多空间选择代码未由本轮真实fixture覆盖，不冒充已验证的多空间旅程。

默认实例因路由模块加载需要受控刷新；旧root三库及control私有文件已[备份并核验TOC](evidence/settings-routes/private-backup.json)，没有恢复演练。当前实例为新合成课堂和新账号，以 `pnpm trial:zhiban:info` 为准。未修改已应用migration／真实55432或55433，未执行PG16专项／完整课堂／模型／扫描／GitHub回归。

前一P7源码包 `zhiban-local-20261023-7b5fc1a08e0d` 保留原摘要，不包含本次路由增量。不存在通过重签旧receipt使新源码获得旧全量证明的操作。

下一完整功能建议沿P1/P3补教师／学生全局成绩旧入口，复用现有受限课程选择、成绩簿及本人结果；建议GPT-6.1 Sol / medium。
