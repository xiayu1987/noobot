/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value = "") {
  return String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function structuredDetail(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compact(value, maxLength) {
  const normalized = text(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function argumentDisplay(value) {
  if (value === undefined || value === null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return text(value);
  try {
    return text(JSON.stringify(value));
  } catch {
    return "";
  }
}

function attachmentDisplay(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const attachmentId = text(value.attachmentId);
  return attachmentId ? `attachment:${attachmentId}` : "";
}

export function projectToolFileDisplay(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  if (value.logical && typeof value.logical === "object") {
    const logicalPath = projectToolFileDisplay(value.logical);
    if (logicalPath) return logicalPath;
  }
  if (value.path && typeof value.path === "object") {
    const nestedPath = projectToolFileDisplay(value.path);
    if (nestedPath) return nestedPath;
  }

  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (path) return path;
  for (const identity of [value.identity, value.attachment, value]) {
    const attachment = attachmentDisplay(identity);
    if (attachment) return attachment;
  }
  return text(value.fileName || value.name);
}

function firstFileDisplay(...values) {
  for (const value of values) {
    const projected = projectToolFileDisplay(value);
    if (projected) return projected;
  }
  return "";
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
    if (value.error) return text(value.error);
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
  const args =
    value.arguments && typeof value.arguments === "object" && !Array.isArray(value.arguments)
      ? Object.entries(value.arguments)
          .slice(0, 3)
          .map(([key, item]) => `${key}=${argumentDisplay(item)}`)
          .filter((item) => !item.endsWith("="))
          .join(", ")
      : "";
  return [inputSummary, args].filter(Boolean).join(" · ");
}

function patchSummary(value, result) {
  if (result) {
    if (value.error) return text(value.error);
    const changedFiles = Array.isArray(value.changes)
      ? value.changes
      : Array.isArray(value.changedFiles)
        ? value.changedFiles
        : [];
    const target = firstFileDisplay(changedFiles[0]?.path || changedFiles[0], value.root);
    return [target, value.dryRun === true ? "dry-run" : ""].filter(Boolean).join(" · ");
  }
  return [
    firstFileDisplay(value.root),
    text(value.format),
    value.dryRun === true ? "dry-run" : "apply",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function projectToolOperationSummary(
  tool = "",
  detail,
  { result = false, maxLength = 96 } = {},
) {
  const toolName = text(tool) || "tool";
  const value = structuredDetail(detail);
  let subject = "";

  if (["write_file", "read_file"].includes(toolName)) {
    subject =
      result && value.error
        ? text(value.error)
        : firstFileDisplay(value.path, value.filePath, value.fileName);
  } else if (toolName === "patch_file") {
    subject = patchSummary(value, result);
  } else if (["execute_script", "execute_command"].includes(toolName)) {
    subject =
      result && value.error
        ? text(value.error)
        : text(result ? value.stdout : value.command || value.script);
  } else if (toolName === "execute_native_script") {
    subject = nativeScriptSummary(value, result);
  } else if (toolName === "search") {
    subject =
      result && value.error
        ? text(value.error)
        : [
            value.query,
            firstFileDisplay(value.path, value.source),
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
    subject =
      result && value.error
        ? value.error
        : firstFileDisplay(value.filePath, value.path, value.fileName, value.resolvedPath) ||
          value.command ||
          value.query ||
          value.content ||
          value.message ||
          value.stdout;
  }

  const compactSubject = compact(subject, Math.max(1, Number(maxLength) || 96));
  return compactSubject ? `${toolName} · ${compactSubject}` : toolName;
}
