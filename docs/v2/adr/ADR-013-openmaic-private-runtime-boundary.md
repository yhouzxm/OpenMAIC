# ADR-013 — OpenMAIC Private Runtime Boundary

## Status

ACCEPTED FOR ARCHITECTURE
IMPLEMENTATION DEFERRED

## Context

Phase1B-0A审计当前原生入口，mapping不足以阻止浏览器原始资源旁路。Phase1B-0R提出目标Model B，而不是将0A风险改判为安全。固定OpenMAIC基线4d2e2bab82374ed45b95964a1f2ed03362666e1c；ADR012仍PROPOSED。

## Decision

人工架构评审接受：只公开Zhiban页面、用例API及每次授权的resource gateway。OpenMAIC持久化、运行态、agent、raw bytes、原生actions和Web pages不公开；目标host不装载原生routes。使用公开renderer/editor客户端包不等于开放服务端入口。

“Private OpenMAIC REQUIRED”指能力/字节/存储边界；不强制独立原生Web进程。若将来采用私有服务，仍须内部身份、限定调用与网络隔离；signed URL不作为租户授权替代。短时launch handle也必须绑定资源/动作/上下文、可失效，不携带后端凭据。

任何启用、例外、网络配置需要后续独立批准与0B验证。当前源码route没有被关闭，本ADR不声称部署已隔离。

## Alternatives

A全量原生Web反代：保留cookie/principal/派生URL问题，不推荐作为基础。
C私有服务混合：未来重任务可评估，现阶段无必须理由。
D本地改auth core：维护成本高且违反保护边界，不采用。

## Consequences

公开面缩小，但智伴必须承担Application授权、mapping生命周期、资源字节安全、缓存和观测。私网不能解决iframe恶意消息或业务横向访问。未来0B须验证原生路由缺席及私有存储不可达；不得用文档配置代替测量。

不改变Phase1A身份聚合和OpenMAIC数据所有权。Identity Schema Gate按本次人工批准的phase1b-gate-map.md重新定义；不是由本ADR自动解锁。

## ADR关系与接受范围

ADR-013回答WHERE OpenMAIC capability lives；ADR-014回答HOW Zhiban prefers to consume capability；ADR-012回答HOW specific identity/authorization safely bridges individual resources。013/014可以先接受，012仍PROPOSED。network/private boundary只是安全边界之一，不能取代业务授权。

OpenMAIC角色正式为PRIVATE CAPABILITY RUNTIME。本次仅接受架构方向，不是production deployment accepted，不声称当前网络隔离完成或全部capability已验证。具体资源桥接仍需capability-specific 1B-0B与ADR-012明确人工接受。
