# OpenMAIC 1.2.0 兼容性与复用差额

> 本文件保留升级前审计与课程入口的历史结果。用户随后要求先全量升级，当前实施与验收见 [全量升级记录](zhiban-v2-openmaic-120-upgrade.md)；下文“未合并／未升级”和 1.1.2 状态仅对应当时轮次。

2026-10-17，LOCAL，分支 `refactor/zhiban-v2`、HEAD `daf63afa83470d24a9ed41d171c6a17f8a80adb6`，既有dirty候选保留。目标为官方稳定tag `v1.2.0` / `a9da60b3b4adb429369c0da13d5637a904ead2b0`，不是移动main或fork main。本轮下载固定SHA源码到项目外只读审计目录，核对源码和正式exports；未合并上游、安装新依赖、修改已应用migration或访问真实55432/55433。

结论：**1.2.0不能原样覆盖当前1.1.2适配；公开渲染接口可以继续复用。** 本轮交付课程学习入口并保持当前storage pin；不把入口完成写成全栈1.2.0升级完成。

## 固定版本与实际差异

根运行要求仍为Node>=22.19.0、pnpm10.28.0；Next16.3.3、React19.2.3及本次核对的ai／pg／zustand／zod声明版本相同。此结论仅是声明对照，未把1.2.0 lock安装或完整运行验收算作通过。

| 包 | 当前 → 1.2.0内版本 | 核对结果与动作 |
| --- | --- | --- |
| DSL | 0.11.2 → 0.11.3 | exports集合不变；仍复用公开类型／验证，不复制DSL |
| renderer | 0.1.11 → 0.1.14 | exports集合不变；`src/SlideCanvas.tsx`字节完全相同。课程入口直接消费正式SlideCanvas；没有完整Classroom／Quiz／PBL播放器的package export，不能导入网页internal冒充SDK |
| editor | 0.0.9 → 0.0.11 | exports集合不变；当前入口只读，不新增编辑器／保存协议，不触碰现有authoring |
| storage | 0.31.1 → 0.37.3 | 新增`./pg-migrations`。owner-bound PgDocumentStore必须显式documentOwnership；版本化schema ledger及owner迁移影响当前Native receipt／ACL和安装器，**阻止直接替换** |
| generation | 0.3.13 → 0.3.20 | exports集合不变不等于行为兼容；升级时按实际生成用途接公开接口，不重建同名流水线。本轮未启用生成／真实AI |
| importer | 0.3.0 → 0.3.1 | exports集合不变；继续按其browser-only／受控材料导入边界使用，不把生成素材当学生Submission附件 |

renderer整体仍有其他源码改动，只有SlideCanvas文件已做字节一致核对；不以此声称整个renderer或六包全回归通过。版本和export对照的完整hash见 `evidence/zhiban-openmaic-120-compatibility-local.json`。

## 具体升级缺口

1. **文档归属是实际运行不兼容。** 当前 `infrastructure/content/native.ts` 和 `infrastructure/openmaic/native-storage.ts` 构造PgDocumentStore仅提供ownerId、withTransaction等。以官方0.37.3源码打包执行构造探针：旧选项被拒绝；documentOwnership:false且无宽权限确认被拒绝；显式relation可构造，3/3通过、0数据库查询。不是mock出的安全结论，也不是PG schema升级验收。
2. **归属relation、安装与撤销需一起适配。** 使用新公开`documentOwnership`关系，保持opaque owner和每次业务授权；不能设置宽权限开关来绕过owner变化。原`provisionNative`只在空Native库安装并以receipt核验后续状态，不是现有库自动升级器。新版schema ledger／ownership迁移需要追加、回填／回退及最小ACL的完整候选，再在owned PG16演练；历史已应用SQL不修改，旧receipt不重标新版本。
3. **原生身份／服务端API与智伴API不等价。** 官方1.2.0调整了持久化、生成和配置接口及部署形态，见[发布及升级说明](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.2.0)。当前智伴受控host没有透传这些旧原生路由；不存在把原生route重命名即可获得租户／Enrollment授权的升级路径。仅为实际需要的能力补薄适配。
4. **网页能力存在，公开宿主面仍有限。** 新版Stage／Quiz／Interactive／PBL及server generation网页代码是复用候选；公开renderer仍是slide渲染及effects等。完整执行应优先消费正式支持的host合同／服务，而非复制private store或实现第二套引擎。课程目录、本人Attempt和人工成绩属于本轮仍需的智伴业务连接。

## 本轮课程学习入口

- 师生课程侧栏增加“学习中心”；`/zhiban/{teacher|student}/courses/:course/learning-center`及`/:unitUUID`打开课程发布目录的精确单元。
- 只列可访问的已发布讲义／活动。教师读发布目录预览，不在这里出现创建／编辑工具；草稿编排继续从原课程概览进入。
- 文本／PNG讲义采用正式`@openmaic/renderer` SlideCanvas和既有授权PNG gateway，支持讲义前后页。课程前后单元只负责导航，不造播放器、生成引擎或完成率。
- 学生活动单元复用原Learning组件，固定当前活动查询；原Attempt、草稿、截止／重交、附件扫描、版本历史和成绩规则保持。未保存离开沿用现有保护，不另签原生刷新／关闭deferred gate。
- 未知／未发布／被撤回单元显示不可访问并允许返回授权目录；每次进入／刷新重查资格，不因知道unit UUID获权。课程／租户／教学班查询参数仍只作导航选择。
- 自由访问；浏览讲义不计完成或成绩。完整Quiz／PBL／Interactive及可信Runtime证据未因新增入口启用，原隔离不变。

默认仍是 `pnpm trial:zhiban` /3461，不增加产品端口。新owned候选生成新合成数据，原记录不冒称恢复。证据使用默认demo receipt与本次本地旅程记录；只检查新增学习入口及受影响跨功能流程，未运行GitHub或全仓回归。

下一工作包：将storage ownership relation／版本化schema／Native receipt与ACL作为**一个1.2.0升级兼容包**实现并在独立owned环境接完整候选，确认替代路径后再推进原生完整课堂能力。保留现有课程学习入口，不重做重复引擎，不要求每项再多轮复评。

最终本地结果：默认3461保持运行，sourceMatches=true、漂移0；11组owned PG16／受信HTTPS／普通Chromium检查、5/5精确路由测试、3/3官方源码构造探针、定向类型与ESLint通过。新入口缺教学班状态导致作答禁用的问题已补完整鉴权上下文；评分验证等待真实保存／发布响应并确认学生92/100。没有修改Assessment业务或放宽权限。结果绑定上述runtime receipt与compatibility JSON，不是1.2.0全栈、生产或CI签收。
