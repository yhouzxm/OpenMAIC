# Target Feature Disable Matrix

Status: TARGET BOUNDARY ACCEPTED FOR ARCHITECTURE；“DISABLED_IN_V2”是目标策略，不是本轮已操作。具体能力覆盖与启用待独立review/0B。没有更改任何route/配置；当前Gate见phase1b-gate-map.md。
计数单位是本表F01–F20，不与0A20个surface数量或133入口数量混用：10 DISABLED_IN_V2、5 DEFERRED、5 REQUIRED。

| ID | Feature | Target | 恢复/启用条件 |
|---|---|---|---|
| F01 | native agent API/tools | DISABLED_IN_V2 | 新产品需求、稳定agent能力契约、工具最小权限与撤权诊断全部批准 |
| F02 | native Embedded HTTP Runtime/dev auth | DISABLED_IN_V2 | 本目标不恢复；公开RuntimeStore替代候选通过Gate；不得启用insecure auth |
| F03 | native OpenMAIC browser pages | DISABLED_IN_V2 | 默认不恢复；任何例外必须独立授权审查，不能直接透传原生页面 |
| F04 | native editor mutation routes | DISABLED_IN_V2 | 使用F19智伴host，不恢复原路由 |
| F05 | raw asset/media endpoints | DISABLED_IN_V2 | 使用F16资源gateway，字节无公开直链 |
| F06 | native persistence routes | DISABLED_IN_V2 | 使用F16/F17公开包；不开放通用数据库式代理 |
| F07 | native public/published access grant | DISABLED_IN_V2 | 不恢复；业务publication + Enrollment/Policy |
| F08 | native Server Actions | DISABLED_IN_V2 | 不导入；明确智伴Use Case替代 |
| F09 | native agent/stage streams | DISABLED_IN_V2 | 不透传runner；受控host流另审 |
| F10 | internal jobs/fetch/provider routes | DISABLED_IN_V2 | 无浏览器入口、不复制内部bootstrap；服务端provider由AIServicePort配置 |
| F11 | full Classroom/Playback/Quiz/PBL engine | DEFERRED | U01公开宿主契约 + 课堂运行态/资源/撤权隔离测试；保留后续必需性 |
| F12 | Interactive/iframe/VirtualLab execution | DEFERRED | U02 + sandbox/消息/资源诊断；不得先运行不可信HTML |
| F13 | server-side Node PPTX/materials pipeline | DEFERRED | 正式支持的Node契约或独立批准隔离解析服务；不能依赖内部DOM/XHR shim |
| F14 | download/render export service | DEFERRED | 真实需求、私有服务身份、job所有权、下载授权及独立兼容性测试 |
| F15 | direct signed/generated URL delivery | DEFERRED | 证明tenant/resource/action/expiry与撤权约束；若仍是可转发bearer，不作为私有资源授权 |
| F16 | Zhiban gateway + resource mapping/AssetStore | REQUIRED | 0B隔离验证、Application安全策略、ADR与实施Gate通过后才能实现 |
| F17 | package DocumentStore/RuntimeStore | REQUIRED | 可信server上下文、id级权限复核、PG事务与契约验证；不修改OpenMAIC schema |
| F18 | Zhiban slide preview using renderer | REQUIRED | 必要基础能力；所有资源URL策略与只读数据授权通过，不宣称完整Playback |
| F19 | package-host teacher slide editor | REQUIRED | 后续备课启用前；服务端修订校验/权限/资产picker；不信任UI隐藏 |
| F20 | controlled teacher generation | REQUIRED | 后续备课启用前；AICallFn服务端限权、预算、输出资产与取消策略 |

浏览器PPTX parser是可选能力而非额外计数行；F13只指Node/material流水线。可选browser parser独立启用前需要D10诊断，不因npm导出就默认开启。

不得恢复关闭项来“让测试通过”。关闭项需要在目标发布产物中证明不存在/不可达；当前仓库源码保留它们，本轮未构建目标host，也未验证路由封闭。以后若直接运行当前根Next应用，不能仅凭本表视为Model B。
