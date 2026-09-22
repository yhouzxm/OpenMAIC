# ID 与审计策略

Status: FROZEN。

| 选择                     | PostgreSQL / 排序                     | 分布式与迁移                           | API / 日志                           |
| ------------------------ | ------------------------------------- | -------------------------------------- | ------------------------------------ |
| UUIDv4                   | uuid 存储；随机插入、不代表时间       | 可应用端生成，易保留 legacy mapping    | 较长但标准；不应当作权限凭据         |
| UUIDv7                   | uuid 存储；含时间前缀，非严格业务顺序 | 可应用端生成；需审查实现和时钟回拨行为 | 与 UUID 生态兼容，但泄漏近似生成时间 |
| ULID                     | 通常文本或自定义转换；排序需统一编码  | 可分布式生成，增加编码约定             | 较短可读，但与现有 UUID 校验不同     |
| database identity/bigint | 紧凑序列；不是事务提交顺序            | 依赖数据库分配，多来源迁移需映射       | 易枚举；JS API 须字符串避免精度丢失  |

建议 Tenant、User、Membership、Role 统一新 UUIDv7，API 以字符串；IdGeneratorPort 隔离生成实现，不依赖数据库版本自带函数。Phase 1B 先验证已选依赖是否支持 RFC、碰撞处理、时钟回拨；不静默退回 UUIDv4。UUIDv7 时间布局依据 [RFC 9562 §5.7](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7)。它不是鉴权或保密 token，也不能代替 created_at 或业务序号。

Role 即便本期是固定目录 Entity，也分配稳定 Id；系统模板通过固定 roleCode 幂等初始化，不能每次启动重新生成引用 ID。Permission 用稳定 code，展示中文可变而 code 不变。
V1 UUID 保存在唯一(sourceSystem, legacyTenantId, legacyUserId) 映射，不作为 V2 主键。多个历史账户可经人工核验合并到一个 User，多 Membership；不得按 UUID 相等或名字相同自动合并。

日志保留完整 ID + requestId，不打印敏感个人字段；UI可显示短 ID，但授权/API 必须完整精确值。
审计最小规范见 identity-domain.md：created_at/updated_at 服务端 UTC；actor 可人/服务/系统；disabled 为禁止使用但保留引用，deleted/匿名化是另一个需批准的保留策略，不默认全部 soft delete。
