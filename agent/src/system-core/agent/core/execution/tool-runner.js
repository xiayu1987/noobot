/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../../event/index.js";
import { isFatalError } from "../../../error/index.js";
import { toToolJsonResult } from "../../../tools/core/tool-json-result.js";
import { extractAttachmentMetasFromToolResult } from "../media/artifact-service.js";
import { isAbortError } from "../utils/error-utils.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { handleEngineError } from "../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { buildHookContext } from "../hook/hook-context-builder.js";
import {
  compactToolResultTextForModel,
  materializeTextForToolResult,
} from "../../../semantic-transfer/index.js";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 10000;
function toSafePositiveInt(value, fallback = DEFAULT_MAX_TOOL_RESULT_CHARS, min = 512) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function resolveToolResultLengthLimit(runtime = {}) {
  const userLimit = runtime?.userConfig?.tools?.maxToolResultChars;
  const globalLimit = runtime?.globalConfig?.tools?.maxToolResultChars;
  return toSafePositiveInt(userLimit ?? globalLimit, DEFAULT_MAX_TOOL_RESULT_CHARS, 512);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dedupeTransferEnvelopes(envelopes = []) {
  const seen = new Set();
  const output = [];
  for (const envelope of Array.isArray(envelopes) ? envelopes : []) {
    if (!isPlainObject(envelope)) continue;
    const attachmentId = String(
      envelope?.attachmentMeta?.attachmentId ||
        envelope?.files?.[0]?.attachmentMeta?.attachmentId ||
        "",
    ).trim();
    const key =
      attachmentId ||
      String(envelope?.filePath || envelope?.files?.[0]?.filePath || "").trim() ||
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
    ...(files.length
      ? { files }
      : {
          filePath: envelope.filePath,
          attachmentMeta: compactObject(envelope.attachmentMeta || {}),
          pathView: compactPathView(envelope.pathView || {}, envelope.attachmentMeta || {}),
        }),
    storage: envelope.storage,
    producer: envelope.producer,
    meta: compactObject(envelope.meta || {}),
  });
  return output;
}

function extractOriginalTransferPayload(parsed = null) {
  if (!isPlainObject(parsed)) return {};
  const transferResult = isPlainObject(parsed?.transferResult) ? parsed.transferResult : null;
  const transferEnvelopes = dedupeTransferEnvelopes([
    isPlainObject(parsed?.transferEnvelope) ? parsed.transferEnvelope : null,
    isPlainObject(transferResult?.envelope) ? transferResult.envelope : null,
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
  delete compact.transferResult;
  delete compact.transferEnvelope;
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
  maxChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
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
      maxChars: Number(maxChars || DEFAULT_MAX_TOOL_RESULT_CHARS),
      rawLength: Number(rawLength || 0),
      measuredLength: Number(measuredLength || 0),
    },
    compactedResult,
    transferEnvelopes: envelopes,
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return outputPath;
}

async function normalizeToolResultOverflow({
  call = {},
  toolResultText = "",
  runtime = {},
  agentContext = null,
  sessionId = "",
} = {}) {
  const rawText = String(toolResultText || "");
  const compactedText = compactToolResultTextForModel(rawText);
  const measuredText = String(compactedText || rawText || "");
  const maxChars = resolveToolResultLengthLimit(runtime);
  if (measuredText.length <= maxChars) {
    return {
      toolResultText: measuredText,
      overflowed: false,
      rawLength: rawText.length,
      measuredLength: measuredText.length,
    };
  }

  const parsed = parseJsonObjectSafely(rawText);
  const overflowAttachmentPayloads = resolveOverflowAttachmentPayloads(parsed, rawText);
  const semanticOverflows = await Promise.all(
    overflowAttachmentPayloads.map((overflowAttachmentPayload = {}) =>
      materializeTextForToolResult({
        runtime,
        agentContext,
        text: overflowAttachmentPayload.text,
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
      }),
    ),
  );
  const semanticOverflowEnvelopes = dedupeTransferEnvelopes(
    semanticOverflows.flatMap((item = {}) =>
      Array.isArray(item?.transferEnvelopes) ? item.transferEnvelopes : [],
    ),
  );
  const ok = parsed && typeof parsed.ok === "boolean" ? parsed.ok : true;
  const status = String(parsed?.status || "").trim();
  const originalMessage = String(parsed?.message || "").trim();
  const originalTransferPayload = extractOriginalTransferPayload(parsed);
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
  const semanticTransferRecordPath = await persistSemanticTransferRecord({
    call,
    compactedResult: compactParsedToolResultForOverflow(parseJsonObjectSafely(rawText)),
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
  return {
    toolResultText: normalized,
    overflowed: true,
    rawLength: rawText.length,
    measuredLength: measuredText.length,
  };
}

function resolveToolHookMeta(runtime = {}) {
  const runtimeMeta =
    runtime?.hookManager?.runtime && typeof runtime.hookManager.runtime === "object"
      ? runtime.hookManager.runtime
      : null;
  if (runtimeMeta) {
    return {
      ...runtimeMeta,
      runtime,
    };
  }
  return { runtime };
}

function detectToolCallFailure({ rawResult, toolResultText = "", invokeError = null }) {
  if (invokeError) {
    return { success: false, reason: "invoke_error" };
  }
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    if (rawResult.ok === false) return { success: false, reason: "result_ok_false" };
    return { success: true, reason: "" };
  }
  const parsed = parseJsonObjectSafely(toolResultText);
  if (parsed && parsed.ok === false) {
    return { success: false, reason: "result_ok_false" };
  }
  return { success: true, reason: "" };
}

export async function executeToolCall({
  call = {},
  tool = null,
  abortSignal = null,
  eventListener = null,
  turn = 1,
  executionScope = "primary",
  errorLogger = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const toolStartedAtMs = Date.now();
  const toolStartedAt = new Date(toolStartedAtMs).toISOString();
  let toolResultText = "";
  let invokeError = null;
  if (!tool) {
    toolResultText = toToolJsonResult(call?.name, {
      ok: false,
      status: "failed",
      code: ERROR_CODE.RECOVERABLE_TOOL_NOT_FOUND,
      error: `tool not found: ${call?.name}`,
    });
    emitEvent(eventListener, "tool_call_end", {
      turn,
      tool: call?.name,
      result: String(toolResultText).slice(0, 200),
    });
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.AFTER_TOOL_CALL,
      context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, runtime, {
        phase: "tool_call",
        executionScope,
        turn,
        status: "error",
        startedAt: toolStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - toolStartedAtMs,
        call,
        toolName: call?.name || "",
        success: false,
        failureReason: "tool_not_found",
        toolResultText,
        agentContext,
      }),
    });
    return {
      call,
      toolResultText,
      extractedAttachmentMetas: [],
      success: false,
      failureReason: "tool_not_found",
    };
  }
  let rawResult = null;
  let rawToolResultText = "";
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.BEFORE_TOOL_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TOOL_CALL, runtime, {
      phase: "tool_call",
      executionScope,
      turn,
      status: "start",
      startedAt: toolStartedAt,
      call,
      toolName: call?.name || "",
      args: call?.args || {},
      agentContext,
    }),
  });
  try {
    rawResult = await tool.invoke(call?.args || {}, {
      signal: abortSignal,
      configurable: {
        noobotHookContext: buildHookContext(AGENT_HOOK_POINTS.BEFORE_TOOL_CALL, runtime, {
          phase: "tool_call",
          executionScope,
          turn,
          status: "running",
          startedAt: toolStartedAt,
          call,
          toolName: call?.name || "",
          args: call?.args || {},
          agentContext,
        }),
        noobotHookMeta: resolveToolHookMeta(runtime),
      },
    });
    toolResultText =
      typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    rawToolResultText = toolResultText;
  } catch (error) {
    const isAbort = isAbortError(error);
    const isFatal = isFatalError(error);
    handleEngineError({
      error,
      eventListener,
      event: "tool_call_error",
      metadata: {
        source: "tool-runner",
        turn,
        tool: String(call?.name || "").trim(),
        sessionId: String(sessionId || "").trim(),
        parentSessionId: String(parentSessionId || "").trim(),
      },
    });
    if (isAbort || isFatal) throw error;
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.TOOL_CALL_ERROR,
      context: buildHookContext(AGENT_HOOK_POINTS.TOOL_CALL_ERROR, runtime, {
        phase: "tool_call",
        executionScope,
        turn,
        status: "error",
        startedAt: toolStartedAt,
        endedAt: new Date(Date.now()).toISOString(),
        durationMs: Date.now() - toolStartedAtMs,
        call,
        toolName: call?.name || "",
        args: call?.args || {},
        error,
        agentContext,
      }),
    });
    invokeError = error;
    const errorDetails =
      error?.details && typeof error.details === "object" ? error.details : null;
    toolResultText = toToolJsonResult(call?.name, {
      ok: false,
      status: "failed",
      code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR),
      error: error?.message || String(error),
      ...(errorDetails ? { details: errorDetails } : {}),
    });
    rawToolResultText = toolResultText;
    if (errorLogger && typeof errorLogger.log === "function") {
      const normalizedCause =
        typeof error?.cause === "string"
          ? error.cause
          : error?.cause?.message || "";
      void errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: "tool-runner",
        event: "tool_invoke_error",
        error,
        extra: {
          toolName: call?.name || "",
          ...(normalizedCause ? { cause: normalizedCause } : {}),
        },
      });
    }
  }
  const failureState = detectToolCallFailure({
    rawResult,
    toolResultText: rawToolResultText || toolResultText,
    invokeError,
  });
  const rawExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name,
    rawToolResultText || toolResultText,
  );
  const overflowNormalized = await normalizeToolResultOverflow({
    call,
    toolResultText,
    runtime,
    agentContext,
    sessionId,
  });
  toolResultText = overflowNormalized.toolResultText;
  emitEvent(eventListener, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(toolResultText).slice(0, 200),
    success: failureState.success,
  });
  await runAgentRuntimeHook({
    runtime,
    point: AGENT_HOOK_POINTS.AFTER_TOOL_CALL,
    context: buildHookContext(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, runtime, {
      phase: "tool_call",
      executionScope,
      turn,
      status: failureState.success ? "success" : "error",
      startedAt: toolStartedAt,
      endedAt: new Date(Date.now()).toISOString(),
      durationMs: Date.now() - toolStartedAtMs,
      call,
      toolName: call?.name || "",
      args: call?.args || {},
      success: failureState.success,
      failureReason: failureState.reason || "",
      toolResultText,
      agentContext,
    }),
  });
  const normalizedExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name,
    toolResultText,
  );
  return {
    call,
    toolResultText,
    extractedAttachmentMetas: normalizedExtractedAttachmentMetas.length
      ? normalizedExtractedAttachmentMetas
      : rawExtractedAttachmentMetas,
    success: failureState.success,
    failureReason: failureState.reason,
  };
}
