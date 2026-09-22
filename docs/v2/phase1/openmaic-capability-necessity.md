# OpenMAIC Capability Necessity — Phase 1B-0R

Status: TARGET ARCHITECTURE ACCEPTED / individual capability implementation deferred。当前Gate见phase1b-gate-map.md；本表不代表能力已动态验证。
HEAD: 700a7673becf0518bc6f8b2861229ee985c5d063.
OpenMAIC source baseline: 4d2e2bab82374ed45b95964a1f2ed03362666e1c.

本表覆盖0A的全部20个surface分组，编号保持一致，不覆盖历史133个入口的结论。CORE_REQUIRED表示目标底座必要，不表示Phase 1现在就实现。REQUIRED_LATER表示后续能力有真实需求但发布前仍须独立Gate；DEFERRED不是永久取消需求。本次人工接受目标边界与Identity解耦；每项能力实现/开放仍需独立批准。

| 0A surface | Necessity | 目标能力、业务理由与不采用的入口 |
|---|---|---|
| S01 Classroom | REQUIRED_LATER | Course/Teacher Portal/Student Portal需要课堂编排；使用智伴页面，不直接开放原生classroom。完整课堂执行仍缺公开host契约。 |
| S02 Stage / Scene / Document | CORE_REQUIRED | Course活动内容的opaque引用；DocumentStore + DSL候选，所有读写经过智伴mapping与权限。Stage不是Tenant或Course。 |
| S03 Playback | REQUIRED_LATER | Learning Runtime需要重放；SlideCanvas足够显示单张slide，不足以实现语音、动作时序、多Scene、Quiz/PBL执行。禁止把静态预览称完整Playback。 |
| S04 Generation | REQUIRED_LATER | 教师受控备课用例；generation package + server AICallFn，不开放通用生成route。 |
| S05 Edit / Editor | REQUIRED_LATER | 教师编辑slide；editor/core、react、ui可独立host。课程编排、非slide编辑不在该包保证内。 |
| S06 Import / Materials | OPTIONAL | PPTX导入提升备课效率，非Identity/Course基础前提；浏览器parser候选，服务端Node导入延期。完整materials流水线不接入。 |
| S07 Asset | CORE_REQUIRED | 内容与证据资源必须受控访问；AssetStore +智伴resource gateway。取消共享部署principal与直链暴露。 |
| S08 Media / Proxy | CORE_REQUIRED | 受保护图片/音视频；资源gateway覆盖字节、range、poster、背景等。原生媒体proxy不作为公开接口。 |
| S09 Download / Render | OPTIONAL | 导出便利能力；先延期。私有render-service是将来C模型候选，不是采用C的充分理由。 |
| S10 Embedded HTTP Runtime | CORE_REQUIRED | 必要的是学习运行态持久化，不是原生HTTP入口。原生入口DISABLED，公开RuntimeStore + PgRuntimeStore为PACKAGE_HOST_CANDIDATE。 |
| S11 Quiz / PBL / Whiteboard Runtime | REQUIRED_LATER | Assessment/Learning需要活动执行；DSL数据和generation纯kernel不等于完整执行引擎。自建领域Assessment不是复制OpenMAIC内部runtime。 |
| S12 Interactive Runtime / iframe | REQUIRED_LATER | VirtualLab与Interactive活动可能需要；隔离消息/资源/运行态契约未解决前不运行任意HTML。 |
| S13 Agent / Tools | DISABLED | Phase 1无需通用agent与任意工具；受控AIServicePort不等同原生Agent API。 |
| S14 Agent / Stage Streaming | DEFERRED | 原生agent流不接入；将来受控进度流单独设计撤权、取消、重连，非透传runner。 |
| S15 Server Actions | DISABLED | 不导入原生action；智伴Application用例承担操作，不以action隐蔽性代替授权。 |
| S16 Direct Browser Pages | DISABLED | 只开放智伴Teacher/Student Portal；原生主页、课堂、编辑页面均非目标产品入口。 |
| S17 Public / Published | DISABLED | 禁用其作为公开授权语义；智伴publication + enrollment + policy决定可读，OpenMAIC状态最多是渲染状态。 |
| S18 Signed / Generated URLs | DEFERRED | 暂不允许绕过gateway的bearer交付。生成资源需入受控资产、受限抓取；短TTL不等于授权。 |
| S19 Internal Server / Components / Fetch | DISABLED | 不依赖内部jobs、storage bootstrap、action和跨route fetch；用公开package替代所需纯能力。 |
| S20 Provider / Platform Support | REQUIRED_LATER | AIServicePort的服务端provider配置、预算、错误翻译必要；原生provider配置route不公开，密钥不出服务端。 |

计数：CORE_REQUIRED 4；REQUIRED_LATER 7；OPTIONAL 2；DEFERRED 2；DISABLED 5；合计20。

## 阶段边界

Identity及Repository Ports不需要启用上述原生入口。Identity schema按人工重定Gate，在1B-1/2及其独立review后允许；不含OpenMAIC mapping。Course及其他领域schema不由此解锁。Learning/Assessment的可信成绩不从浏览器自报runtime直接生成。VirtualLab尚无已批准迁移或执行范围。本表不授权迁移25 Scene、V1画像、Assessment或Virtual Lab。

本轮提出“基础slide内容路径先验证、完整课堂与互动路径后验证”的范围拆分，不擅自宣告后者不再必需。完整产品能力仍有2项P1上游契约需求，见backlog；若人工要求首版即包含完整课堂/Interactive，则对应需求升级为该发布的P0。

证据：0A主报告S01–S20；本轮architecture-review的package证据P01–P06。目标关闭项的可操作判据见feature-disable-matrix。
