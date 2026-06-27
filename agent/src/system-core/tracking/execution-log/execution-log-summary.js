/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Compact frontend-oriented execution log summary.
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

function stringifyBrief(value, maxLength = LENGTH_THRESHOLDS.display.executionLogBriefChars) {
  if (value == null) return "";
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

const HIDDEN_SYSTEM_EVENTS = new Set([
  "model_selected",
  "model_switched",
  "tool_binding_ready",
  "llm_call_start",
  "llm_call_end",
  "tool_calls_detected",
  "session_turn_full",
  "assistant_message_saved",
  "system",
]);

const VISIBLE_NON_TOOL_EVENTS = new Set([
  "semantic_transfer_validation",
  "semantic_transfer_legacy_input_warning",
]);

const TOOL_LABELS = {
  read_file: "读取文件",
  write_file: "写入文件",
  patch_file: "修改文件",
  search: "搜索代码/文件",
  execute_script: "执行命令",
  process_content_task: "处理附件/内容",
  call_service: "调用外部服务",
  request_help: "请求帮助",
  task_summary: "提交阶段小结",
};

function getToolLabel(tool = "") {
  return TOOL_LABELS[tool] || tool || "工具";
}

function resolveData(log = {}) {
  return log?.data && typeof log.data === "object" ? log.data : {};
}

function resolveEvent(log = {}) {
  const data = resolveData(log);
  return String(data.rawEvent || data.event || log?.event || "").trim();
}

function isNoisySystemLog(log = {}) {
  const data = resolveData(log);
  const event = resolveEvent(log);
  const category = String(log?.category || data.category || "").toLowerCase();
  const type = String(log?.type || data.type || "").toLowerCase();
  if (HIDDEN_SYSTEM_EVENTS.has(event)) return true;
  if (category === "system" && type === "system" && !VISIBLE_NON_TOOL_EVENTS.has(event)) return true;
  return false;
}

function isVisibleExecutionLog(log = {}) {
  if (isNoisySystemLog(log)) return false;
  if (resolveToolName(log)) return true;
  const status = resolveStatus(log);
  if (status === "error") return true;
  const event = resolveEvent(log);
  return VISIBLE_NON_TOOL_EVENTS.has(event);
}

function resolvePathHint(data = {}) {
  return data.filePath || data.path || data?.args?.filePath || data?.args?.path || "";
}

function resolveToolActionText(tool = "", data = {}) {
  const label = getToolLabel(tool);
  const pathHint = resolvePathHint(data);
  if (pathHint) return `${label}：${pathHint}`;
  if (tool === "execute_script" && (data.command || data?.args?.command)) {
    return `${label}：${stringifyBrief(data.command || data.args.command, 120)}`;
  }
  if (tool === "search" && (data.query || data?.args?.query)) {
    return `${label}：${stringifyBrief(data.query || data.args.query, 120)}`;
  }
  return label;
}

function resolveToolName(log = {}) {
  const data = resolveData(log);
  return String(data.tool || data.toolName || log.tool || log.toolName || "").trim();
}

function resolveStatus(log = {}) {
  const event = String(log?.event || log?.data?.rawEvent || "").toLowerCase();
  const type = String(log?.type || log?.data?.type || "").toLowerCase();
  const category = String(log?.category || log?.data?.category || "").toLowerCase();
  if (category === "error" || type.includes("error") || event.includes("error")) return "error";
  if (event === "tool_call_start" || type === "tool_call") return "running";
  if (event === "tool_call_end" || type === "tool_result") return "completed";
  return "info";
}

function buildSummaryText(log = {}) {
  const data = resolveData(log);
  const event = resolveEvent(log) || "system";
  const tool = resolveToolName(log);
  const status = resolveStatus(log);

  if (tool) {
    const actionText = resolveToolActionText(tool, data);
    if (status === "running") return `开始：${actionText}`;
    if (status === "completed") return `完成：${actionText}`;
    if (status === "error") return `失败：${actionText}`;
  }

  if (status === "error") {
    return `发生错误：${stringifyBrief(data.message || data.error || event, 120)}`;
  }

  if (event === "semantic_transfer_validation") return "校验大内容传输结果";
  if (event === "semantic_transfer_legacy_input_warning") return "发现旧版大内容传输输入";
  return stringifyBrief(data.text || event, 120);
}

function pickDetails(log = {}) {
  const data = resolveData(log);
  const details = {};
  const tool = resolveToolName(log);
  if (tool) details.tool = tool;
  if (data.filePath) details.filePath = data.filePath;
  if (data.path) details.path = data.path;
  if (data?.args?.filePath) details.filePath = data.args.filePath;
  if (data?.args?.path) details.path = data.args.path;
  if (data.command) details.command = stringifyBrief(data.command, 240);
  if (data?.args?.command) details.command = stringifyBrief(data.args.command, 240);
  if (data.query) details.query = stringifyBrief(data.query, 160);
  if (data?.args?.query) details.query = stringifyBrief(data.args.query, 160);
  if (data.error || data.message) details.message = stringifyBrief(data.message || data.error, 240);
  if (typeof data.ok === "boolean") details.ok = data.ok;
  return details;
}

export function summarizeExecutionLogs(logs = [], { maxSteps = 80, dialogProcessId = "" } = {}) {
  const sourceLogs = Array.isArray(logs) ? logs : [];
  const wantedDialogProcessId = String(dialogProcessId || "").trim();
  const scopedLogs = wantedDialogProcessId
    ? sourceLogs.filter((log) => String(log?.dialogProcessId || log?.data?.dialogProcessId || "") === wantedDialogProcessId)
    : sourceLogs;
  const visibleLogs = scopedLogs.filter(isVisibleExecutionLog);
  const steps = visibleLogs.slice(-maxSteps).map((log, index) => ({
    index,
    ts: String(log?.ts || log?.data?.ts || ""),
    event: String(log?.event || log?.data?.rawEvent || log?.data?.event || ""),
    category: String(log?.category || log?.data?.category || "system"),
    type: String(log?.type || log?.data?.type || "system"),
    status: resolveStatus(log),
    text: buildSummaryText(log),
    details: pickDetails(log),
  }));

  const toolCalls = steps.filter((step) => step.category === "tool" || step.details.tool);
  const errors = steps.filter((step) => step.status === "error");

  return {
    total: sourceLogs.length,
    scopedTotal: scopedLogs.length,
    visibleTotal: visibleLogs.length,
    returned: steps.length,
    toolCallCount: toolCalls.filter((step) => step.status === "running").length,
    toolResultCount: toolCalls.filter((step) => step.status === "completed").length,
    errorCount: errors.length,
    latestText: steps.length ? steps[steps.length - 1].text : "",
    steps,
  };
}
