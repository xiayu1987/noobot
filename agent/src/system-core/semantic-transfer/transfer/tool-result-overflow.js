/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { filePath as path } from "../../utils/path-resolver.js";
import { randomUUID } from "node:crypto";
import { toToolJsonResult } from "../../tools/core/tool-json-result.js";
import { compactToolResultTextForModel, firstNormalizedString } from "../core/compact.js";
import { createTransferEnvelope } from "../envelope/envelope.js";
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_DIRECTION,
  TRANSFER_SOURCE,
  TRANSFER_STORAGE_KIND,
  TRANSFER_TRANSPORT,
} from "../core/constants.js";
import {
  DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { resolveTransferPathView } from "../storage/transfer-path-view.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObjectSafely(text = "") {
  try {
    const parsed = JSON.parse(String(text || ""));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dedupeTransferEnvelopes(envelopes = []) {
  const seen = new Set();
  const output = [];
  for (const envelope of Array.isArray(envelopes) ? envelopes : []) {
    if (!isPlainObject(envelope)) continue;
    const attachmentId = String(
      envelope?.files?.[0]?.attachmentMeta?.attachmentId ||
        "",
    ).trim();
    const key =
      attachmentId ||
      firstNormalizedString(envelope?.files?.[0]?.filePath) ||
      JSON.stringify(envelope);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    output.push(envelope);
  }
  return output;
}

function compactObject(value = {}) {
  const output = {};
  for (const [key, itemValue] of Object.entries(isPlainObject(value) ? value : {})) {
    if (itemValue === "" || itemValue === null || itemValue === undefined) continue;
    if (Array.isArray(itemValue) && !itemValue.length) continue;
    if (isPlainObject(itemValue) && !Object.keys(itemValue).length) continue;
    output[key] = itemValue;
  }
  return output;
}

function compactPathView(pathView = {}, attachmentMeta = {}) {
  const normalizedPathView = compactObject(pathView);
  if (normalizedPathView.hostPath === attachmentMeta.path) delete normalizedPathView.hostPath;
  if (normalizedPathView.relativePath === attachmentMeta.relativePath) {
    delete normalizedPathView.relativePath;
  }
  if (normalizedPathView.displayPath === normalizedPathView.sandboxPath) {
    delete normalizedPathView.displayPath;
  }
  return compactObject(normalizedPathView);
}

function resolveReadFileOverflowSourcePath(parsed = {}) {
  return firstNormalizedString(
    parsed?.resolvedPath,
    parsed?.fileAddress,
    parsed?.displayPath,
    parsed?.filePath,
  );
}

function resolveReadFileOverflowFileAddress({ parsed = {}, pathView = {}, sourcePath = "" } = {}) {
  return firstNormalizedString(
    parsed?.fileAddress,
    parsed?.displayPath,
    pathView?.displayPath,
    pathView?.sandboxPath,
    parsed?.filePath,
    sourcePath,
  );
}

function normalizeToolResultPathViews({
  text = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const parsed = parseJsonObjectSafely(text);
  if (!parsed) return String(text || "");
  const pathKeys = new Set([
    "resolvedPath",
    "parsed_result_path",
    "parsedResultPath",
    "semantic_transfer_record_path",
  ]);
  const normalizeValue = (value, key = "") => {
    if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          normalizeValue(childValue, childKey),
        ]),
      );
    }
    const resolvedPath = pathKeys.has(key) ? firstNormalizedString(value) : "";
    if (!resolvedPath) return value;
    const pathView = resolveTransferPathView({
      runtime,
      agentContext,
      path: resolvedPath,
      hostPath: resolvedPath,
      purpose: "tool_result_text_path_view",
    });
    const displayPath = firstNormalizedString(
      pathView?.displayPath,
      pathView?.sandboxPath,
      pathView?.relativePath,
      resolvedPath,
    );
    return displayPath || value;
  };
  const normalized = normalizeValue(parsed);
  return JSON.stringify(normalized);
}

function compactTransferFile(file = {}) {
  if (!isPlainObject(file)) return null;
  const attachmentMeta = compactObject(file?.attachmentMeta || {});
  const pathView = compactPathView(file?.pathView || {}, attachmentMeta);
  const output = compactObject({
    filePath: file.filePath,
    attachmentMeta,
    pathView,
    role: file.role,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
  });
  if (output.name === attachmentMeta.name) delete output.name;
  if (output.mimeType === attachmentMeta.mimeType) delete output.mimeType;
  if (Number(output.size || 0) === Number(attachmentMeta.size || 0)) delete output.size;
  return compactObject(output);
}

function compactTransferEnvelope(envelope = {}) {
  if (!isPlainObject(envelope)) return null;
  const files = Array.isArray(envelope.files)
    ? envelope.files.map(compactTransferFile).filter(Boolean)
    : [];
  const output = compactObject({
    protocol: envelope.protocol,
    version: envelope.version,
    direction: envelope.direction,
    transport: envelope.transport,
    ...(files.length ? { files } : {}),
    storage: envelope.storage,
    producer: envelope.producer,
    meta: compactObject(envelope.meta || {}),
  });
  return output;
}

function extractOriginalTransferPayload(parsed = null) {
  if (!isPlainObject(parsed)) return {};
  const transferEnvelopes = dedupeTransferEnvelopes([
    ...(Array.isArray(parsed?.transferEnvelopes) ? parsed.transferEnvelopes : []),
  ]);
  return {
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function compactParsedToolResultForOverflow(parsed = null) {
  if (!isPlainObject(parsed)) return parsed;
  const compact = { ...parsed };
  const stdoutText = "stdout" in compact ? String(compact.stdout ?? "") : "";
  if ("stdout" in compact) {
    compact.stdout_length = stdoutText.length;
  }
  delete compact.stdout;
  delete compact.transferEnvelopes;
  // Drop legacy top-level transfer compatibility fields in overflow payloads.
  delete compact.attachmentMeta;
  delete compact.attachmentMetas;
  delete compact.filePath;
  delete compact.filePaths;
  delete compact.files;
  const overflowPathKey = ["overflow", "file", "path"].join("_");
  const overflowSandboxPathKey = ["overflow", "file", "sandbox", "path"].join("_");
  delete compact[overflowPathKey];
  delete compact[overflowSandboxPathKey];
  return compactObject(compact);
}

function resolveOverflowAttachmentPayloads(parsed = null, rawText = "") {
  if (isPlainObject(parsed)) {
    const payloads = [];
    if ("stdout" in parsed) {
      const stdoutText = String(parsed.stdout ?? "");
      payloads.push({
        text: stdoutText,
        name: "stdout.txt",
        mimeType: "text/plain",
        contentKind: "stdout",
        contentLength: stdoutText.length,
      });
    }
    if ("stderr" in parsed) {
      const stderrText = String(parsed.stderr ?? "");
      payloads.push({
        text: stderrText,
        name: "stderr.txt",
        mimeType: "text/plain",
        contentKind: "stderr",
        contentLength: stderrText.length,
      });
    }
    if (payloads.length) return payloads;
  }
  const normalizedRawText = String(rawText || "");
  return [
    {
      text: normalizedRawText,
      name: "tool-result.json",
      mimeType: "application/json",
      contentKind: "raw_tool_result",
      contentLength: normalizedRawText.length,
    },
  ];
}

function resolveToolResultOverflowArtifactText({
  overflowAttachmentPayload = {},
  rawText = "",
  call = {},
  maxChars = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  measuredText = "",
  overflowTransferPayload = {},
} = {}) {
  if (overflowAttachmentPayload.contentKind !== "raw_tool_result") {
    return overflowAttachmentPayload.text;
  }
  const parsed = parseJsonObjectSafely(rawText);
  const ok = parsed && typeof parsed.ok === "boolean" ? parsed.ok : true;
  const status = String(parsed?.status || "").trim();
  const originalMessage = String(parsed?.message || "").trim();
  const measuredLength = String(measuredText || rawText || "").length;
  const compactResult = compactParsedToolResultForOverflow(parsed);
  const compactTransferEnvelopes = Array.isArray(overflowTransferPayload?.transferEnvelopes)
    ? overflowTransferPayload.transferEnvelopes.map(compactTransferEnvelope).filter(Boolean)
    : [];
  return toToolJsonResult(call?.name, {
    overflowFormat: "compact-v1",
    ok,
    ...(status ? { status } : {}),
    ...(ok ? {} : { error: String(parsed?.error || "").trim() || "tool result overflowed" }),
    message:
      originalMessage ||
      `工具返回内容过长(${measuredLength}字符)，已保存为附件，请按返回的 transfer 信息分批读取。`,
    overflowed: true,
    overflow_reason: `tool result length ${measuredLength} exceeds limit ${maxChars}`,
    result: compactObject({
      ...(isPlainObject(compactResult) ? compactResult : {}),
      ...(compactTransferEnvelopes.length ? { transferEnvelopes: compactTransferEnvelopes } : {}),
    }),
  });
}


function isReadFileToolOverflow({ call = {}, parsed = null } = {}) {
  const callName = String(call?.name || "").trim();
  const parsedToolName = String(parsed?.toolName || parsed?.tool_name || "").trim();
  return callName === "read_file" || parsedToolName === "read_file";
}

function normalizeReadFileOverflowResult({
  call = {},
  parsed = null,
  rawText = "",
  measuredText = "",
  maxChars = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  runtime = {},
  agentContext = null,
} = {}) {
  if (!isPlainObject(parsed)) return null;
  const sourcePath = resolveReadFileOverflowSourcePath(parsed);
  if (!sourcePath) return null;
  const pathView = resolveTransferPathView({
    runtime,
    agentContext,
    path: sourcePath,
    hostPath: String(parsed?.resolvedPath || sourcePath).trim(),
    purpose: "read_file_overflow_address",
  });
  const publicPathView = compactObject({
    displayPath: pathView?.displayPath,
    sandboxPath: pathView?.sandboxPath,
    relativePath: pathView?.relativePath,
  });
  const fileAddress = resolveReadFileOverflowFileAddress({ parsed, pathView, sourcePath });
  const contentText = String(parsed?.content || "");
  const contentLength = Number.isFinite(Number(parsed?.contentLength))
    ? Number(parsed.contentLength)
    : contentText.length;
  const measuredLength = String(measuredText || rawText || "").length;
  const fileName = String(parsed?.fileName || path.basename(sourcePath)).trim();
  const envelope = createTransferEnvelope({
    direction: TRANSFER_DIRECTION.OUTPUT,
    transport: TRANSFER_TRANSPORT.FILE,
    files: [
      {
        filePath: fileAddress,
        pathView: publicPathView,
        role: "primary",
        name: fileName,
        mimeType: DEFAULT_TRANSFER_MIME_TYPE,
      },
    ],
    storage: {
      kind: TRANSFER_STORAGE_KIND.WORKSPACE,
      originalFile: true,
      persisted: false,
    },
    producer: { type: "tool", name: "read_file" },
    meta: {
      source: TRANSFER_SOURCE.TOOL,
      reason: "read_file_overflow_original_file",
      toolName: "read_file",
      originalFile: true,
      contentOmitted: true,
      contentLength,
      startLine: parsed?.startLine,
      endLine: parsed?.endLine,
      totalLines: parsed?.totalLines,
      includeLineNumbers: parsed?.includeLineNumbers,
      truncated: parsed?.truncated,
    },
  });
  const ok = typeof parsed.ok === "boolean" ? parsed.ok : true;
  const status = String(parsed?.status || "").trim();
  return toToolJsonResult(call?.name || "read_file", {
    ok,
    ...(status ? { status } : {}),
    message:
      String(parsed?.message || "").trim() ||
      "文件读取结果超过上下文限制，未保存为附件；已返回原文件引用，请按行号范围分段读取。",
    overflowed: true,
    overflow_reason: `read_file result length ${measuredLength} exceeds limit ${maxChars}`,
    overflow_strategy: "original_file_reference",
    transferEnvelopes: [envelope],
    summary: {
      original_length: measuredLength,
      max_length: maxChars,
      raw_serialized_length: String(rawText || "").length,
      compacted_serialized_length: measuredLength,
    },
  });
}

function normalizeOverflowSessionDirName(sessionId = "") {
  const normalized = String(sessionId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized || "__default__";
}

function resolveOverflowSessionId({
  sessionId = "",
  runtime = {},
  agentContext = null,
} = {}) {
  return String(
    sessionId ||
      runtime?.systemRuntime?.sessionId ||
      agentContext?.session?.current?.id ||
      agentContext?.execution?.controllers?.runtime?.systemRuntime?.sessionId ||
      "",
  ).trim();
}

function resolveSemanticTransferOutputDir({ runtime = {}, agentContext = null, sessionId = "" } = {}) {
  const basePath = String(
    agentContext?.environment?.workspace?.basePath || runtime?.basePath || "",
  ).trim();
  const sessionDirName = normalizeOverflowSessionDirName(
    resolveOverflowSessionId({ sessionId, runtime, agentContext }),
  );
  if (basePath) {
    return path.join(basePath, "runtime", "ops_workdir", ".semantic-transfer", sessionDirName);
  }
  return path.join(os.tmpdir(), "noobot-semantic-transfer", sessionDirName);
}

async function persistSemanticTransferRecord({
  call = {},
  compactedResult = null,
  transferPayload = {},
  runtime = {},
  agentContext = null,
  sessionId = "",
  maxChars = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  rawLength = 0,
  measuredLength = 0,
} = {}) {
  const envelopes = Array.isArray(transferPayload?.transferEnvelopes)
    ? transferPayload.transferEnvelopes.map(compactTransferEnvelope).filter(Boolean)
    : [];
  if (!envelopes.length) return "";
  const outputDir = resolveSemanticTransferOutputDir({ runtime, agentContext, sessionId });
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${Date.now()}-${randomUUID()}.json`);
  const payload = {
    toolName: String(call?.name || "").trim(),
    toolCallId: String(call?.id || "").trim(),
    createdAt: new Date().toISOString(),
    reason: "tool_result_overflow",
    summary: {
      maxChars: Number(maxChars || DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS),
      rawLength: Number(rawLength || 0),
      measuredLength: Number(measuredLength || 0),
    },
    compactedResult,
    transferEnvelopes: envelopes,
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return outputPath;
}

export async function normalizeToolResultOverflow({
  call = {},
  toolResultText = "",
  runtime = {},
  agentContext = null,
  sessionId = "",
} = {}) {
  const rawText = String(toolResultText || "");
  const compactedText = compactToolResultTextForModel(rawText);
  const measuredText = String(compactedText || rawText || "");
  const maxChars = resolveToolResultInlineTextLimit(runtime, DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS);
  const parsed = parseJsonObjectSafely(rawText);
  const isExplicitReadFileOriginalReference =
    isReadFileToolOverflow({ call, parsed }) &&
    (parsed?.contentOmitted === true || parsed?.content_omitted === true) &&
    resolveReadFileOverflowSourcePath(parsed);
  if (isExplicitReadFileOriginalReference) {
    const readFileOverflowResult = normalizeReadFileOverflowResult({
      call,
      parsed,
      rawText,
      measuredText,
      maxChars,
      runtime,
      agentContext,
    });
    if (readFileOverflowResult) {
      return {
        toolResultText: readFileOverflowResult,
        overflowed: true,
        rawLength: rawText.length,
        measuredLength: measuredText.length,
      };
    }
  }
  if (measuredText.length <= maxChars) {
    const normalizedMeasuredText = normalizeToolResultPathViews({
      text: measuredText,
      runtime,
      agentContext,
    });
    return {
      toolResultText: normalizedMeasuredText,
      overflowed: false,
      rawLength: rawText.length,
      measuredLength: normalizedMeasuredText.length,
    };
  }

  const readFileOverflowResult = normalizeReadFileOverflowResult({
    call,
    parsed,
    rawText,
    measuredText,
    maxChars,
    runtime,
    agentContext,
  });
  if (readFileOverflowResult) {
    return {
      toolResultText: readFileOverflowResult,
      overflowed: true,
      rawLength: rawText.length,
      measuredLength: measuredText.length,
    };
  }

  const overflowAttachmentPayloads = resolveOverflowAttachmentPayloads(parsed, rawText);
  const ok = parsed && typeof parsed.ok === "boolean" ? parsed.ok : true;
  const status = String(parsed?.status || "").trim();
  const originalMessage = String(parsed?.message || "").trim();
  const originalTransferPayload = extractOriginalTransferPayload(parsed);
  const persistedOverflowPayloads = [];
  const semanticOverflows = [];
  for (const overflowAttachmentPayload of overflowAttachmentPayloads) {
    const persistedPayload = {
      ...originalTransferPayload,
      transferEnvelopes: dedupeTransferEnvelopes([
        ...(Array.isArray(originalTransferPayload.transferEnvelopes)
          ? originalTransferPayload.transferEnvelopes
          : []),
        ...persistedOverflowPayloads.flatMap((payload = {}) =>
          Array.isArray(payload.transferEnvelopes) ? payload.transferEnvelopes : [],
        ),
      ]),
    };
    const materialized = await materializeTextForToolResult({
      runtime,
      agentContext,
      sessionId,
      text: resolveToolResultOverflowArtifactText({
        overflowAttachmentPayload,
        rawText,
        call,
        maxChars,
        measuredText,
        overflowTransferPayload: persistedPayload,
      }),
      name: `${String(call?.name || "tool").trim() || "tool"}.${overflowAttachmentPayload.name}`,
      mimeType: overflowAttachmentPayload.mimeType,
      attachmentSource: "model",
      generationSource: "tool_result_overflow",
      source: "tool",
      reason: "tool_result_overflow",
      alwaysPersist: true,
      forcePreview: true,
      producer: { type: "tool", name: String(call?.name || "").trim() },
      meta: {
        toolCallId: String(call?.id || "").trim(),
        overflowContentKind: overflowAttachmentPayload.contentKind,
        overflowContentLength: overflowAttachmentPayload.contentLength,
      },
    });
    semanticOverflows.push(materialized);
    persistedOverflowPayloads.push({
      transferEnvelopes: Array.isArray(materialized?.transferEnvelopes)
        ? materialized.transferEnvelopes
        : [],
    });
  }
  const semanticOverflowEnvelopes = dedupeTransferEnvelopes(
    semanticOverflows.flatMap((item = {}) =>
      Array.isArray(item?.transferEnvelopes) ? item.transferEnvelopes : [],
    ),
  );
  const overflowTransferPayload = semanticOverflowEnvelopes.length
    ? {
        ...originalTransferPayload,
        transferEnvelopes: dedupeTransferEnvelopes([
          ...(Array.isArray(originalTransferPayload.transferEnvelopes) ? originalTransferPayload.transferEnvelopes : []),
          ...semanticOverflowEnvelopes,
        ]),
      }
    : {
        ...originalTransferPayload,
        transferEnvelopes: dedupeTransferEnvelopes([
          ...(Array.isArray(originalTransferPayload.transferEnvelopes)
            ? originalTransferPayload.transferEnvelopes
            : []),
        ]),
      };
  const overflowTransferPayloadText = toToolJsonResult(call?.name, {
    ok,
    ...(status ? { status } : {}),
    ...(ok ? {} : { error: String(parsed?.error || "").trim() || "tool result overflowed" }),
    message:
      originalMessage ||
      `工具返回内容过长(${measuredText.length}字符)，已保存为附件，请按返回的 transfer 信息分批读取。`,
    overflowed: true,
    overflow_reason: `tool result length ${measuredText.length} exceeds limit ${maxChars}`,
    ...overflowTransferPayload,
  });
  const semanticTransferRecordPath = await persistSemanticTransferRecord({
    call,
    compactedResult: compactParsedToolResultForOverflow(parseJsonObjectSafely(overflowTransferPayloadText)),
    transferPayload: overflowTransferPayload,
    runtime,
    agentContext,
    sessionId,
    maxChars,
    rawLength: rawText.length,
    measuredLength: measuredText.length,
  });
  const normalized = toToolJsonResult(call?.name, {
    ok,
    ...(status ? { status } : {}),
    ...(ok ? {} : { error: String(parsed?.error || "").trim() || "tool result overflowed" }),
    message:
      originalMessage ||
      `工具返回内容过长(${measuredText.length}字符)，已保存为附件，请按返回的 transfer 信息分批读取。`,
    overflowed: true,
    overflow_reason: `tool result length ${measuredText.length} exceeds limit ${maxChars}`,
    ...overflowTransferPayload,
    summary: {
      original_length: measuredText.length,
      max_length: maxChars,
      raw_serialized_length: rawText.length,
      compacted_serialized_length: measuredText.length,
      ...(semanticTransferRecordPath ? { semantic_transfer_record_path: semanticTransferRecordPath } : {}),
    },
  });
  const normalizedPathViews = normalizeToolResultPathViews({
    text: normalized,
    runtime,
    agentContext,
  });
  return {
    toolResultText: normalizedPathViews,
    overflowed: true,
    rawLength: rawText.length,
    measuredLength: measuredText.length,
  };
}
