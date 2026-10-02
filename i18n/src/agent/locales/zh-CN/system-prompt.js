/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DAILY_EXPERIENCE_PATCH_EXAMPLE =
  'ADD D[1] domain="领域" new=true experiences="经验1 || 经验2" lessons="教训1 || 教训2"';

const WEEKLY_SUMMARY_PATCH_EXAMPLE =
  'ADD W[1] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
const MONTHLY_SUMMARY_PATCH_EXAMPLE =
  'ADD M[1] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"';
const YEARLY_SUMMARY_PATCH_EXAMPLE =
  'ADD Y[1] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"';

const EXPERIENCE_PATCH_PROTOCOLS = Object.freeze({
  daily: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    example: DAILY_EXPERIENCE_PATCH_EXAMPLE,
  }),
  weekly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE W[整数ID] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    example: WEEKLY_SUMMARY_PATCH_EXAMPLE,
  }),
  monthly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE M[整数ID] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"',
    example: MONTHLY_SUMMARY_PATCH_EXAMPLE,
  }),
  yearly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE Y[整数ID] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"',
    example: YEARLY_SUMMARY_PATCH_EXAMPLE,
  }),
});

export const SYSTEM_PROMPT_FORMATTER_I18N = {
  contextPrompt: {
    emptyValueText: "（无）",
    defaultWorkspaceDescription: "用户工作区目录",
    workspaceDirectoryDescriptions: {
      runtime: "运行时数据根目录",
      "runtime/attach": "附件目录；附件操作原样使用 attachmentRef。",
      "runtime/connectors": "连接器运行与历史信息（如 connector-history.json）",
      "runtime/session": "会话与执行记录",
      "runtime/ops_workdir": "脚本执行与中间工作区",
      "runtime/memory": "短期/长期记忆数据",
      skills: "技能目录",
    },
    sections: {
      staticInfo: "系统运行环境",
      pathGuidance: "路径规则",
      dynamicInfo: "当前执行上下文",
      scenario: "当前场景配置（名称、描述、约束）",
      workspaceDirectories: "工作区目录",
      longMemory: "相关长期记忆",
      models: "可用模型与当前模型",
      skills: "技能列表（顶层）",
      services: "可用外部服务端点（serviceName + endpointName + description）",
      mcpServers: "可用 MCP 服务器（name + type + description）",
      connectors: "当前连接器信息",
      attachments: "当前附件元信息",
      executionEvidence: "工具执行事实规则",
    },
    pathGuidance: {
      preferRelative: "通用文件路径使用 workspace 逻辑视角；相对路径固定基于当前用户工作区。",
      sandboxWorkspaceView:
        "当前为 sandbox 模式；workspace 逻辑路径与系统运行环境中列出的额外挂载目标可用于所有文件相关工具。挂载路径受全局配置的只读属性和路径策略统一约束。",
      hostWorkspaceView: "当前为 host 模式；workspace 类工具使用服务工作区视角。",
      taskLocalView:
        "execute_native_script 的 task-local 仅本次调用有效；跨工具原样传递 attachmentRef。",
      superUserHost:
        "可使用 Windows（如 C:\\\\dir）、macOS/Linux（如 /Users、/home）等 host 绝对路径。",
      regularHost:
        "普通用户不能访问规范化后仍属于 host 视角的路径；指向本人工作区的绝对输入会规范化为 workspace 视角。",
      sandboxHostAccess:
        "sandbox 模式不因超级管理员身份自动开放 host 路径或增加挂载；宿主能力仅由固定的受限宿主工具按授权执行。",
      patchRoot: "patch root 通常省略；填写时只能是工作区相对子目录。",
    },
    executionEvidence:
      "只有当前上下文中实际出现的工具调用及对应工具结果，才能报告为已执行。工具绑定列表只表示可用能力；不得把未调用的工具、模型内置能力或不存在于运行时工具集的名称写成已执行。工具审计以运行时 toolTimeline 和 execution events 为权威事实。",
  },
  memoryPrompt: {
    system:
      "你是 Noobot 的记忆处理器。只根据当前请求提供的记忆材料执行指定的整理协议；不得补充未提供的事实，也不得输出协议之外的内容。",
    experiencePatchProtocols: EXPERIENCE_PATCH_PROTOCOLS,
    prompt: (params = {}) => {
      const fieldModel = String(params.fieldModel || "").trim();
      const existingLongMemory = String(params.existingLongMemory || "").trim();
      const patchGrammar = (params.patchGrammar || []).join("\n");
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      return [
        "你是长期记忆整理助手。长期记忆只记录用户的个人信息与偏好事实。",
        `【字段模型】每行：字段 | 类型 (已用/上限) | 说明\n${fieldModel}`,
        "类型规则：single 为单值，UPDATE 整体覆盖旧值，DELETE 清空；list:N 为数组，按序号增删改，任何时候不得超过 N 项。",
        `【补丁协议】每行一条命令，只输出命令，不要 markdown、JSON 或解释；字段与值之间必须使用全角冒号“：”：\n${patchGrammar}`,
        "序号规则：<n> 一律指“已有长期记忆”中该数组当前的序号；同一数组的同一序号只能出现一次；不要对 single 字段使用 ADD 或序号。",
        "容量规则：数组已满时，先用 UPDATE 合并近义项或 DELETE 价值最低的项，再 ADD；不得输出超过上限的结果，否则整批补丁会被拒绝。",
        "取舍规则：只记录稳定、长期、反复出现或用户明确表达的个人信息与偏好；不要记录具体任务、bug、文件、实现步骤或临时项目事实；字段模型之外的信息直接忽略。",
        "更新规则：新信息修正旧信息用 UPDATE，旧信息过期或被否定用 DELETE，近义内容不要重复 ADD；没有需要变更的内容时输出空。",
        `已有长期记忆：\n${existingLongMemory || "（空）"}`,
        `新的短期记忆片段：\n${promptPayload}`,
      ].join("\n\n");
    },
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
      const patchExample =
        String(params.patchExample || "").trim() || DAILY_EXPERIENCE_PATCH_EXAMPLE;
      return [
        "系统指令：",
        "请分析以下短期记忆，归类到已知领域，或在必要时创建新领域。",
        `已知领域：${knownDomainText || "无"}`,
        "",
        "任务要求：",
        "1. 为每个涉及领域提炼 experiences 与 lessons（各 1-3 条，优先质量；无则留空）。",
        "2. 抽象层级：经验教训不要细节化；优先提炼可复用的方法、偏好、判断标准、协作方式、风险信号和决策模式，不要记录具体 bug、具体文件、具体实现步骤、一次性 UI 细节或临时项目事实。",
        "3. 取舍规则：只有当细节能抽象成后续可复用的经验/教训时才保留；否则忽略。",
        "4. 领域应保持高层抽象，避免过细碎（如：编程、项目管理、测试、产品）。",
        "5. domain_name 保持简洁，尽量复用已知领域。",
        "6. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `7. 协议：${patchProtocol}`,
        "8. 示例：",
        patchExample,
        "",
        "输入：",
        shortMemoryItems,
      ].join("\n");
    },
    weeklySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownCategoryText = String(params.knownCategoryText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE W[整数ID] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
      const patchExample = String(params.patchExample || "").trim() || WEEKLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `请对领域 [${domainName}] 最近 7 天的记录进行结构化周总结。`,
        `已知大类列表：${knownCategoryText || "无"}`,
        "",
        "任务要求：",
        "1. 优先归入已知大类；若完全不匹配可新增大类。",
        "2. 分类归组：按语义相关性拆分，并尽量合并近义项，避免碎片化。",
        "3. 归纳提炼：去重合并后，提炼每类最关键的 experiences 与 lessons（各 1-3 条）。",
        "4. 抽象层级：经验教训应是高层、可迁移、可复用的总结；不要堆砌具体任务、具体 bug、具体文件、具体实现步骤、一次性 UI 细节或临时项目事实。",
        "5. 取舍规则：优先保留反复出现或能反映稳定工作方式/决策模式的经验教训；孤立细节应合并、抽象或丢弃。",
        "6. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `7. 协议：${patchProtocol}`,
        "8. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    monthlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE M[整数ID] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"';
      const patchExample =
        String(params.patchExample || "").trim() || MONTHLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `分析以下【${domainName}】领域过去一个月的总结，目标是模式识别。`,
        `已知大类与小类结构：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 将规律归入已知大类和小类；若有全新发现，可输出新的小类名称。",
        "2. 为每个小类提炼本月核心规律（Patterns）和改进方法论（Methodologies）。",
        "3. 抽象层级：规律和方法论必须从细节上升到可复用模式；不要记录具体任务、具体 bug、具体文件、具体实现步骤、一次性 UI 细节或临时项目事实。",
        "4. 取舍规则：只保留跨多条记录成立、能指导后续行动的模式；孤立细节应忽略。",
        "5. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `6. 协议：${patchProtocol}`,
        "7. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    yearlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE Y[整数ID] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"';
      const patchExample = String(params.patchExample || "").trim() || YEARLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `站在高维视角审视【${domainName}】领域过去一年的全部复盘。`,
        `已知分类树：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 忽略短期波动，提炼跨时间的底层原则（Principles）与年度战略反思。",
        "2. 抽象层级：年度经验教训必须是高层原则、长期倾向和战略反思；不要记录具体任务、具体 bug、具体文件、具体实现步骤、一次性 UI 细节或临时项目事实。",
        "3. 必须将输出落实到具体的大类和小类。",
        "4. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `5. 协议：${patchProtocol}`,
        "6. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
  },
};
