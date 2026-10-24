# 默认入口与命令交接

2026-10-23，精确值来自当前 package.json；[旧接线记录](zhiban-v2-trial-entry-handoff-history.md)保留当时 --trial-content 的范围，不能当作当前 --unified-trial。

| 公共命令 | 当前脚本值／含义 |
| --- | --- |
| `pnpm trial:zhiban` | `tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --serve` |
| `pnpm trial:zhiban:info` | `tsx scripts/zhiban-local/trial-control.ts info --unified-trial`；只读当前进程／根／source／账号路径 |
| `pnpm trial:zhiban:stop` | `tsx scripts/zhiban-local/trial-control.ts stop --unified-trial`；只停止准确绑定的 owned 实例并删除数据 |
| `pnpm verify:zhiban:trial` | `tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial`；显式完整验证，新建环境，占同一固定端口 |
| `node scripts/zhiban-handoff.cjs status` | 汇总现有 info、版本及配置边界；不启动、停止、改权限、迁移或打印密码 |
| `node scripts/zhiban-handoff.cjs pack` | 导出当前 dirty 源快照与 hash，排除运行数据／凭据；不提交或推送 |
| `node scripts/zhiban-handoff.cjs verify /绝对路径/source.tar.gz` | 只读核对归档条目／文件 hash，不提取、不安装、不签生产权限 |

当前公共入口 3461，PG16 私有 socket 56517，业务库 `zhiban_trial_content_disposable`，内容 Native 与讲义 Native 各自独立库。没有TCP PG监听；不操作55432／55433。

`:content`／其他端口为原专项兼容模式，各自 metadata、argv、角色、loader 范围不同；不把它们说成 unified 的全部能力。不同标签／端口共享 Cookie。当前账号与动态ID以 info 为准；源码包不包含运行账号或模型配置。

当前试用、跨页CSV／头像及七组旧入口增量、可复现源版本、各轮旅程证据边界及 deferred gates 的统一签收见[P7交接](zhiban-v2-p7-handoff.md)。
