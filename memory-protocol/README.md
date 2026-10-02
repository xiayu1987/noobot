# `@noobot/memory-protocol`

这个包是短期记忆、长期记忆和经验教训文本协议的唯一规范入口，只包含纯逻辑，没有副作用。文件读写、会话读取、模型调用、提示词拼装、时间和 i18n 都留在 Agent 侧（`agent/src/memory`）处理。

## 子路径

| 导出             | 职责                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `./short-memory` | 把对话消息转换为短期记忆记录，排除注入消息和控制消息（判断复用 `@noobot/context-protocol` 的 `isInjectedMessage`）；按时间排序；按会话剔除 |
| `./long-memory`  | 长期记忆字段模型、文档格式和补丁协议                                                                                                       |
| `./experience/*` | 经验补丁的 schema、ID 补丁解析、按字段收集条目、每日及周/月/年输出归一化、模型文本和元数据                                                 |
| `./document`     | 七类记忆文档的协议头、头校验、正文读取、渲染和追加                                                                                         |
| `./text`         | 文本归一化工具                                                                                                                             |

## 文档协议头

每个持久化的记忆文本文件第一行都是唯一的协议头，协议头是文件格式的唯一事实源：

| 文件                             | kind                  | 协议头                                |
| -------------------------------- | --------------------- | ------------------------------------- |
| `long-memory.md`                 | `long_memory`         | `NOOBOT_LONG_MEMORY/1`                |
| `experience/experience-model.md` | `experience_model`    | `NOOBOT_EXPERIENCE_MODEL/1`           |
| `experience/metadata.md`         | `experience_metadata` | `NOOBOT_EXPERIENCE_METADATA/1`        |
| 日小结                           | `daily_summary`       | `NOOBOT_EXPERIENCE_DAILY_SUMMARY/1`   |
| 周小结                           | `weekly_summary`      | `NOOBOT_EXPERIENCE_WEEKLY_SUMMARY/1`  |
| 月小结                           | `monthly_summary`     | `NOOBOT_EXPERIENCE_MONTHLY_SUMMARY/1` |
| 年小结                           | `yearly_summary`      | `NOOBOT_EXPERIENCE_YEARLY_SUMMARY/1`  |

读取方只认当前协议头，不匹配时抛 `MEMORY_DOCUMENT_HEADER_INVALID`，运行时不解析任何旧格式。旧文件的迁移只由 `@noobot/memory-repair` 负责。

## 长期记忆协议

字段模型是本包内置常量 `LONG_MEMORY_MODEL`，它是字段的唯一事实源，不再有模板文件副本：

- `single`：单值，更新时整体覆盖。
- `list:N`：数组，最多 N 项。

长期记忆文档 `long-memory.md` 格式如下：

```
NOOBOT_LONG_MEMORY/1

personal_info.location：上海

interests.hobbies：
1. 跑步
2. 阅读
```

模型补丁每行一条命令。数组的序号一律按补丁执行前的快照计算：

```
UPDATE <single.field>：<value>
DELETE <single.field>
ADD <list.field>：<value>
UPDATE <list.field> <n>：<value>
DELETE <list.field> <n>
```

下面任一情况发生时，整批补丁都被拒绝（`LONG_MEMORY_PATCH_INVALID`），一条都不写入：

- 字段未知；
- 命令形态与字段类型不符；
- 序号越界或重复；
- 结果中出现重复项；
- 数组超过上限；
- 同一个单值字段被修改两次。

长期记忆读取失败时（包括协议头不匹配），Agent 只记录 `memory_injection_failed` 事件和错误日志，按空记忆继续这一轮，不中断对话。

运行测试：`npm run -w @noobot/memory-protocol test`
