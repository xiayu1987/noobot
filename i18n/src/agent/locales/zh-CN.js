/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TOOL_SCHEMA_FLAT_GENERATED, TOOL_SCHEMA_BY_TOOL } from "./zh-CN/tool-schema.js";
import { BACKEND_COMMON_ZH_CN } from "../../shared/locales/backend-common-zh-CN.js";

export { TOOL_SCHEMA_BY_TOOL };

export default {
  ...TOOL_SCHEMA_FLAT_GENERATED,
  ...BACKEND_COMMON_ZH_CN,
  "agent.legacyPluginRelayPrefix": "[来自harness外部模型输出/{purpose}]",
  "tools.script.commandTooLong": "脚本内容过长，请分批执行或拆分脚本/文本后重试",
  "tools.file.writeContentTooLong": "文件内容过长，请分批写入",
  "tools.file.readContentTooLong": "文件内容过长，请分批读取",
  "tools.file.readDescriptionWithLineNumbers": "读取文本文件内容（默认带行号）。",
  "tools.file.workspaceRelativePathRule": "相对路径统一基于当前用户工作区根目录。",
  "tools.file.symbolicLinkRule": "当前路径策略不允许文件工具使用符号链接。",
  "tools.file.readStartLineField": "起始行（1-based）。",
  "tools.file.readEndLineField": "结束行（1-based）。",
  "tools.file.readIncludeLineNumbersField": "content 是否带行号。",
  "tools.file.readMaxLinesField": "最大返回行数。",
  "tools.file.readLineRangeOutOfBounds": (params = {}) =>
    `读取行范围无效：请求 ${Number(params.startLine || 0)}-${Number(params.endLine || 0)}，文件共 ${Number(params.totalLines || 0)} 行`,
  "tools.file.pathErrorRequired": (params = {}) => `必须提供 ${String(params.field || "filePath")}`,
  "tools.file.pathErrorHostAbsoluteNotAllowed": "当前身份不允许访问宿主绝对路径。",
  "tools.file.pathErrorSandboxNotAllowed": "当前执行视角不接受沙箱绝对路径。",
  "tools.file.pathErrorSandboxNotMapped": "该沙箱路径未映射到共享文件根目录。",
  "tools.file.pathErrorVirtualRelativeAmbiguous": (params = {}) => {
    const relative = String(params.suggestedPath || "");
    const sandbox = String(params.suggestedSandboxPath || "");
    return sandbox
      ? `路径含有歧义。工作区相对路径请使用 ${relative}，沙箱绝对路径请使用 ${sandbox}。`
      : `路径含有歧义。工作区相对路径请使用 ${relative}。`;
  },
  "tools.file.pathErrorWorkspaceOutOfScope": "工作区相对路径超出了工作区根目录。",
  "tools.file.writeAlreadyExists": "文件已存在；如需替换，请将 overwrite 设置为 true。",
  "tools.file.readRiskLevelField":
    "操作风险等级：low、medium、high 或 critical。读取可能涉及隐私信息、密码、令牌、凭证或密钥时必须标记为 critical。",
  "tools.file.writeOverwriteField": "文件存在时是否覆盖。",
  "tools.file.writeRiskLevelField":
    "操作风险等级：low、medium、high 或 critical。按与脚本执行相同的影响和破坏性标准分级。",
  "tools.risk.criticalConfirmation": (params = {}) =>
    [
      "即将执行需要安全确认的工具操作，请明确确认。",
      `工具：${String(params.toolName || "")}`,
      `操作：${String(params.operation || "")}`,
      `风险等级：${String(params.riskLevel || "")}`,
      params.target ? `目标：${String(params.target)}` : "",
      params.reason ? `风险原因：${String(params.reason)}` : "",
      "是否确认继续？",
    ]
      .filter(Boolean)
      .join("\n"),
  "tools.risk.criticalConfirmationUnavailable":
    "此风险等级的操作需要用户确认，但用户交互通道不可用。",
  "tools.risk.criticalCancelled": "风险操作未获用户确认，已取消。",
  "scenarios.full.name": "全能",
  "scenarios.full.description": "通用情景：不限制工具和上下文，按任务需要自主选择能力。",
  "scenarios.programming.name": "编程",
  "scenarios.programming.description":
    "编程情景：先 search/read_file 确认真实内容，再用 patch_file 修改；优先精确上下文补丁，避免手算 unified diff 行数；补丁失败后重新读取再改，必要时用 write_file。",
  "scenarios.text.name": "文本",
  "scenarios.text.description": "文本情景：适合写作、改写、摘要、翻译与内容整理。",
};
