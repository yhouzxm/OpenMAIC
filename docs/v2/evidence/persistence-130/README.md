# 本轮交付入口

[签收与范围](closeout-local.json)保留源代码包、私有包和数据快照 pin；不要向 Git 仓库提交私有包。

最终副本已停止，默认旧指针未切换。本机启动：

```bash
ZHIBAN_LOCAL_STATE=/home/zxm/.local/share/zhiban-130-persistent pnpm trial:zhiban
```

源码安装包和私有恢复包位于 `/home/zxm/.local/state/zhiban-delivery/130-20261029/`。私有恢复包已经在同机另一命名空间导入并核对闭包；没有执行跨机或 RDS 安装。根 `.env.local`／`openmaic.yml`、扫描器 authority 与生产批准不随包交付；本机原配置保持原位置，新环境另行受控配置。

三张旧截图被后续复验覆盖，不能继续核对其历史 hash；原 receipt 不改写。本轮截图使用独立目录，见 scope note。
