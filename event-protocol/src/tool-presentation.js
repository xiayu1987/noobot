/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { collapsedText as text } from "./normalize.js";
import { isPlainObject } from "@noobot/shared/value";
import { assertToolResultObject, decodeToolResultText } from "./tool-result.js";

function structuredDetail(detail, result) {
  if (result) {
    return typeof detail === "string"
      ? decodeToolResultText(detail)
      : assertToolResultObject(detail);
  }
  if (!isPlainObject(detail)) throw new TypeError("tool call arguments must be an object");
  return detail;
}

function requiredToolName(tool) {
  const toolName = text(tool);
  if (!toolName) throw new TypeError("tool presentation requires a tool name");
  return toolName;
}

function assertMaxLength(maxLength) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new TypeError("tool presentation maxLength must be a positive integer");
  }
  return maxLength;
}

function compact(value, maxLength) {
  const normalized = text(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function argumentDisplay(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return text(value);
  return text(JSON.stringify(value));
}

const TOOL_PATH_VIEW = Object.freeze({
  WORKSPACE: "workspace",
  HOST: "host",
  MOUNT: "mount",
  ATTACHMENT: "attachment",
});

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`tool path reference requires ${field}`);
  return normalized;
}

function toolPathRefDisplay(ref) {
  if (!isPlainObject(ref)) throw new TypeError("tool path reference must be an object");
  if (ref.view === TOOL_PATH_VIEW.WORKSPACE || ref.view === TOOL_PATH_VIEW.HOST) {
    return requiredText(ref.path, "path");
  }
  if (ref.view === TOOL_PATH_VIEW.MOUNT) {
    return `${requiredText(ref.mount, "mount")}/${requiredText(ref.path, "path")}`;
  }
  throw new TypeError(`unsupported tool path reference view: ${String(ref.view)}`);
}

function fileResultDisplay(value) {
  if (isPlainObject(value.path) && value.path.view === TOOL_PATH_VIEW.ATTACHMENT) {
    return requiredText(value.fileName, "fileName");
  }
  return toolPathRefDisplay(value.path);
}

function optionalToolPathRefDisplay(value) {
  return value === undefined ? "" : toolPathRefDisplay(value);
}

function attachmentNames(value = {}) {
  const names = [];
  for (const envelope of Array.isArray(value.transferEnvelopes) ? value.transferEnvelopes : []) {
    for (const attachment of Array.isArray(envelope?.payload?.attachments)
      ? envelope.payload.attachments
      : []) {
      const name = text(attachment?.name);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function nativeScriptSummary(value, result) {
  if (result) {
    const names = attachmentNames(value);
    const fileCount = Number(value.output_file_count);
    const bytes = Number(value.output_bytes);
    const output = names.length
      ? names.join(", ")
      : Number.isFinite(fileCount)
        ? `${fileCount} output file${fileCount === 1 ? "" : "s"}`
        : "";
    return [output, Number.isFinite(bytes) ? `${bytes} B` : ""].filter(Boolean).join(" · ");
  }

  const inputs = Array.isArray(value.inputs) ? value.inputs : [];
  const inputSummary = `${inputs.length} input${inputs.length === 1 ? "" : "s"}`;
  const args = isPlainObject(value.arguments)
    ? Object.entries(value.arguments)
        .slice(0, 3)
        .map(([key, item]) => `${key}=${argumentDisplay(item)}`)
        .filter((item) => !item.endsWith("="))
        .join(", ")
    : "";
  return [inputSummary, args].filter(Boolean).join(" · ");
}

function patchChanges(value) {
  if (!Array.isArray(value.changes) || !value.changes.length) {
    throw new TypeError("patch_file result requires a non-empty changes array");
  }
  return value.changes;
}

function patchSummary(value, result) {
  if (result) {
    const target = toolPathRefDisplay(patchChanges(value)[0].path);
    return [target, value.dryRun === true ? "dry-run" : ""].filter(Boolean).join(" · ");
  }
  return [text(value.root), text(value.format), value.dryRun === true ? "dry-run" : "apply"]
    .filter(Boolean)
    .join(" · ");
}

export function projectToolOperationSubject(tool, detail, { result = false, maxLength = 96 } = {}) {
  const toolName = requiredToolName(tool);
  const limit = assertMaxLength(maxLength);
  const value = structuredDetail(detail, result);
  let subject = "";

  if (result && value.overflowed === true) {
    subject = text(value.message);
  } else if (result && value.ok === false) {
    subject = text(value.error);
  } else if (["write_file", "read_file"].includes(toolName)) {
    subject = result ? fileResultDisplay(value) : text(value.filePath);
  } else if (toolName === "patch_file") {
    subject = patchSummary(value, result);
  } else if (["execute_script", "execute_command"].includes(toolName)) {
    subject = text(result ? value.stdout : value.command || value.script);
  } else if (toolName === "execute_native_script") {
    subject = nativeScriptSummary(value, result);
  } else if (toolName === "search") {
    subject = [
      value.query,
      result ? optionalToolPathRefDisplay(value.path) : text(value.path),
      Array.isArray(value.matches) ? `${value.matches.length} matches` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (toolName === "list_skills") {
    subject =
      value.parentSkill || (Array.isArray(value.items) ? `${value.items.length} items` : "");
  } else if (toolName === "user_interaction") {
    subject = value.content || value.message;
  } else {
    subject = value.command || value.query || value.content || value.message || value.stdout;
  }

  return compact(subject, limit);
}

export function projectToolOperationSummary(tool, detail, options = {}) {
  const toolName = requiredToolName(tool);
  const subject = projectToolOperationSubject(toolName, detail, options);
  return subject ? `${toolName} · ${subject}` : toolName;
}
