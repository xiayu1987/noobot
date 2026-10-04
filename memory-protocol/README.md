# `@noobot/memory-protocol`

这个包是短期记忆、长期记忆和经验教训文本协议的唯一规范入口，只包含纯逻辑，没有副作用。文件读写、会话读取、模型调用、提示词拼装、时间和 i18n 都留在 Agent 侧（`agent/src/memory`）处理。

## 子路径

| 导出             | 职责                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `./short-memory` | 把对话消息转换为短期记忆记录，排除注入消息和控制消息（判断复用 `@noobot/context-protocol` 的 `isInjectedMessage`）；按时间排序；按会话剔除 |
| `./long-memory`  | 长期记忆字段模型、文档格式和补丁协议                                                                                                       |
| `./experience/*` | 经验补丁的 schema、ID 补丁解析、按字段收集条目、每日及周/月/年输出归一化、模型文本和元数据                                                 |
| `./document`     | 七类记忆文档的协议头、头校验、正文读取、渲染和追加                                                                                         |
| `./defaults`     | 记忆文档的默认内容（空短期记忆、只有协议头的长期记忆、默认经验模型），是创建和重置的唯一来源                                               |
| `./text`         | 文本归一化工具                                                                                                                             |

## 文档协议头

每个持久化的记忆文本文件第一行都是唯一的协议头，协议头是文件格式的唯一事实源：

| 文件（相对 `memory/`）   | kind                  | 协议头                                |
| ------------------------ | --------------------- | ------------------------------------- |
| `long-memory.md`         | `long_memory`         | `NOOBOT_LONG_MEMORY/1`                |
| `long-memory-model.md`   | `long_memory_model`   | `NOOBOT_LONG_MEMORY_MODEL/2`          |
| `experience-model.md`    | `experience_model`    | `NOOBOT_EXPERIENCE_MODEL/1`           |
| `experience-fields.md`   | `experience_fields`   | `NOOBOT_EXPERIENCE_FIELDS/1`          |
| `experience/metadata.md` | `experience_metadata` | `NOOBOT_EXPERIENCE_METADATA/1`        |
| 日小结                   | `daily_summary`       | `NOOBOT_EXPERIENCE_DAILY_SUMMARY/1`   |
| 周小结                   | `weekly_summary`      | `NOOBOT_EXPERIENCE_WEEKLY_SUMMARY/1`  |
| 月小结                   | `monthly_summary`     | `NOOBOT_EXPERIENCE_MONTHLY_SUMMARY/1` |
| 年小结                   | `yearly_summary`      | `NOOBOT_EXPERIENCE_YEARLY_SUMMARY/1`  |

读取方只认当前协议头，不匹配时抛 `MEMORY_DOCUMENT_HEADER_INVALID`，运行时不解析任何旧格式。旧文件的迁移只由 `@noobot/memory-repair` 负责。

## 长期记忆协议

内置常量 `LONG_MEMORY_MODEL` 是字段的唯一代码定义，只用于首次生成和兜底。工作区的 `long-memory-model.md` 由它渲染，用户可以增删改字段，运行时只读这份文件；解析失败时回落内置字段：

```
NOOBOT_LONG_MEMORY_MODEL/2

personal_info.location | single | 城市
work.tech_stack | list:8 | 常用技术栈
```

字段协议的版本号表示“内置字段集合”的版本。`LONG_MEMORY_MODEL_FIELDS_SINCE` 记录每个版本新引入的内置字段（`/2` 新增 6 个 `work.*` 字段）。旧版本文件由 `@noobot/memory-repair` 升级：保留原文、注释和用户的增删改，只追加文件版本之后引入、且文件中没有的字段；文件版本内已有、被用户删掉的字段不补回。

值文档中协议已删除的字段作为孤儿保留，写回时原样写出，不会因字段变更而重置。类型：

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

## 经验教训字段协议

结构字段（domain、category、subcategory、new）和 ID 前缀固定在 `experience/schema.js`。内容字段由 `experience/fields.js` 的 `BUILTIN_EXPERIENCE_FIELDS` 渲染为 `experience-fields.md`，用户可按阶段增删改：

```
NOOBOT_EXPERIENCE_FIELDS/1

STAGE: daily
- experiences | 经验 | 做成了什么、有效做法
- tools | 工具 | 用到的关键工具
STAGE: weekly
...
```

- 每个阶段（daily/weekly/monthly/yearly）至少一个字段；key 为小写字母、数字和下划线，不能占用结构字段名。
- 字段只有一个名字：协议 key 即补丁 key、内部字段名和落盘标题的来源，不提供别名。结构字段（`domain`、`new`、`category`、`subcategory`）由 `experience/structure.js` 唯一定义。
- 补丁协议、示例和字段说明都由 `renderExperiencePatchProtocol(stage, { fields, labels })` 生成，i18n 只提供占位词（`experiencePatchLabels`）。

长期记忆读取失败时（包括协议头不匹配），Agent 只记录 `memory_injection_failed` 事件和错误日志，按空记忆继续这一轮，不中断对话。

运行测试：`npm run -w @noobot/memory-protocol test`
