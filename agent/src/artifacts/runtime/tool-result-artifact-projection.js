/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function tryParseJsonObject(value = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveBaseName(filePath = "") {
  const normalized = String(filePath || "").trim().replaceAll("\\", "/");
  return String(normalized.split("/").at(-1) || "").trim();
}

export function projectWrittenFileFromToolResult(toolName = "", result = "") {
  const parsed = tryParseJsonObject(result);
  const normalizedToolName = String(toolName || parsed?.toolName || "").trim();
  const resultToolName = String(parsed?.toolName || normalizedToolName).trim();
  if (normalizedToolName !== "write_file" && resultToolName !== "write_file") return null;
  if (!parsed || parsed?.ok === false || String(parsed?.state || "").toUpperCase() !== "OK") {
    return null;
  }
  const resolvedPath = String(parsed?.resolvedPath || parsed?.path || "").trim();
  const fileName = String(parsed?.fileName || resolveBaseName(resolvedPath)).trim();
  if (!resolvedPath || !fileName) return null;
  return {
    toolName: resultToolName,
    resolvedPath,
    fileName,
    ...(typeof parsed?.isSandbox === "boolean"
      ? { isSandbox: parsed.isSandbox }
      : typeof parsed?.sandboxEnabled === "boolean"
        ? { isSandbox: parsed.sandboxEnabled }
        : {}),
    sourceType: "tool",
    recognized: false,
  };
}

export function projectToolResultArtifacts({ toolName = "", result = "", attachments = [] } = {}) {
  const writtenFile = projectWrittenFileFromToolResult(toolName, result);
  return {
    attachments: Array.isArray(attachments) ? attachments : [],
    writtenFiles: writtenFile ? [writtenFile] : [],
  };
}
