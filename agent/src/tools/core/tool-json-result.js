/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { isPlainObject } from "../../shared/utils/shared-utils.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isCanonicalBase64(value = "") {
  const normalized = normalizeString(value);
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  )
    return false;
  return Buffer.from(normalized, "base64").toString("base64") === normalized;
}

const COMMON_RESULT_FIELDS = [
  "ok",
  "status",
  "error",
  "message",
  "summary",
  "sessionId",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "tools",
];

const OUTPUT_ARTIFACT_FIELDS = new Set([
  "type",
  "name",
  "mimeType",
  "content",
  "contentBase64",
]);

export function parseToolOutputArtifacts(value = null) {
  const source =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  if (!isPlainObject(source) || !Array.isArray(source.outputArtifacts))
    return [];
  return source.outputArtifacts.map((artifact, index) => {
    if (!isPlainObject(artifact))
      throw new Error("invalid_tool_output_artifact");
    for (const key of Object.keys(artifact)) {
      if (!OUTPUT_ARTIFACT_FIELDS.has(key))
        throw new Error(`unknown_tool_output_artifact_field:${key}`);
    }
    const name = normalizeString(artifact.name);
    const type = normalizeString(artifact.type);
    const mimeType = normalizeString(artifact.mimeType);
    const hasContent = typeof artifact.content === "string";
    const hasContentBase64 = typeof artifact.contentBase64 === "string";
    const content = hasContent ? artifact.content : "";
    const contentBase64 = hasContentBase64
      ? normalizeString(artifact.contentBase64)
      : "";
    if (!["text", "attachment_url", "attachment_bytes"].includes(type))
      throw new Error(`invalid_tool_output_artifact_type:${index}`);
    if (!name) throw new Error(`invalid_tool_output_artifact_name:${index}`);
    if (!mimeType)
      throw new Error(`invalid_tool_output_artifact_mime_type:${index}`);
    if (!hasContent && !hasContentBase64)
      throw new Error(`invalid_tool_output_artifact_content:${index}`);
    if (hasContent && hasContentBase64)
      throw new Error(`ambiguous_tool_output_artifact_content:${index}`);
    if (
      type === "attachment_bytes" &&
      (!hasContentBase64 || hasContent || !isCanonicalBase64(contentBase64))
    )
      throw new Error(`invalid_tool_output_artifact_bytes:${index}`);
    if (type !== "attachment_bytes" && !hasContent)
      throw new Error(`invalid_tool_output_artifact_text:${index}`);
    return {
      type,
      name,
      mimeType,
      ...(hasContentBase64 ? { contentBase64 } : { content }),
    };
  });
}

export function stripToolOutputArtifacts(toolResultText = "") {
  let source;
  try {
    source = JSON.parse(String(toolResultText || ""));
  } catch {
    return String(toolResultText || "");
  }
  if (!isPlainObject(source) || !Object.hasOwn(source, "outputArtifacts")) {
    return String(toolResultText || "");
  }
  const { outputArtifacts: _outputArtifacts, ...publicResult } = source;
  return JSON.stringify(publicResult);
}

function normalizeCommonFieldValue(key, value) {
  if (value === undefined || value === null) return undefined;
  if (key === "ok") return Boolean(value);
  if (
    key === "status" &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return value;
  }
  if (
    key === "error" ||
    key === "message" ||
    key === "sessionId" ||
    key === "parentSessionId" ||
    key === "parentDialogProcessId" ||
    key === "dialogProcessId"
  ) {
    const normalized = normalizeString(value);
    return normalized || undefined;
  }
  if (key === "tools") {
    if (!Array.isArray(value)) return undefined;
    const list = Array.from(
      new Set(value.map((item) => normalizeString(item)).filter(Boolean)),
    );
    return list.length ? list : undefined;
  }
  if (key === "summary") {
    return isPlainObject(value) ? value : undefined;
  }
  return value;
}

export function buildToolResultPayload(payload = {}) {
  const src = isPlainObject(payload) ? payload : { data: payload };
  const out = {};
  for (const field of COMMON_RESULT_FIELDS) {
    const normalized = normalizeCommonFieldValue(field, src[field]);
    if (normalized !== undefined) out[field] = normalized;
  }
  for (const [key, value] of Object.entries(src)) {
    if (COMMON_RESULT_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function toToolJsonResult(toolName, payload = {}, pretty = false) {
  const normalizedPayload = buildToolResultPayload(payload);
  return JSON.stringify(
    {
      toolName: String(toolName || "").trim(),
      ...normalizedPayload,
    },
    null,
    pretty ? 2 : 0,
  );
}
