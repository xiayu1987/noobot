/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { emitMessageEvent } from "../../events/message-event-stream.js";
import { isFatalError } from "../../shared/errors/index.js";
import {
  parseToolOutputArtifacts,
  stripToolOutputArtifacts,
  projectToolResultForModel,
  toToolJsonResult,
} from "../../tools/core/tool-json-result.js";
import {
  assertNotAborted,
  isAbortError,
  raceWithAbort,
  resolveAbortStopType,
  resolveErrorMessage,
} from "../../shared/utils/error-utils.js";
import { parseJsonObjectSafely } from "../utils/json-utils.js";
import { handleEngineError } from "../errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import { resolveExecutionAbortMessage } from "@noobot/session-protocol/execution-abort";
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
  TRANSFER_REASON,
} from "@noobot/semantic-transfer-protocol";
import { registerTransferAttachmentResources } from "../../tools/core/resource-broker.js";
import {
  createToolRiskAssessment,
  getToolRiskLevel,
  runWithToolRiskAssessment,
} from "../../tools/execution/tool-risk.js";
import { isPlainObject, text } from "@noobot/shared/value";

function shouldTransferToolInput(call = {}) {
  const toolName = text(call?.name);
  return Boolean(toolName) && hasToolInputPolicy(toolName);
}

function toolProducer(call = {}) {
  const id = text(call?.id);
  if (!id) throw new Error("semantic_transfer_tool_call_id_required");
  return { type: "tool", id };
}

function mergeToolInputTransferPayload(toolResultText = "", transferPayload = {}) {
  const normalizedTransferPayload = isPlainObject(transferPayload) ? transferPayload : {};
  if (!Object.keys(normalizedTransferPayload).length) return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    ...parsed,
    ...normalizedTransferPayload,
  });
}

function mergeTaskSummaryTransferPayload(toolResultText = "", transferPayload = {}) {
  const normalizedTransferPayload = isPlainObject(transferPayload) ? transferPayload : {};
  if (!Object.keys(normalizedTransferPayload).length) return String(toolResultText || "");
  const parsed = parseJsonObjectSafely(toolResultText);
  if (!parsed) return String(toolResultText || "");
  return JSON.stringify({
    toolName: parsed.toolName || "task_summary",
    ok: parsed.ok !== false,
    status: parsed.status,
    code: parsed.code,
    error: parsed.error,
    details: parsed.details,
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
  if (text(toolName) === "task_summary") {
    return mergeTaskSummaryTransferPayload(toolResultText, transferPayload);
  }
  return mergeToolInputTransferPayload(toolResultText, transferPayload);
}

function compactSemanticTransferProtocolPayload(inputTransfer = {}) {
  if (!isPlainObject(inputTransfer)) return {};
  const transferEnvelopes = Array.isArray(inputTransfer.transferEnvelopes)
    ? inputTransfer.transferEnvelopes
    : [];
  return {
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

function transferEnvelopesFromStructuredResult(rawResult = null) {
  const value = typeof rawResult === "string" ? parseJsonObjectSafely(rawResult) : rawResult;
  if (!isPlainObject(value)) return [];
  return Array.isArray(value.transferEnvelopes) ? value.transferEnvelopes : [];
}

function resourceRefsFromResult(value = null) {
  const parsed = typeof value === "string" ? parseJsonObjectSafely(value) : value;
  if (!isPlainObject(parsed)) return [];
  return [
    ...(Array.isArray(parsed.resources) ? parsed.resources : []),
    ...(Array.isArray(parsed.input_resources) ? parsed.input_resources : []),
  ];
}

async function materializeToolOutputArtifacts({
  rawResult = null,
  toolResultText = "",
  call = {},
  runtime = {},
  identity = null,
} = {}) {
  const rawArtifacts = parseToolOutputArtifacts(rawResult);
  if (!rawArtifacts.length) return { toolResultText, transferEnvelopes: [] };
  if (!identity) throw new Error("semantic_transfer_identity_required");
  const toolName = text(call?.name);
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
        ? text(artifact.contentBase64)
        : Buffer.from(String(artifact.content || ""), "utf8").toString("base64");
    return { name, mimeType, contentBase64 };
  });
  const persisted = await persistTransferArtifacts({
    runtime,
    artifacts,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: `${toolName}_output`,
    source: "tool",
    reason: TRANSFER_REASON.TOOL_OUTPUT_ARTIFACT,
    identity,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.TOOL_OUTPUT_ARTIFACT,
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

function deriveToolInputTransferMeta(inputTransfer) {
  const attributes = inputTransfer.transferEnvelopes
    .map((envelope) => envelope.meta.attributes)
    .find((meta) => isPlainObject(meta?.toolInputOverflow));
  if (!attributes) return { exceeded: false, message: "", toolInputOverflow: null };
  return {
    exceeded: attributes.exceeded === true,
    message: text(attributes.toolInputOverflow.message),
    toolInputOverflow: attributes.toolInputOverflow,
  };
}

function detectToolCallFailure({ rawResult, toolResultText = "", invokeError = null }) {
  if (invokeError) {
    return { success: false, reason: "invoke_error" };
  }
  if (isPlainObject(rawResult)) {
    if (rawResult.ok === false) return { success: false, reason: "result_ok_false" };
    return { success: true, reason: "" };
  }
  const parsed = parseJsonObjectSafely(toolResultText);
  if (parsed && parsed.ok === false) {
    return { success: false, reason: "result_ok_false" };
  }
  return { success: true, reason: "" };
}

function createToolCallExecutionState({
  call,
  tool,
  turn,
  executionScope,
  errorLogger,
  runtime,
  agentContext,
  abortSignal,
}) {
  const toolStartedAtMs = Date.now();
  return {
    call,
    tool,
    turn,
    executionScope,
    errorLogger,
    identity: getSessionIdsFromAgentContext(agentContext),
    runtime,
    agentContext,
    abortSignal,
    toolStartedAtMs,
    toolStartedAt: new Date(toolStartedAtMs).toISOString(),
    riskAssessment: createToolRiskAssessment(call),
    toolResultText: "",
    rawResult: null,
    rawToolResultText: "",
    inputTransfer: null,
    toolInputTransferPayload: {},
    outputArtifactTransferEnvelopes: [],
    invokeError: null,
  };
}

function toolHookContext(state, point, fields = {}) {
  return buildHookContext(point, state.runtime, {
    phase: "tool_call",
    executionScope: state.executionScope,
    turn: state.turn,
    startedAt: state.toolStartedAt,
    call: state.call,
    toolName: text(state.call.name),
    agentContext: state.agentContext,
    ...fields,
  });
}

async function runToolHook(state, point, fields = {}) {
  await runAgentRuntimeHook({
    runtime: state.runtime,
    point,
    context: toolHookContext(state, point, fields),
  });
}

function completedToolTiming(state) {
  return {
    endedAt: new Date(Date.now()).toISOString(),
    durationMs: Date.now() - state.toolStartedAtMs,
  };
}

function projectToolExecutionResult(state, fields = {}) {
  return {
    call: state.call,
    toolResultText: state.toolResultText,
    riskLevel: getToolRiskLevel(state.riskAssessment),
    securityAssessment: state.riskAssessment.current,
    ...fields,
  };
}

async function completeMissingTool(state) {
  state.toolResultText = toToolJsonResult(state.call?.name, {
    ok: false,
    status: "failed",
    code: ERROR_CODE.RECOVERABLE_TOOL_NOT_FOUND,
    error: `tool not found: ${state.call?.name}`,
  });
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.ERROR,
    ...completedToolTiming(state),
    success: false,
    failureReason: "tool_not_found",
    toolResultText: state.toolResultText,
  });
  return projectToolExecutionResult(state, {
    transferEnvelopes: [],
    success: false,
    failureReason: "tool_not_found",
  });
}

function hasDeclaredToolInputOverflow(meta = {}) {
  return meta.exceeded === true && isPlainObject(meta.toolInputOverflow);
}

async function completeToolInputOverflow(state, meta) {
  state.toolResultText = compactToolResultTextForModel(
    toToolJsonResult(state.call?.name, {
      ok: false,
      message: meta.message,
      toolInputOverflow: meta.toolInputOverflow,
      ...state.toolInputTransferPayload,
    }),
  );
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.SUCCESS,
    ...completedToolTiming(state),
    args: state.call?.args || {},
    success: true,
    failureReason: "",
    toolResultText: state.toolResultText,
  });
  return projectToolExecutionResult(state, {
    transferEnvelopes: state.inputTransfer.transferEnvelopes || [],
    success: true,
    failureReason: "",
  });
}

async function prepareToolInputTransfer(state) {
  if (!shouldTransferToolInput(state.call)) return null;
  const producer = toolProducer(state.call);
  state.inputTransfer = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: state.call,
    runtime: state.runtime,
    identity: resolveRuntimeTransferIdentity({
      runtime: state.runtime,
      producer,
      direction: "input",
      strategy: "tool_input",
    }),
  });
  const meta = deriveToolInputTransferMeta(state.inputTransfer);
  state.toolInputTransferPayload = compactSemanticTransferProtocolPayload(state.inputTransfer);
  return hasDeclaredToolInputOverflow(meta) ? completeToolInputOverflow(state, meta) : null;
}

function toolInvocationConfig(state) {
  const producer = toolProducer(state.call);
  return {
    configurable: {
      transferIdentity: resolveRuntimeTransferIdentity({
        runtime: state.runtime,
        producer,
        direction: "output",
        strategy: text(state.call?.name) || "tool_output",
      }),
      noobotHookContext: toolHookContext(state, HOOK_POINT.AGENT.BEFORE_TOOL_CALL, {
        status: HOOK_PHASE_STATUS.RUNNING,
        args: state.call?.args || {},
      }),
    },
    signal: state.abortSignal,
  };
}

async function sanitizeToolOutput(state) {
  if (!state.runtime.systemRuntime.config.sanitizeOutput) return;
  state.toolResultText = await sanitizeToolResultText(state.toolResultText);
}

async function materializeToolInvocationResult(state) {
  state.toolResultText =
    typeof state.rawResult === "string" ? state.rawResult : JSON.stringify(state.rawResult);
  state.toolResultText = mergeToolResultWithInputTransferPayload(
    state.toolResultText,
    state.toolInputTransferPayload,
    state.call?.name,
  );
  const producer = toolProducer(state.call);
  const materializedOutput = await materializeToolOutputArtifacts({
    rawResult: state.rawResult,
    toolResultText: state.toolResultText,
    call: state.call,
    runtime: state.runtime,
    identity: resolveRuntimeTransferIdentity({
      runtime: state.runtime,
      producer,
      direction: "output",
      strategy: "tool_output_artifact",
    }),
  });
  state.toolResultText = materializedOutput.toolResultText;
  state.outputArtifactTransferEnvelopes = materializedOutput.transferEnvelopes;
  if (state.outputArtifactTransferEnvelopes.length) {
    state.toolResultText = mergeToolInputTransferPayload(state.toolResultText, {
      transferEnvelopes: state.outputArtifactTransferEnvelopes,
    });
  }
  state.rawToolResultText = state.toolResultText;
  await sanitizeToolOutput(state);
}

function logRecoverableToolError(state, error) {
  if (!state.errorLogger || typeof state.errorLogger.log !== "function") return;
  const normalizedCause =
    typeof error?.cause === "string" ? error.cause : error?.cause?.message || "";
  void state.errorLogger.log({
    userId: state.identity.userId,
    sessionId: state.identity.sessionId,
    parentSessionId: state.identity.parentSessionId,
    source: "tool-runner",
    event: "tool_invoke_error",
    error,
    extra: {
      toolName: text(state.call.name),
      dialogProcessId: state.identity.dialogProcessId,
      turnScopeId: state.identity.turnScopeId,
      executionId: state.identity.runId,
      toolCallId: text(state.call?.id),
      ...(normalizedCause ? { cause: normalizedCause } : {}),
    },
  });
}

function reportToolInvocationError(state, error) {
  handleEngineError({
    error,
    abortSignal: state.abortSignal,
    eventListener: state.runtime.eventListener,
    event: "tool_call_error",
    metadata: {
      source: "tool-runner",
      turn: state.turn,
      tool: text(state.call?.name),
      toolCallId: text(state.call?.id),
      sessionId: state.identity.sessionId,
      parentSessionId: normalizeParentSessionId(state.identity.parentSessionId),
    },
  });
}

function recoverableToolErrorResult(call, error) {
  const details = error?.details && typeof error.details === "object" ? error.details : null;
  return toToolJsonResult(call?.name, {
    ok: false,
    status: "failed",
    code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR),
    error: error?.message || String(error),
    ...(details ? { details } : {}),
  });
}

async function handleToolInvocationError(state, error) {
  const isAbort = isAbortError(error);
  const isFatal = isFatalError(error);
  reportToolInvocationError(state, error);
  if (isAbort || isFatal) throw error;
  await runToolHook(state, HOOK_POINT.AGENT.TOOL_CALL_ERROR, {
    status: HOOK_PHASE_STATUS.ERROR,
    ...completedToolTiming(state),
    args: state.call?.args || {},
    error,
  });
  state.invokeError = error;
  state.toolResultText = recoverableToolErrorResult(state.call, error);
  state.rawToolResultText = state.toolResultText;
  await sanitizeToolOutput(state);
  logRecoverableToolError(state, error);
}

async function invokeConfiguredTool(state) {
  try {
    await raceWithAbort(
      (async () => {
        state.rawResult = await runWithToolRiskAssessment(state.riskAssessment, () =>
          state.tool.invoke(state.call?.args || {}, toolInvocationConfig(state)),
        );
        await materializeToolInvocationResult(state);
      })(),
      state.abortSignal,
    );
  } catch (error) {
    await handleToolInvocationError(state, error);
  }
}

function uniqueByField(items, field) {
  return Array.from(new Map(items.map((item) => [item[field], item])).values());
}

async function finalizeToolExecution(state) {
  const failureState = detectToolCallFailure({
    rawResult: state.rawResult,
    toolResultText: state.rawToolResultText,
    invokeError: state.invokeError,
  });
  const structuredTransferEnvelopes = transferEnvelopesFromStructuredResult(state.rawResult);
  const producer = toolProducer(state.call);
  const overflowNormalized = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call: state.call,
    toolResultText: state.toolResultText,
    runtime: state.runtime,
    identity: resolveRuntimeTransferIdentity({
      runtime: state.runtime,
      producer,
      direction: "output",
      strategy: "tool_result_text",
    }),
  });
  state.toolResultText = overflowNormalized.toolResultText;
  if (text(state.call?.name) === "task_summary") {
    state.toolResultText = mergeTaskSummaryTransferPayload(
      state.toolResultText,
      state.toolInputTransferPayload,
    );
  }
  const transferEnvelopes = uniqueByField(
    [
      ...(state.toolInputTransferPayload.transferEnvelopes || []),
      ...structuredTransferEnvelopes,
      ...state.outputArtifactTransferEnvelopes,
      ...(overflowNormalized.transferEnvelopes || []),
    ],
    "transferId",
  );
  const internalResources = uniqueByField(
    [
      ...resourceRefsFromResult(state.rawToolResultText),
      ...registerTransferAttachmentResources({
        agentContext: state.agentContext,
        transferEnvelopes,
      }),
    ],
    "resourceId",
  );
  state.toolResultText = projectToolResultForModel(state.toolResultText);
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: failureState.success ? HOOK_PHASE_STATUS.SUCCESS : HOOK_PHASE_STATUS.ERROR,
    ...completedToolTiming(state),
    args: state.call?.args || {},
    success: failureState.success,
    failureReason: failureState.reason || "",
    toolResultText: state.rawToolResultText,
    internalResources,
  });
  return projectToolExecutionResult(state, {
    internalResources,
    transferEnvelopes,
    success: failureState.success,
    failureReason: failureState.reason,
  });
}

export async function executeToolCall(options) {
  const state = createToolCallExecutionState(options);
  if (!state.tool) return completeMissingTool(state);
  await runToolHook(state, HOOK_POINT.AGENT.BEFORE_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.RUNNING,
    args: state.call?.args || {},
  });
  const terminalInputResult = await prepareToolInputTransfer(state);
  if (terminalInputResult) return terminalInputResult;
  await invokeConfiguredTool(state);
  return finalizeToolExecution(state);
}

function createTurnToolExecutionContext({ call, runtime, turn, abortSignal }) {
  return {
    call,
    runtime,
    eventListener: runtime.eventListener,
    turn,
    toolCallId: text(call.id),
    abortSignal,
  };
}

function transferEnvelopeEventFields(result = {}) {
  const transferEnvelopes = Array.isArray(result.transferEnvelopes) ? result.transferEnvelopes : [];
  return transferEnvelopes.length ? { transferEnvelopes } : {};
}

export async function executeToolCallInTurn(options) {
  const { call, runtime, eventListener, turn, toolCallId, abortSignal } =
    createTurnToolExecutionContext(options);
  const initialRiskAssessment = createToolRiskAssessment(call);
  const initialRiskLevel = getToolRiskLevel(initialRiskAssessment);
  await emitMessageEvent(eventListener, runtime, "tool_call_start", {
    turn,
    tool: call?.name,
    args: call?.args || {},
    toolCallId,
    riskLevel: initialRiskLevel,
    securityAssessment: initialRiskAssessment.current,
  });
  assertNotAborted(abortSignal);
  const result = await executeToolCall(options);
  await emitMessageEvent(eventListener, runtime, "tool_call_end", {
    turn,
    tool: call?.name,
    result: String(result?.toolResultText || ""),
    success: result?.success === true,
    toolCallId,
    riskLevel: result?.riskLevel,
    securityAssessment: result?.securityAssessment,
    ...transferEnvelopeEventFields(result),
  });
  return result;
}

function rejectedToolCallResult({ call, error, abortSignal }) {
  const riskAssessment = createToolRiskAssessment(call);
  const aborted = isAbortError(error, abortSignal);
  const stopType = aborted ? resolveAbortStopType(error, abortSignal) : "";
  const errorMessage =
    (aborted ? resolveExecutionAbortMessage({ error, abortSignal }) : resolveErrorMessage(error)) ||
    (aborted ? "tool execution aborted" : "tool execution failed");
  return {
    call,
    toolResultText: toToolJsonResult(call?.name, {
      ok: false,
      status: aborted ? "aborted" : "failed",
      code: aborted
        ? ERROR_CODE.RECOVERABLE_USER_CANCELLED
        : String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR),
      error: errorMessage,
      ...(stopType ? { stopType } : {}),
    }),
    internalResources: [],
    transferEnvelopes: [],
    success: false,
    failureReason: aborted ? "aborted" : "invoke_error",
    riskLevel: getToolRiskLevel(riskAssessment),
    securityAssessment: riskAssessment.current,
  };
}

export async function settleToolCallInTurn(options) {
  const { call, runtime, eventListener, turn, toolCallId, abortSignal } =
    createTurnToolExecutionContext(options);
  try {
    return {
      status: "fulfilled",
      result: await executeToolCallInTurn(options),
      error: null,
    };
  } catch (error) {
    const result = rejectedToolCallResult({
      call,
      error,
      abortSignal,
    });
    await emitMessageEvent(eventListener, runtime, "tool_call_end", {
      turn,
      tool: call?.name,
      result: result.toolResultText,
      success: false,
      toolCallId,
      riskLevel: result.riskLevel,
      securityAssessment: result.securityAssessment,
    });
    return {
      status: "rejected",
      result,
      error,
    };
  }
}
