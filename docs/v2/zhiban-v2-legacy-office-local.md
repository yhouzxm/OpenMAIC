# 旧 Office 转换、核对与发布（LOCAL）

本包沿原P3资源主线，复用现有AliDocMind、资料库、原生课件编辑器和固定发布播放器。DOC／PPT／XLS先在本机转为DOCX／PPTX／XLSX，再调用当前解析服务；不把AliDocMind原生格式白名单改成“直接支持旧格式”。

## 使用

教师课程 → 原生备课工作台 → 资料与多模态服务：上传旧文件，等待ready后查看抽取正文。页面说明本地转换和原件保留，并可展开原件／转换件SHA256。教师可编辑“核对后的讲义正文”，点击“以核对正文新建课件”，进入现有工作台核对完整课件、采用为课程草稿，再在原审核页显式发布；学生读取固定发布版本。

创建的是可编辑正文讲义，表格、公式、分页及原PPT版式须教师核对，不承诺无损版式复刻。源文件与原抽取正文不被教师文本修改覆盖。一次核对正文最多40000字，长文须显式精简；按400字分为原生幻灯片，没有静默截断。该入口不再调用备课生成模型，不自动发布、计完成或改成绩。需要原生PPTX完整导入编辑时，原有入口仍按自身能力范围使用。

## 接线与边界

- 资料库上传策略补DOC／PPT／XLS；能否解析仍由主机转换能力、可信扫描器与所选解析服务共同决定。未配置转换器时，智伴课程入口不宣称旧格式可解析。
- 仅对配置为AliDocMind的旧格式启用转换；其他提供者保持原选择合同。上传原件仍限1MiB，必须是OLE/CFB容器；改后缀的ZIP、空文件、超限文件拒绝。
- 转换固定输入、输出名称及格式filter，不接收浏览器命令、工具路径、输出路径或转换参数。原件执行前及OOXML结果出站前均通过现有可信扫描，按扫描返回digest核验。
- 每次使用独立私有临时目录和LibreOffice profile，禁宏；Bubblewrap隔离网络、PID及文件系统，不挂载用户主目录。子进程环境不含服务密钥／DB配置；只读挂载程序及系统依赖，只允许写本任务输入外的临时输出／profile。固定超时90秒、CPU60秒、地址空间3GiB、日志64KiB、结果16MiB等限制，结果再受扫描器限额约束。中止／失败等待子进程退出并清理私有目录。
- 持久化解析结果带转换receipt：原件／结果hash、MIME、大小、转换器版本和启动二进制hash、扫描与隔离标记。原件仍在owner资料库；临时转换件随任务清理，不声称保留其下载副本。旧格式解析cache加入转换协议及转换器版本／binary指纹，普通格式cache合同保持。
- 授权仍使用既有任教、owner资料、原生文档及Content发布屏障。新草稿通过原生PUT文档接口保存；没有放松文档授权来容忍错误HTTP方法。正文中的HTML符号转义后进入文本元素。

## 本机工具与换机配置

已有Codex LibreOffice开发构建在Calc路径不能可靠完成；没有将其XLS结果签收。已通过Ubuntu官方apt签名索引执行download-only，将稳定24.2.7及依赖解包至owner-only工具目录，复制发行包提供的默认registry配置，并在隔离命名空间补只读OS依赖引用。没有安装／替换系统包，没有sudo、root改动或使用开发构建冒充稳定版。

本机私有`.env.local`仅新增两个非秘密设置，原提供者凭据及槽位保持：`ZHIBAN_OFFICE_CONVERTER_PATH`指向稳定版`program/soffice`，`ZHIBAN_OFFICE_CONVERTER_ROOT`指向该私有Ubuntu包根。工具目录为`~/.local/share/zhiban-office-converter/ubuntu-24.2.7-amd64`，包hash清单`operator-package-profile.json`位于该目录。它依赖本机只读OS库，不是独立跨机二进制包。

目标Ubuntu可使用发行版`libreoffice-writer`、`libreoffice-impress`、`libreoffice-calc`、`bubblewrap`和`util-linux`，将`ZHIBAN_OFFICE_CONVERTER_PATH`设置为实际`program/soffice`（或默认`/usr/bin/libreoffice`），系统安装不需要私有ROOT设置。配置随普通启动加载；修改后需正常保存／停止及重启。无转换依赖只阻塞旧Office，不阻塞已交付图像、语音、视频或现代文档解析。

## 验收证据

`evidence/legacy-office/parsing.json`记录三个真实OLE样本的本地稳定版转换、原件／结果扫描、AliDocMind真实解析、校验内容和学生私有资料拒绝。`teaching-journey.json`记录教师在真实页面核对并编辑正文、新建课件、原生预览／采用／审核发布及学生固定版本查看。`closeout.json`记录最终运行源码、定向检查、配置与备份范围。

最初发现并修正资料库旧格式上传白名单遗漏；页面保存第一次用了不受支持的POST，原授权正确返回403，修正为标准PUT后按原授权保存。此前成功的服务接入和P7源码归档保留原证据范围。本包不改已应用migrations、不重打P7，不提交／推送或运行CI。
