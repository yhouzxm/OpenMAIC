# P3 资源与附件完整接线包（LOCAL，2026-10-23）

沿原P3一次接资源与附件，不逐格式重开任务；既有课程归属、不可变发布、当前任教／Enrollment、扫描hash、下载隔离、版本CAS和处理后重新授权保持。

## 当前产品范围

- 资源：TXT／MD／CSV复用原生plain-text，文本PDF复用unpdf；Office DOCX／PPTX／XLSX、图片PNG／JPEG／WebP OCR及音视频采用原生document/media registry，通过独立主机配置启用。不重写解析引擎；没有配置时明确拒绝，不生成假正文或假成功。
- 附件：文字作业支持上述文档／图片以及MP3／WAV／M4A／AAC／MP4／MOV／WebM，复用正式提交与重交、教师查看评分和历史下载。附件仅扫描及下载，不自动解析、不在线执行，不因附件内部自报生成成绩或完成事实。扩展名、规范MIME、文件头及文本UTF8均校验；文件头只识别容器，不保证内容有效。
- 维持每文件1MiB、资源文本100000字符、每班100份／历史32MiB和20源版本等既有边界。首包未提高媒体容量；较大音视频会明确拒绝，后续提高容量需同步请求、扫描、存储和客户端限制，不能只改选择器。
- 新服务公布附件accept能力，选择器按后端能力开放；旧进程未公布新能力时继续仅PDF/TXT，避免静态脚本更新后向旧API发送新格式。页面显示扫描器状态，提交不支持／未配置解析格式时说明原因，原资源下载及学生历史不受新上传故障影响。浏览资源不记完成；正文为纯文本，不保留Office/PDF原版式或执行内嵌HTML。

## 受限解析配置（用户确认未配置，真实Office/OCR/音视频待验）

主机传入 `ZHIBAN_MATERIAL_PARSER_CONFIG` 绝对路径与 `ZHIBAN_MATERIAL_PARSER_SHA256`；文件owner必须为当前用户、普通非symlink、0600、最多16KiB，pin核对。请求不得指定provider／URL／凭据。读取一次后仅传给无继承凭据环境的解析child，不通过列表、日志或响应返回。无配置不影响本地文本/PDF和扫描附件。

私有JSON结构例（按实际服务填写，禁止将真实凭据提交）：

```json
{
  "document": { "providerId": "mineru", "baseUrl": "http://127.0.0.1:8000" },
  "media": { "providerId": "alidocmind", "accessKeyId": "<private>", "accessKeySecret": "<private>" }
}
```

可用provider及MIME以当前原生registry为准；media也支持原生local-ffmpeg及其ASR配置，但本机尚无ffmpeg／ffprobe或真实ASR。本包不安装未授权的外部收费服务，不自动将模型密钥用作解析凭据。远端解析意味着向配置的服务发送原件；这是主机显式选定的服务，原生网络策略仍生效。解析child 30秒／256MiB、内部请求25秒，超时杀进程组；大文档／慢服务可能拒绝，不能承诺长任务成功。

## 扫描器与数据

官方freshclam成功将daily更新至28162；官方增量库产生CLD，加载器与profile builder现支持CVD/CLD，并要求main/daily/bytecode各恰有一份主库。继续校验实际内容header时效、官方库、动态库／证书闭包、文件hash与真实clean selftest，不放宽7天规则。新profile选为未来启动的active，旧active保留私密备份，当前3461进程pin未热改。

仅新增material `0002_resource_formats.sql`、learning-files `0004_attachment_formats.sql`，不改旧migration；没有新增写角色或扩大ACL。material可信参考在独立fresh owned PG16重建，loader逐migration核对来源、ledger及catalog/ACL。现有3461数据未停止或迁移；本包新schema仅用于独立LOCAL disposable验证。源码改动不会热替换旧进程，默认下一次创建新试用实例才加载新接线。

## 验证与证据

定向单元、类型及真实扫描PG16／浏览器结果记录于 `evidence/zhiban-resources-bundle-final-local.json`。重点为原资源发布／学生下载、CSV新增解析、真实DOCX附件／教师下载、扫描感染／不可用、缺服务、跨课程／撤权、幂等／CAS及事务回滚。来源各按该次hash，历史receipt不重标。未配置服务的Office/OCR/媒体只验证配置／路由及拒绝，不冒充真实解析成功。

下一完整包为P4完整课堂与实验，复杂Identity／可信Runtime边界建议GPT-6.1 Sol / high。解析服务真实输入集中待补；无需在每种格式后重打P7或重复完整课堂回归。NO COMMIT/PUSH/CI。

2026-10-24收口：定向类型、ESLint、原材料／附件单元和新增配置检查通过；fresh PG16与真实ClamAV的明确API边界检查通过。旧附件浏览器脚本的登录标签与自动展开历史被再次点击折叠两处接续假设已修正，失败receipt均保留。最终browser-only附件接续及完整受影响资源旅程PASS（`zhiban-resources-bundle-continuation-local.json`），未重复此前已通过的附件配额／负向套件；最终生产源码与通过旅程启动hash一致。`zhiban-resources-bundle-final-local.json`按原run/source组合证据，不将早先整体FAIL改为PASS。所有独立测试实例均已清理，原3461继续保留；Office/OCR/音视频真实解析依然待服务。
