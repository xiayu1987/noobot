/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { Buffer } from "node:buffer";
import {
  currentAssistantMessageId,
  emitMessageEvent,
} from "../../events/message-event-stream.js";
import { isFatalError } from "../../shared/errors/index.js";
import {
  parseToolOutputArtifacts,
  stripToolOutputArtifacts,
  toToolJsonResult,
} from "../../tools/core/tool-json-result.js";
import { isAbortError } from "../utils/error-utils.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { handleEngineError } from "../errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  resolveRuntimeTransferIdentity,
  persistTransferArtifacts,
  transferSemanticContent,
} from "../../transfer-adapter/index.js";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";
import { sanitizeToolResultText } from "@noobot/sanitize";
import {
  getToolOutputPolicy,
  hasToolInputPolicy,
} from "@noobot/semantic-transfer-protocol";

function shouldTransferToolInput(call = {}) {
  const toolName = String(call?.name || "").trim();
  return Boolean(toolName) && hasToolInputPolicy(toolName);
}

function toolProducer(call = {}) {
  const id = String(
    call?.id || call?.tool_call_id || call?.toolCallId || "",
  ).trim();
  if (!id) throw new Error("semantic_transfer_tool_call_id_required");
  return { type: "tool", id };
}

function mergeToolInputTransferPayload(
  toolResultText = "",
  transferPayload = {},
) {
  const normalizedTransferPayload =
    transferPayload &&
    typeof transferPayload === "object" &&
    !Array.isArray(transferPayload)
      ? transferPayload
      : {};
  if (!Object.keys(normalizedTransferPayload).length)
    return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    ...parsed,
    ...normalizedTransferPayload,
  });
}

function mergeTaskSummaryTransferPayload(
  toolResultText = "",
  transferPayload = {},
) {
  const normalizedTransferPayload =
    transferPayload &&
    typeof transferPayload === "object" &&
    !Array.isArray(transferPayload)
      ? transferPayload
      : {};
  if (!Object.keys(normalizedTransferPayload).length)
    return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    toolName: parsed.toolName || "task_summary",
    ok: parsed.ok !== false,
    status: parsed.status,
    message: parsed.message,
    protocolVersion: parsed.protocolVersion,
    summary: parsed.summary,
    summarizedMessages: parsed.summarizedMessages,
    ...normalizedTransferPayload,
  });
}

function mergeToolResultWithInputTransferPayload(
  toolResultText = "",
  transferPayload = {},
  toolName = "",
) {
  if (String(toolName || "").trim() === "task_summary") {
    return mergeTaskSummaryTransferPayload(toolResultText, transferPayload);
  }
  return mergeToolInputTransferPayload(toolResultText, transferPayload);
}

function compactSemanticTransferProtocolPayload(inputTransfer = {}) {
  if (
    !inputTransfer ||
    typeof inputTransfer !== "object" ||
    Array.isArray(inputTransfer)
  )
    return {};
  const transferEnvelopes = Array.isArray(inputTransfer.transferEnvelopes)
    ? inputTransfer.transferEnvelopes
    : [];
  return {
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function transferEnvelopesFromStructuredResult(rawResult = null) {
  const value =
    typeof rawResult === "string"
      ? parseJsonObjectSafely(rawResult)
      : rawResult;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Array.isArray(value.transferEnvelopes) ? value.transferEnvelopes : [];
}

async function materializeToolOutputArtifacts({
  rawResult = null,
  toolResultText = "",
  call = {},
  runtime = {},
  agentContext = null,
  identity = null,
} = {}) {
  const rawArtifacts = parseToolOutputArtifacts(rawResult);
  if (!rawArtifacts.length) return { toolResultText, transferEnvelopes: [] };
  if (!identity) throw new Error("semantic_transfer_identity_required");
  const toolName = String(call?.name || "").trim();
  const outputPolicy = getToolOutputPolicy(toolName);
  const artifacts = rawArtifacts.map((artifact = {}) => {
    if (artifact.type !== outputPolicy.type) {
      throw new Error(
        `semantic_transfer_tool_output_type_mismatch:${toolName}:${artifact.type}:${outputPolicy.type}`,
      );
    }
    const name = artifact.name;
    const mimeType = artifact.mimeType;
    const contentBase64 =
      artifact.type === "attachment_bytes"
        ? String(artifact.contentBase64 || "").trim()
        : Buffer.from(String(artifact.content || ""), "utf8").toString(
            "base64",
          );
    return { name, mimeType, contentBase64 };
  });
  const persisted = await persistTransferArtifacts({
    runtime,
    agentContext,
    userId: String(
      runtime?.userId || runtime?.systemRuntime?.userId || "",
    ).trim(),
    artifacts,
    attachmentSource: "model",
    generationSource: `${toolName}_output`,
    source: "tool",
    reason: "tool_output_artifact",
    identity,
    intent: {
      source: "tool",
      reason: "tool_output_artifact",
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { sourceTool: toolName },
  });
  return {
    toolResultText: stripToolOutputArtifacts(toolResultText),
    transferEnvelopes: Array.isArray(persisted?.transferEnvelopes)
      ? persisted.transferEnvelopes
      : [],
  };
}

function deriveToolInputTransferMeta(inputTransfer = {}) {
  const transferEnvelopes = Array.isArray(inputTransfer?.transferEnvelopes)
    ? inputTransfer.transferEnvelopes
    : [];
  const metas = transferEnvelopes
    .flatMap((envelope = {}) => [envelope?.meta, envelope?.meta?.attributes])
    .filter(
      (meta = null) => meta && typeof meta === "object" && !Array.isArray(meta),
    );
  const overflowMeta = metas.find((meta = {}) => meta?.toolInputOverflow);
  const exceededMeta = metas.find((meta = {}) => meta?.exceeded === true);
  const messageMeta = metas.find((meta = {}) =>
    String(meta?.message || "").trim(),
  );
  const sourceMeta =
    overflowMeta || exceededMeta || messageMeta || metas[0] || {};
  const toolInputOverflow =
    sourceMeta?.toolInputOverflow &&
    typeof sourceMeta.toolInputOverflow === "object" &&
    !Array.isArray(sourceMeta.toolInputOverflow)
      ? sourceMeta.toolInputOverflow
      : null;
  return {
    exceeded:
      sourceMeta?.exceeded === true || toolInputOverflow?.exceeded === true,
    message: String(
      sourceMeta?.message || toolInputOverflow?.message || "",
    ).trim(),
    toolInputOverflow,
  };
}

function resolveToolHookMeta(runtime = {}) {
  const plugins =
    runtime?.runConfig?.plugins && typeof runtime.runConfig.plugins === "object"
      ? runtime.runConfig.plugins
      : {};
  return { ...plugins, runtime };
}

function detectToolCallFailure({
  rawResult,
  toolResultText = "",
  invokeError = null,
}) {
  if (invokeError) {
    return { success: false, reason: "invoke_error" };
  }
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    if (rawResult.ok === false)
      return { success: false, reason: "result_ok_false" };
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
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.AFTER_TOOL_CALL,
      context: buildHookContext(HOOK_POINT.AGENT.AFTER_TOOL_CALL, runtime, {
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
      transferEnvelopes: [],
      success: false,
      failureReason: "tool_not_found",
    };
  }
  let rawResult = null;
  let rawToolResultText = "";
  let inputTransfer = null;
  let outputArtifactTransferEnvelopes = [];
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.BEFORE_TOOL_CALL, runtime, {
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
  let toolInputTransferPayload = {};
  if (shouldTransferToolInput(call)) {
    try {
      inputTransfer = await transferSemanticContent({
        scenario: "tool",
        strategy: "tool_input",
        call,
        runtime,
        agentContext,
        sessionId,
        producer: toolProducer(call),
        identity: resolveRuntimeTransferIdentity({
          runtime,
          agentContext,
          sessionId,
          producer: toolProducer(call),
          direction: "input",
          strategy: "tool_input",
        }),
      });
      const inputTransferMeta = deriveToolInputTransferMeta(inputTransfer);
      toolInputTransferPayload =
        compactSemanticTransferProtocolPayload(inputTransfer);
      if (
        inputTransferMeta.exceeded === true &&
        inputTransferMeta.toolInputOverflow &&
        typeof inputTransferMeta.toolInputOverflow === "object" &&
        !Array.isArray(inputTransferMeta.toolInputOverflow)
      ) {
        toolResultText = toToolJsonResult(call?.name, {
          ok: false,
          message: inputTransferMeta.message || "tool input is too long",
          toolInputOverflow: inputTransferMeta.toolInputOverflow,
          ...toolInputTransferPayload,
        });
        toolResultText = compactToolResultTextForModel(toolResultText);
        await runAgentRuntimeHook({
          runtime,
          point: HOOK_POINT.AGENT.AFTER_TOOL_CALL,
          context: buildHookContext(HOOK_POINT.AGENT.AFTER_TOOL_CALL, runtime, {
            phase: "tool_call",
            executionScope,
            turn,
            status: "success",
            startedAt: toolStartedAt,
            endedAt: new Date(Date.now()).toISOString(),
            durationMs: Date.now() - toolStartedAtMs,
            call,
            toolName: call?.name || "",
            args: call?.args || {},
            success: true,
            failureReason: "",
            toolResultText,
            agentContext,
          }),
        });
        return {
          call,
          toolResultText,
          transferEnvelopes: inputTransfer.transferEnvelopes || [],
          success: true,
          failureReason: "",
        };
      }
    } catch (error) {
      throw error;
    }
  }
  try {
    rawResult = await tool.invoke(call?.args || {}, {
      signal: abortSignal,
      configurable: {
        transferIdentity: resolveRuntimeTransferIdentity({
          runtime,
          agentContext,
          sessionId,
          producer: toolProducer(call),
          direction: "output",
          strategy: "execute_script",
        }),
        noobotHookContext: buildHookContext(
          HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
          runtime,
          {
            phase: "tool_call",
            executionScope,
            turn,
            status: "running",
            startedAt: toolStartedAt,
            call,
            toolName: call?.name || "",
            args: call?.args || {},
            agentContext,
          },
        ),
        noobotHookMeta: resolveToolHookMeta(runtime),
      },
    });
    toolResultText =
      typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    toolResultText = mergeToolResultWithInputTransferPayload(
      toolResultText,
      toolInputTransferPayload,
      call?.name,
    );
    const materializedOutput = await materializeToolOutputArtifacts({
      rawResult,
      toolResultText,
      call,
      runtime,
      agentContext,
      identity: resolveRuntimeTransferIdentity({
        runtime,
        agentContext,
        sessionId,
        producer: toolProducer(call),
        direction: "output",
        strategy: "tool_output_artifact",
      }),
    });
    toolResultText = materializedOutput.toolResultText;
    outputArtifactTransferEnvelopes = materializedOutput.transferEnvelopes;
    rawToolResultText = toolResultText;
    if (runtime?.systemRuntime?.config?.sanitizeOutput !== false) {
      toolResultText = await sanitizeToolResultText(toolResultText);
    }
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
        toolCallId: call?.id || call?.tool_call_id || call?.toolCallId || "",
        sessionId: String(sessionId || "").trim(),
        parentSessionId: normalizeParentSessionId(parentSessionId),
      },
    });
    if (isAbort || isFatal) throw error;
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.TOOL_CALL_ERROR,
      context: buildHookContext(HOOK_POINT.AGENT.TOOL_CALL_ERROR, runtime, {
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
      error?.details && typeof error.details === "object"
        ? error.details
        : null;
    toolResultText = toToolJsonResult(call?.name, {
      ok: false,
      status: "failed",
      code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR),
      error: error?.message || String(error),
      ...(errorDetails ? { details: errorDetails } : {}),
    });
    rawToolResultText = toolResultText;
    if (runtime?.systemRuntime?.config?.sanitizeOutput !== false) {
      toolResultText = await sanitizeToolResultText(toolResultText);
    }
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
  const structuredTransferEnvelopes =
    transferEnvelopesFromStructuredResult(rawResult);
  const overflowNormalized = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call,
    toolResultText,
    runtime,
    agentContext,
    sessionId,
    producer: toolProducer(call),
    identity: resolveRuntimeTransferIdentity({
      runtime,
      agentContext,
      sessionId,
      producer: toolProducer(call),
      direction: "output",
      strategy: "tool_result_text",
    }),
  });
  toolResultText = overflowNormalized.toolResultText;
  if (String(call?.name || "").trim() === "task_summary") {
    toolResultText = mergeTaskSummaryTransferPayload(
      toolResultText,
      toolInputTransferPayload,
    );
  }
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    context: buildHookContext(HOOK_POINT.AGENT.AFTER_TOOL_CALL, runtime, {
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
  const transferEnvelopes = [
    ...(toolInputTransferPayload.transferEnvelopes || []),
    ...structuredTransferEnvelopes,
    ...outputArtifactTransferEnvelopes,
    ...(overflowNormalized.transferEnvelopes || []),
  ];
  const uniqueTransferEnvelopes = Array.from(
    new Map(
      transferEnvelopes.map((envelope) => [envelope.transferId, envelope]),
    ).values(),
  );
  return {
    call,
    toolResultText,
    transferEnvelopes: uniqueTransferEnvelopes,
    success: failureState.success,
    failureReason: failureState.reason,
  };
}

export async function executeToolCallInTurn(options = {}) {
  const call =
    options?.call && typeof options.call === "object" ? options.call : {};
  const runtime =
    options?.runtime && typeof options.runtime === "object"
      ? options.runtime
      : {};
  const eventListener = options?.eventListener || null;
  const turn = Number(options?.turn || 1);
  const toolCallId = call?.id || call?.tool_call_id || call?.toolCallId || "";
  emitMessageEvent(eventListener, runtime, "tool_call_start", {
    turn,
    tool: call?.name,
    args: call?.args || {},
    toolCallId,
  });
  const result = await executeToolCall(options);
  emitMessageEvent(eventListener, runtime, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(result?.toolResultText || ""),
    success: result?.success === true,
    toolCallId,
    ...(Array.isArray(result?.transferEnvelopes) &&
    result.transferEnvelopes.length
      ? { transferEnvelopes: result.transferEnvelopes }
      : {}),
  });
  return result;
}
