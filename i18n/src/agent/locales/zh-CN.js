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
  "tools.input.tooLong": "工具输入内容过长，已保存为附件",
  "tools.patch.patchContentTooLong": "补丁内容过长，请分批应用或拆分 patch 后重试",
  "tools.result.toolResultOverflow": ({ measuredLength }) =>
    `工具返回内容过长(${measuredLength}字符)，已保存为附件，请按返回的 transfer 信息分批读取。`,
  "tools.result.readFileSourceReferenceOverflow":
    "{{tool:read_file}} 结果过长，已保留源文件引用，请按源文件地址和行范围继续读取。",
  "tools.file.workspaceRelativePathRule": "相对路径统一基于当前用户工作区根目录。",
  "tools.file.symbolicLinkRule": "当前路径策略不允许文件工具使用符号链接。",
  "tools.file.readLineRangeOutOfBounds": ({ startLine, endLine, totalLines }) =>
    `读取行范围无效：请求 ${startLine}-${endLine ?? "末尾"}，文件共 ${totalLines} 行`,
  "tools.input.fieldRequired": ({ field }) => `必须提供 ${field}`,
  "tools.input.unknownFields": ({ keys }) => `不支持的字段：${keys}`,
  "tools.input.invalidOption": ({ field, values }) => `${field} 只能是：${values}`,
  "tools.input.invalidType": ({ field, expected }) => `${field} 类型应为 ${expected}`,
  "tools.input.invalidValue": ({ field, code }) => `${field} 的值不符合约束（${code}）`,
  "tools.file.pathErrorHostAbsoluteNotAllowed": "当前身份不允许访问宿主绝对路径。",
  "tools.file.pathErrorSandboxNotAllowed": "当前执行视角不接受沙箱绝对路径。",
  "tools.file.pathErrorSandboxNotMapped": "该沙箱路径未映射到共享文件根目录。",
  "tools.file.pathErrorVirtualRelativeAmbiguous": ({ suggestedPath, suggestedSandboxPath }) =>
    suggestedSandboxPath
      ? `路径含有歧义。工作区相对路径请使用 ${suggestedPath}，沙箱绝对路径请使用 ${suggestedSandboxPath}。`
      : `路径含有歧义。工作区相对路径请使用 ${suggestedPath}。`,
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
    "编程情景：先定位并读取真实内容，再依 {{tool:patch_file}} 协议修改；失败后重读并重建补丁，完成后验证。",
  "scenarios.text.name": "文本",
  "scenarios.text.description": "文本情景：适合写作、改写、摘要、翻译与内容整理。",
  "capability.finalPlanningPrompt": "请基于以上工具结果，立即给出最终规划答案。",
  "context.phaseSummaryTitle": "[阶段小结]",
  "transfer.pluginDetailAttachments": "明细附件:",
  "transfer.pluginValidationInfo": "验收信息:",
  "modelRuntime.httpStatus.400": "请求参数或格式无效",
  "modelRuntime.httpStatus.401": "认证失败，请检查 API Key",
  "modelRuntime.httpStatus.403": "没有访问该资源的权限",
  "modelRuntime.httpStatus.404": "请求的资源不存在",
  "modelRuntime.httpStatus.429": "请求过于频繁或账户额度已用尽",
  "modelRuntime.httpStatus.500": "服务端处理错误，请稍后重试",
  "modelRuntime.httpStatus.503": "服务当前过载，请稍后重试",
  "modelRuntime.imagesTaskIdMissing": "缺少任务 ID",
  "modelRuntime.diagnostic.toolsArray": "工具定义必须是数组",
  "modelRuntime.diagnostic.invalidTool": "工具定义无效",
  "modelRuntime.diagnostic.bodyObject": "请求体必须是 JSON 对象",
  "modelRuntime.diagnostic.credentialMissing": "模型密钥未配置",
  "modelRuntime.diagnostic.oneRequest": "每次测试只发送一次请求",
  "modelRuntime.diagnostic.requestTooLarge": "请求体过大",
  "modelRuntime.diagnostic.invalidJson": "JSON 无效",
  "modelRuntime.diagnostic.invalidHost": "主机无效",
  "modelRuntime.diagnostic.invalidOrigin": "来源无效",
  "modelRuntime.diagnostic.notFound": "未找到",
  "modelRuntime.diagnostic.invalidToken": "校验失败",
  "modelRuntime.diagnostic.modelNotFound": "未找到模型",
  "modelRuntime.diagnostic.invalidProtocol": "接口选项无效",
  "modelRuntime.diagnostic.invalidEndpoint": "接口地址无效",
  "modelRuntime.diagnostic.bodyRequired": "需要请求体",
  "modelRuntime.diagnostic.invalidPort": "端口无效",
  "modelRuntime.diagnostic.availableTools": "可选工具：",
  "modelRuntime.diagnostic.selectTools": "输入要测试的工具编号/名称（逗号分隔，直接回车=全部）：",
  "modelRuntime.diagnostic.toolTestPrompt": ({ name } = {}) =>
    `请调用工具完成测试。\n工具名：${name}\n要求：必须发起一次 tool call；参数可使用最小可行占位值。`,
  "modelRuntime.diagnostic.invalidUserId": "用户 ID 无效",
  "modelRuntime.diagnostic.startUrl": ({ url } = {}) => `Noobot 模型访问测试：${url}`,
  "modelRuntime.diagnostic.modelsLoaded": ({ count } = {}) =>
    `已加载 ${count} 个模型。Ctrl+C 退出。`,
  "modelRuntime.imagesTaskFailed": "任务执行失败",
  "modelRuntime.imagesTaskTimeout": ({ id } = {}) => `任务超时：${id}`,
};
