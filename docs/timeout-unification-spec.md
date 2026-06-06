# Noobot 时间参数统一规范（Timeout/TTL/Interval）

> 版本：v1（草案）  
> 日期：2026-06-06  
> 目标：统一时间参数的**语义、命名、默认值与迁移路径**，减少重复配置与行为不一致。

---

## 1. 统一原则

1. **一个语义，一个主键**：同类时间语义只保留 1 个 canonical 字段。
2. **单位统一毫秒**：所有运行时字段使用 `ms`，仅 UI 展示时做单位换算。
3. **命名可读且稳定**：
   - 超时：`xxxTimeoutMs`
   - 间隔：`xxxIntervalMs`
   - 有效期：`xxxTtlMs`
   - 保留期：`xxxRetentionMs`
   - 收尾宽限：`xxxGraceMs`
4. **渐进迁移**：兼容读旧字段，统一写新字段，最后移除旧字段。

---

## 2. 语义分类（Canonical）

| 分类 | Canonical 字段模式 | 含义 |
|---|---|---|
| Request Timeout | `requestTimeoutMs` | 单次请求/调用最大耗时 |
| Interaction Timeout | `interactionTimeoutMs` | 等待用户输入/确认的时限 |
| Run Timeout | `runTimeoutMs` | 一次 run/session 的总时限 |
| Idle Timeout | `idleTimeoutMs` | 空闲回收时限 |
| TTL | `xxxTtlMs` | 对象有效期（key、token、缓存） |
| Retention | `xxxRetentionMs` | 过期后/历史数据保留周期 |
| Poll Interval | `pollIntervalMs` | 轮询周期 |
| Retry Interval | `retryIntervalMs` | 重试间隔 |
| Grace | `xxxGraceMs` | 停止/回收/收尾宽限 |
| Debounce/Throttle | `debounceMs` / `throttleMs` | 前端交互节流防抖 |

---

## 3. 推荐默认值矩阵（基线）

| 分类 | 推荐默认值 | 说明 |
|---|---:|---|
| Request Timeout | 30000 | 网络/连接器常规请求 |
| Interaction Timeout | 600000 | 用户交互等待（10 分钟） |
| Run Timeout (default) | 18000000 | run 默认 5 小时 |
| Run Timeout (min) | 10000 | run 最小保护 |
| Run Timeout (max) | 43200000 | run 最大 12 小时 |
| Idle Timeout | 10800000 | 3 小时空闲回收 |
| API Key TTL | 86400000 | 24 小时 |
| RequestId TTL | 660000 | 11 分钟 |
| Poll Interval | 1000~5000 | 快轮询 1s，常规 5s |
| Grace Timeout | 300~5000 | stop/flush 收尾窗口 |

> 注：业务可覆盖默认值，但不得越过全局上下限（min/max clamp）。

---

## 4. 现有字段 -> 目标字段映射（首批）

| 现有字段 | 目标字段（canonical） | 备注 |
|---|---|---|
| `run_timeout_ms` | `runTimeoutMs` | 已存在双写/兼容读，继续收敛 |
| `wait_timeout_ms` | `waitTimeoutMs` | 建议细分为 `requestTimeoutMs` 或 `interactionTimeoutMs` |
| `script_timeout_ms` | `scriptTimeoutMs` | 保留为专用执行器超时 |
| `docker_lock_wait_timeout_ms` | `dockerLockWaitTimeoutMs` | 保留 |
| `start_timeout_ms` | `startTimeoutMs` | 保留 |
| `idle_timeout_ms` | `idleTimeoutMs` | 保留 |
| `cleanup_interval_ms` | `cleanupIntervalMs` | 保留 |
| `shutdown_grace_ms` | `shutdownGraceMs` | 保留 |
| `apiKeyTtlMs` | `apiKeyTtlMs` | 已 canonical |
| `requestIdTtlMs` | `requestIdTtlMs` | 已 canonical |
| `channelRetentionMs` | `channelRetentionMs` | 已 canonical |
| `poll_interval_ms` | `pollIntervalMs` | 建议统一处理层转化 |

### 4.1 当前落地状态（2026-06-06）

| 项 | 状态 | 说明 |
|---|---|---|
| 统一归一化工具 `time-config-normalizer` | ✅ 已完成 | 已提供 `normalizeTimeMs`、`resolveTimeMs`。 |
| run timeout 归一化（service/ws） | ✅ 已完成 | `chat-websocket-server.js` 已接入 clamp/fallback。 |
| openvscode 时间参数归一化 | ✅ 已完成 | `openvscode-service.js` 已统一 parse/normalize。 |
| user override 的 `runTimeoutMs` 校验 | ✅ 已完成 | `user-override-policy.js` 已改为统一归一化。 |
| connector timeout 归一化 | ✅ 已完成 | `channel-store`、DB/SSH connector 链路已接入。 |
| script timeout / docker lock wait 归一化 | ✅ 已完成 | `script-tool.js` 已接入统一工具。 |
| agent-collab wait/poll 归一化 | ✅ 已完成 | `agent-collab-tool` 与 `tool-wait-async-result` 已接入。 |
| browser simulate / web2data 归一化 | ✅ 已完成 | `browser-simulate.js`、`web2data-tool.js` 已接入。 |
| web2img runtime 默认值统一入口 | ✅ 已完成 | `normalizeWeb2ImgRuntimeDefaults` 已落地并补测。 |
| auth API key TTL 归一化 | ✅ 已完成 | `auth-service.js` 已接入统一归一化。 |
| agent-proxy 时间配置归一化 | ✅ 已完成 | `agent-proxy/src/config.js` 已统一 `envTimeMs`。 |
| 旧字段读到时 deprecation warn | ✅ 已完成 | `resolveTimeMs` 已支持 legacy 告警；已覆盖 DB/SSH、chat run、ws runTimeout、openvscode、memory-postprocess、script docker lock timeout。 |
| CI 守卫：禁止直接读取 legacy 时间键 | ✅ 已完成 | 新增 `scripts/check-legacy-time-keys.mjs`，并提供 `npm run check:legacy-time-keys`。 |
| 配置示例与配置文档 canonical 化 | ✅ 已完成 | `global/user-template/workspace` 配置样例及 `CONFIGURATION*.md` 已改为 camelCase 时间字段。 |
| Phase 3 预备（legacy 移除清单） | ✅ 已完成 | 已新增 `docs/timeout-legacy-removal-checklist.md`。 |
| snake_case 时间字段移除 | ⏸ 暂不执行 | 配置约定以 snake_case 为默认，运行时保留 snake_case -> canonical 归一化。 |

---

## 5. 配置层级与优先级

统一优先级（高 -> 低）：

1. Runtime 显式参数（单次调用传参）
2. 用户工作区配置（workspace user config）
3. 全局配置（global config）
4. 系统默认值（constants）

所有时间参数读取必须走：
- normalize（类型转换）
- clamp（最小/最大边界）
- fallback（默认值）

---

## 6. 迁移计划（3 阶段）

### Phase 1（兼容期）
- 读取：新旧字段都支持（新字段优先）
- 写入：只写新字段
- 日志：当读取到旧字段时打印 deprecation warn

### Phase 2（告警期）
- CI/启动时输出旧字段清单
- 文档/配置示例仅保留新字段
- 管理后台显示“旧字段将移除”提示

### Phase 3（收口期）
- 移除旧字段读取逻辑
- 删除 snake_case 时间字段及相关测试
- 发布变更说明（含迁移脚本）

---

## 7. 最小实现清单（建议）

1. 新增统一工具：`time-config-normalizer`（或在现有 config normalizer 扩展）
2. 所有时间读取走统一函数：`resolveTimeoutMs/resolveTtlMs/resolveIntervalMs`
3. 为核心路径补回归测试：
   - run timeout clamp（min/max）
   - interaction timeout
   - api key ttl
   - connector request timeout
4. 将 `docs/timeout-inventory.md` 关联到本规范。

---

## 8. 验收标准

- [x] 时间字段命名统一到 canonical 风格（运行时内部）
- [x] 关键路径（run、interaction、proxy、connector、script）支持 clamp
- [x] 无新增“运行时代码直接读取”snake_case 时间字段（配置层按约定保留 snake_case）
- [x] inventory 文档与规范文档可互相追溯



---

## 9. 关联文档

- 现状盘点：[`docs/timeout-inventory.md`](./timeout-inventory.md)
- 统一时建议以 inventory 为迁移输入清单。
- Phase 3 预备清单：[`docs/timeout-legacy-removal-checklist.md`](./timeout-legacy-removal-checklist.md)
