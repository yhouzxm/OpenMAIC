# P3 教学资源上传解析与课程发布合同

2026-10-18，沿原 P1–P7 主线，LOCAL 候选。以官方1.2.0固定SHA `a9da60b3b4adb429369c0da13d5637a904ead2b0` 为复用来源，不重新实现通用材料库或解析器。

## 复用与范围

原生 `/api/materials` 的 owner library、对象存储和异步提取服务属于原生 owner 授权体系，不能直接作为智伴任教／Enrollment 授权。本包直接复用 `resolveWorkbenchMaterialMime`、`extractDocument` 及官方 `plain-text`／`unpdf` provider；只补课程教学班归属、扫描、不可变发布和目录引用。TXT为有效UTF8，Markdown按文本解析，PDF使用textOnly的unpdf；单文件1MiB，最多100份资源／教学班，历史源文件总量32MiB，每资源最多20份源版本。

现有PNG幻灯片编辑／发布保持，不重复移植图片系统。Office、OCR、音视频的原生provider仍可复用，但本轮不开放未配置服务，不伪装解析成功、不调用外部API、AI或原生Runtime。PDF解析不保持原排版、图片、表格结构，扫描件可能没有可读文本，页面明确提供原件下载。

## 用户旅程

教师从课程“讲义与图片”进入上传区，也可从章节“本章上传资源”接续。选择TXT／MD／PDF及标题，扫描和解析成功后生成教师草稿，先查看解析文本及原文件，再显式发布。可返回原章节把资源作为MATERIAL单元加入，目录需独立保存和发布；未发布资源不能发布入目录。

学生只看到当前有效选课教学班的已发布资源和目录；学习中心展示该发布的纯文本，下载必须绑定预览的publicationNo。标题、原始字节hash、文件名、MIME、提取文本、parser版本和扫描证明随源版本固定。替换文件新增草稿版本，既有发布保持；显式再发布才切换学生当前版本。已发布历史版本可由当前有访问权的成员按版本读取，不向退课者开放。归档为终态，学生目录、预览和下载即刻拒绝；教学班关闭时可回读已发布资源，教师写入拒绝。

资源创建者才可替换、发布或归档本人资源；其他当前任教教师可读取已发布资源，不能代写他人草稿。管理员不能代任教上传或访问草稿；自己有有效任教资格的多角色成员沿实际教师授权。课程／教学班归属只由服务端上下文及FK确定，客户端不得提供owner、parser、扫描证明或课程映射。

## 授权与持久化

新增独立 `zhiban_material/0001_material.sql`：resources、不可变versions、不可变publications、追加commands。强制租户RLS及复合FK，business runtime只可更新资源revision、源／发布指针、发布号及归档位；原文件、提取文本及账本无UPDATE／DELETE权限，不增加Identity／Bridge／Native权限。27个既有迁移保持原字节。MATERIAL为业务目录的新单元类型；LECTURE／ACTIVITY原规则不变。

API `/api/zhiban/materials/:tenant/offerings/:offering`，GET目录、POST严格命令；`/:id` GET预览，`/:id/download` GET下载。每次都通过原Session、Tenant、Membership、任教／Enrollment与课程状态检查及锁；校验当前来源版本，不能凭目录缓存或前端角色放行。

上传先授权，复用可信ClamAV做字节hash绑定扫描，再用无凭据环境的独立Node进程调用原生解析，最后重新授权、检查CAS及容量并提交。解析进程30秒上限、256MiB JS heap、输出100000字符；直接加载tsx而非通过多级CLI子进程，超时终止实际解析进程。它是受限输入的本地子进程，不冒称OS级安全沙箱。

外部处理不持有长数据库锁。最后写入顺序为现有身份／关系锁→命令锁→教学班配额锁→资源行锁；目录发布对资源取共享锁。原文件、提取文本、源指针及命令审计同事务；发布记录与发布指针同事务。命令号绑定actor／offering／payload摘要，未知结果原号重试。已提交重放先查受保护账本，不要求重新扫描／解析；不同payload不能复用。发布与替换、并发发布使用同一资源CAS。日志和命令账本不复制正文、base64或凭据。

下载仍要求原自定义身份请求头；页面先携带身份头fetch并生成短期blob下载，不放宽到裸导航。响应强制attachment／octet-stream、nosniff、no-store及sandbox CSP；解析文本由React按文本呈现，不执行Markdown内嵌HTML或PDF脚本。

## 启用与验证

独立fresh owned PG16 56526构建material schema catalog／ACL expected reference并清理；只读loader核对来源hash、唯一迁移账本、catalog、owner、RLS及运行角色属性／继承边。默认owned PG16 56517／HTTPS3461安装并启用；其他未安装host保持关闭。新schema不改变原PNG／Content／Native expected profile，组合同时验证各自参考。

来源收据绑定原生document／pdf文件、esbuild解析出的本地依赖闭包、tsx loader及既有SDK／lock和新增业务源码。参考构造不冒充产品签收。验收包含真实ClamAV、原生TXT／Markdown／PDF解析、教师上传编排发布→学生查看／原件下载、草稿与版本隔离、跨租户／角色、退课、关闭、归档、CAS并发、EICAR／损坏PDF、事务故障、不可变ACL及扩权拒绝。原教学／讨论／资料包在同一默认入口回归，无GitHub重复测试。

原生脏页刷新／关闭人工签收沿用户此前延期，Runtime／AI／维护和生产部署仍隔离。NO COMMIT／PUSH／CI，真实55432／55433不操作。
