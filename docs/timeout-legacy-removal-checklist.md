# Timeout Legacy 字段移除清单（Phase 3 预备）

> 日期：2026-06-06  
> 目标：在不破坏兼容性的前提下，准备移除 snake_case 时间字段读取逻辑。

## 1) 当前状态（运行时代码）

- 配置层默认仍使用 snake_case（项目约定）。  
- 运行时代码通过归一化层统一到 canonical 字段处理。  
- `npm run check:legacy-time-keys` 用于防止“业务代码直接读取 legacy 键”。

## 2) 特别说明

- connector 协议层可存在下划线历史字段；业务侧读取统一走归一化函数。

## 3) 移除顺序（建议）

1. **先移除文档/模板中的 snake_case（已完成）**  
2. **保留兼容读 + deprecation warn（已完成）**  
3. **观察期（建议 1~2 个版本）**  
   - 统计日志中 legacy 命中次数
   - 若命中接近 0，进入下一步
4. **是否移除业务层 legacyKeys**（按配置规范决策；当前不建议）  
5. **是否移除 key-normalizer 的 snake_case 映射**（当前不建议）

## 4) 回滚方案

若移除后出现用户配置不兼容：

1. 先回滚到“兼容读”版本；  
2. 通过日志定位命中的 legacy 字段；  
3. 提供一次性迁移脚本（JSON 键重命名）和升级提示；  
4. 重新进入观察期。

## 5) 验收条件（Phase 3 Ready）

- [ ] 线上（或目标环境）legacy 命中率可接受（以当前守卫扫描为准）  
- [ ] 已提供迁移说明/脚本  
- [x] CI 守卫稳定运行（`npm run check:legacy-time-keys`）  
- [ ] connector 协议字段改名是否必要已评估并确认

## 6) Legacy 命中观测方案（建议）

1. **日志观测**  
   - 关键字：`[time-config][deprecated_legacy_time_key]`  
   - 目标：确认是否仍存在旧键被触发。

2. **运行时计数观测（内存态）**  
   - 来源：`getLegacyTimeKeyUsageStats()`（`agent/src/system-core/config/core/time-config-normalizer.js`）  
   - 统计维度：`sourceTag + key + legacyKey + count`  
   - 用途：评估观察期内旧键命中分布与趋势。

3. **移除阈值建议**  
   - 连续 1~2 个发布周期，核心路径（run/ws/openvscode/connector/script）命中为 0 或接近 0，再推进移除。
