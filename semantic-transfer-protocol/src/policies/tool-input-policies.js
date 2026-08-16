/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const MAX_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;
const text = (value = "") => String(value ?? "").trim();

export function registerToolInputPolicies(register) {
  register({
    toolName: "write_file",
    field: "content",
    maxChars: MAX_CHARS,
    reason: "write_file_input_too_long",
    message: "文件内容过长，请分批写入",
    name: ({ args = {} }) =>
      `${text(args.filePath).split(/[\\/]/).pop() || "write-file-content"}.tool-input.txt`,
  });
  register({
    toolName: "execute_script",
    field: "command",
    maxChars: MAX_CHARS,
    reason: "execute_script_input_too_long",
    message: "脚本内容过长，请分批执行或拆分脚本/文本后重试",
    name: "execute-script-command.tool-input.sh",
  });
  register({
    toolName: "search",
    field: "text",
    maxChars: MAX_CHARS,
    reason: "semantic_transfer_tool_input",
    message: "text is too long; search in smaller chunks",
    enabled: ({ args = {} }) => text(args.source || "files") === "text",
    name: "search-text.tool-input.txt",
  });
  register({
    toolName: "patch_file",
    field: "patch",
    maxChars: MAX_CHARS,
    reason: "patch_file_input_too_long",
    message: "补丁内容过长，请分批应用或拆分 patch 后重试",
    name: "patch-file-patch.tool-input.diff",
  });
  register({
    toolName: "task_summary",
    field: "summaryContent",
    maxChars: MAX_CHARS,
    forceAttachment: true,
    reason: "semantic_transfer_tool_input",
    name: "task-summary-content.tool-input.md",
  });
}
