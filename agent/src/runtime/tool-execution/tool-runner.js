/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { ToolInputParsingException } from "@langchain/core/tools";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { emitEvent } from "../../events/index.js";
import { emitMessageEvent } from "../../events/message-event-stream.js";
import { isFatalError, NoobotError, recoverableToolError } from "../../shared/errors/index.js";
import {
  parseToolOutputArtifacts,
  stripToolOutputArtifacts,
  toToolJsonResult,
} from "../../tools/core/tool-json-result.js";
import {
  assertNotAborted,
  isAbortError,
  raceWithAbort,
  resolveErrorMessage,
} from "../../shared/utils/error-utils.js";
import {
  assertToolResultObject,
  decodeToolResultText,
  encodeToolResultObject,
} from "@noobot/event-protocol/tool-result";
import { handleEngineError } from "../errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { buildHookContext } from "../hooks/hook-context-builder.js";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortReason,
} from "@noobot/session-protocol/execution-abort";
import {
  resolveRuntimeTransferIdentity,
  persistTransferArtifacts,
  transferSemanticContent,
} from "../../transfer-adapter/index.js";
import { sanitizeToolResultText } from "@noobot/sanitize";
import {
  getToolOutputPolicy,
  hasToolInputPolicy,
  mergeTransferEnvelopes,
  TRANSFER_REASON,
} from "@noobot/semantic-transfer-protocol";
import {
  createToolRiskAssessment,
  getToolRiskLevel,
  runWithToolRiskAssessment,
} from "../../tools/execution/tool-risk.js";
import { isPlainObject, text } from "@noobot/shared/value";
import { projectMutationRefs } from "@noobot/file-mutation-protocol";
import { repairToolCallArgs } from "./tool-args-repair.js";
import { validateRuntimeToolCall } from "@noobot/context-protocol/tool/context-policy";
import { assertToolCallTiming } from "@noobot/event-protocol/tool-timing";

function shouldTransferToolInput(call) {
  const toolName = text(call.name);
  return Boolean(toolName) && hasToolInputPolicy(toolName);
}

function toolProducer(call) {
  const id = text(call.id);
  if (!id) throw new Error("semantic_transfer_tool_call_id_required");
  return { type: "tool", id };
}

function transferEnvelopesFromResultObject(resultObject) {
  if (!isPlainObject(resultObject) || resultObject.transferEnvelopes === undefined) return [];
  if (!Array.isArray(resultObject.transferEnvelopes)) {
    throw new TypeError("tool result transferEnvelopes must be an array");
  }
  return resultObject.transferEnvelopes;
}

function outputResourcesFromResultObject(resultObject) {
  if (!isPlainObject(resultObject) || resultObject.outputResources === undefined) return [];
  if (!Array.isArray(resultObject.outputResources)) {
    throw new TypeError("tool result outputResources must be an array");
  }
  return resultObject.outputResources;
}

function decodeToolInvocationResult(rawResult) {
  return typeof rawResult === "string"
    ? decodeToolResultText(rawResult)
    : assertToolResultObject(rawResult);
}

function withTransferEnvelopes(resultObject, ...envelopeLists) {
  const transferEnvelopes = mergeTransferEnvelopes(
    transferEnvelopesFromResultObject(resultObject),
    ...envelopeLists,
  );
  if (!transferEnvelopes.length) return resultObject;
  return { ...resultObject, transferEnvelopes };
}

async function materializeToolOutputArtifacts({ resultObject, call, runtime, identity }) {
  const rawArtifacts = parseToolOutputArtifacts(resultObject);
  if (!rawArtifacts.length) return { resultObject, transferEnvelopes: [] };
  if (!identity) throw new Error("semantic_transfer_identity_required");
  const toolName = text(call.name);
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
    resultObject: stripToolOutputArtifacts(resultObject),
    transferEnvelopes: persisted.transferEnvelopes,
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

function detectToolCallFailure({ resultObject, invokeError }) {
  if (invokeError) {
    return { success: false, reason: "invoke_error" };
  }
  if (resultObject?.ok === false) {
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
  toolStartedAtMs,
  executionTiming,
}) {
  if (!Number.isFinite(toolStartedAtMs)) {
    throw new TypeError(`tool call ${text(call.id)} requires toolStartedAtMs`);
  }
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
    executionTiming,
    toolStartedAt: new Date(toolStartedAtMs).toISOString(),
    riskAssessment: createToolRiskAssessment(call),
    toolResultText: "",
    rawResult: null,
    rawToolResultText: "",
    inputTransfer: null,
    inputTransferEnvelopes: [],
    outputArtifactTransferEnvelopes: [],
    resultObject: null,
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
  const endedAtMs = Date.now();
  return {
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - state.toolStartedAtMs,
  };
}

function projectToolExecutionResult(state, timing, fields) {
  return {
    call: state.call,
    toolResultText: state.toolResultText,
    riskLevel: getToolRiskLevel(state.riskAssessment),
    securityAssessment: state.riskAssessment.current,
    durationMs: timing.durationMs,
    ...fields,
  };
}

async function completeMissingTool(state) {
  state.toolResultText = toToolJsonResult(state.call.name, {
    ok: false,
    code: ERROR_CODE.RECOVERABLE_TOOL_NOT_FOUND,
    error: `tool not found: ${state.call.name}`,
  });
  const timing = completedToolTiming(state);
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.ERROR,
    ...timing,
    success: false,
    failureReason: "tool_not_found",
    toolResultText: state.toolResultText,
  });
  return projectToolExecutionResult(state, timing, {
    transferEnvelopes: [],
    resourceRefs: [],
    mutationRefs: [],
    success: false,
    failureReason: "tool_not_found",
  });
}

function hasDeclaredToolInputOverflow(meta = {}) {
  return meta.exceeded === true && isPlainObject(meta.toolInputOverflow);
}

async function completeToolInputOverflow(state, meta) {
  state.toolResultText = toToolJsonResult(state.call.name, {
    ok: false,
    code: ERROR_CODE.RECOVERABLE_TOOL_INPUT_OVERFLOW,
    error: meta.message,
    toolInputOverflow: meta.toolInputOverflow,
    ...(state.inputTransferEnvelopes.length
      ? { transferEnvelopes: state.inputTransferEnvelopes }
      : {}),
  });
  const timing = completedToolTiming(state);
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.ERROR,
    ...timing,
    args: state.call.args,
    success: false,
    failureReason: "tool_input_overflow",
    toolResultText: state.toolResultText,
  });
  return projectToolExecutionResult(state, timing, {
    transferEnvelopes: state.inputTransferEnvelopes,
    resourceRefs: [],
    mutationRefs: [],
    success: false,
    failureReason: "tool_input_overflow",
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
  state.inputTransferEnvelopes = state.inputTransfer.transferEnvelopes;
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
        strategy: state.call.name,
      }),
      noobotHookContext: toolHookContext(state, HOOK_POINT.AGENT.BEFORE_TOOL_CALL, {
        status: HOOK_PHASE_STATUS.RUNNING,
        args: state.call.args,
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
  state.resultObject = decodeToolInvocationResult(state.rawResult);
  const producer = toolProducer(state.call);
  const materializedOutput = await materializeToolOutputArtifacts({
    resultObject: state.resultObject,
    call: state.call,
    runtime: state.runtime,
    identity: resolveRuntimeTransferIdentity({
      runtime: state.runtime,
      producer,
      direction: "output",
      strategy: "tool_output_artifact",
    }),
  });
  state.outputArtifactTransferEnvelopes = materializedOutput.transferEnvelopes;
  state.toolResultText = encodeToolResultObject(
    withTransferEnvelopes(
      materializedOutput.resultObject,
      state.inputTransferEnvelopes,
      state.outputArtifactTransferEnvelopes,
    ),
  );
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
      toolCallId: text(state.call.id),
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
      tool: text(state.call.name),
      toolCallId: text(state.call.id),
      sessionId: state.identity.sessionId,
      parentSessionId: normalizeParentSessionId(state.identity.parentSessionId),
    },
  });
}

function recoverableToolErrorResult(call, error) {
  const details =
    isPlainObject(error.details) && Object.keys(error.details).length ? error.details : null;
  return toToolJsonResult(call.name, {
    ok: false,
    code: error.code,
    error: error.message,
    ...(details ? { details } : {}),
  });
}

function toRecoverableInvocationError(error) {
  if (error instanceof NoobotError) return error;
  if (error instanceof ToolInputParsingException) {
    return recoverableToolError(error.message, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      cause: error,
    });
  }
  const ownCode = typeof error?.code === "string" ? error.code.trim() : "";
  return recoverableToolError(resolveErrorMessage(error) || String(error), {
    code: ownCode || ERROR_CODE.RECOVERABLE_TOOL_INVOKE_ERROR,
    ...(isPlainObject(error?.details) ? { details: error.details } : {}),
    cause: error,
  });
}

async function handleToolInvocationError(state, error) {
  if (isAbortError(error, state.abortSignal) || isFatalError(error)) {
    reportToolInvocationError(state, error);
    throw error;
  }
  const recoverableError = toRecoverableInvocationError(error);
  reportToolInvocationError(state, recoverableError);
  await runToolHook(state, HOOK_POINT.AGENT.TOOL_CALL_ERROR, {
    status: HOOK_PHASE_STATUS.ERROR,
    ...completedToolTiming(state),
    args: state.call.args,
    error: recoverableError,
  });
  state.invokeError = recoverableError;
  state.toolResultText = recoverableToolErrorResult(state.call, recoverableError);
  state.rawToolResultText = state.toolResultText;
  await sanitizeToolOutput(state);
  logRecoverableToolError(state, error);
}

async function invokeConfiguredTool(state) {
  try {
    const startedAt = performance.now();
    try {
      state.rawResult = await raceWithAbort(
        runWithToolRiskAssessment(state.riskAssessment, () =>
          state.tool.invoke(state.call.args, toolInvocationConfig(state)),
        ),
        state.abortSignal,
      );
    } finally {
      state.executionTiming.executionMs = performance.now() - startedAt;
    }
    await raceWithAbort(materializeToolInvocationResult(state), state.abortSignal);
  } catch (error) {
    await handleToolInvocationError(state, error);
  }
}

function uniqueByField(items, field) {
  return Array.from(new Map(items.map((item) => [item[field], item])).values());
}

async function finalizeToolExecution(state) {
  const failureState = detectToolCallFailure({
    resultObject: state.resultObject,
    invokeError: state.invokeError,
  });
  const structuredTransferEnvelopes = transferEnvelopesFromResultObject(state.resultObject);
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
  const transferEnvelopes = mergeTransferEnvelopes(
    state.inputTransferEnvelopes,
    structuredTransferEnvelopes,
    state.outputArtifactTransferEnvelopes,
    overflowNormalized.transferEnvelopes,
  );
  const resourceRefs = uniqueByField(
    outputResourcesFromResultObject(state.resultObject),
    "resourceId",
  );

  const mutationRefs = failureState.success ? projectMutationRefs(state.resultObject) : [];
  const timing = completedToolTiming(state);
  await runToolHook(state, HOOK_POINT.AGENT.AFTER_TOOL_CALL, {
    status: failureState.success ? HOOK_PHASE_STATUS.SUCCESS : HOOK_PHASE_STATUS.ERROR,
    ...timing,
    args: state.call.args,
    success: failureState.success,
    failureReason: failureState.reason || "",
    toolResultText: state.rawToolResultText,
    resourceRefs,
    mutationRefs,
  });
  return projectToolExecutionResult(state, timing, {
    resourceRefs,
    mutationRefs,
    transferEnvelopes,
    success: failureState.success,
    failureReason: failureState.reason,
  });
}

export async function executeToolCall(options) {
  validateRuntimeToolCall(options.call);
  return executeValidatedToolCall({ ...options, executionTiming: { executionMs: 0 } });
}

async function executeValidatedToolCall(options) {
  const state = createToolCallExecutionState(options);
  if (!state.tool) return completeMissingTool(state);
  await runToolHook(state, HOOK_POINT.AGENT.BEFORE_TOOL_CALL, {
    status: HOOK_PHASE_STATUS.RUNNING,
    args: state.call.args,
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

function toolFactEventFields({ transferEnvelopes, resourceRefs, mutationRefs }) {
  return {
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
    ...(resourceRefs.length ? { resourceRefs } : {}),
    ...(mutationRefs.length ? { mutationRefs } : {}),
  };
}

function normalizeToolCallOptions(options) {
  const { call, tool, runtime } = options;
  validateRuntimeToolCall(call);
  if (!tool) return options;
  const repaired = repairToolCallArgs(tool.schema, call.args);
  if (!repaired) return options;
  emitEvent(runtime.eventListener, "tool_args_repaired", {
    turn: options.turn,
    tool: text(call.name),
    toolCallId: text(call.id),
    repairs: repaired.repairs,
  });
  return { ...options, call: { ...call, args: repaired.args } };
}

export async function startToolCallInTurn(rawOptions) {
  const options = {
    ...normalizeToolCallOptions(rawOptions),
    toolStartedAtMs: Date.now(),
    startedAt: performance.now(),
    executionTiming: { executionMs: 0 },
  };
  const { call, runtime, eventListener, turn, toolCallId } =
    createTurnToolExecutionContext(options);
  const initialRiskAssessment = createToolRiskAssessment(call);
  const initialRiskLevel = getToolRiskLevel(initialRiskAssessment);
  await emitMessageEvent(eventListener, runtime, "tool_call_start", {
    turn,
    tool: call.name,
    args: call.args,
    toolCallId,
    riskLevel: initialRiskLevel,
    securityAssessment: initialRiskAssessment.current,
  });
  return options;
}

async function runStartedToolCallInTurn(options) {
  assertNotAborted(options.abortSignal);
  return executeValidatedToolCall(options);
}

async function emitToolCallEnd(options, result) {
  const { call, runtime, eventListener, turn, toolCallId } =
    createTurnToolExecutionContext(options);
  await emitMessageEvent(eventListener, runtime, "tool_call_end", {
    turn,
    tool: call.name,
    result: result.toolResultText,
    success: result.success === true,
    durationMs: result.durationMs,
    toolCallId,
    riskLevel: result.riskLevel,
    securityAssessment: result.securityAssessment,
    ...toolFactEventFields(result),
  });
  return result;
}

export async function executeToolCallInTurn(options) {
  const started = await startToolCallInTurn(options);
  return emitToolCallEnd(started, await runStartedToolCallInTurn(started));
}

function rejectedToolCallResult({ call, error, abortSignal }) {
  const riskAssessment = createToolRiskAssessment(call);
  const aborted = isAbortError(error, abortSignal);
  const abortReason = aborted ? resolveExecutionAbortReason({ error, abortSignal }) : null;
  const invocationError = aborted ? null : toRecoverableInvocationError(error);
  const errorMessage = aborted
    ? resolveExecutionAbortMessage({ error, abortSignal })
    : invocationError.message;
  return {
    call,
    toolResultText: toToolJsonResult(call.name, {
      ok: false,
      status: aborted ? "aborted" : "failed",
      code: aborted ? ERROR_CODE.RECOVERABLE_USER_CANCELLED : invocationError.code,
      error: errorMessage,
      ...(abortReason ? { stopType: abortReason.type } : {}),
    }),
    resourceRefs: [],
    transferEnvelopes: [],
    mutationRefs: [],
    success: false,
    failureReason: aborted ? "aborted" : "invoke_error",
    riskLevel: getToolRiskLevel(riskAssessment),
    securityAssessment: riskAssessment.current,
  };
}

export async function settleStartedToolCallInTurn(options) {
  const { call, eventListener, turn, toolCallId, abortSignal } =
    createTurnToolExecutionContext(options);
  const { toolStartedAtMs, startedAt, executionTiming } = options;
  let settlement;
  try {
    const result = await runStartedToolCallInTurn(options);
    settlement = {
      status: "fulfilled",
      result,
      error: null,
    };
  } catch (error) {
    const result = rejectedToolCallResult({
      call,
      error,
      abortSignal,
    });
    result.durationMs = Date.now() - toolStartedAtMs;
    settlement = {
      status: "rejected",
      result,
      error,
    };
  }
  try {
    await emitToolCallEnd(options, settlement.result);
    const elapsedMs = performance.now() - startedAt;
    const timing = assertToolCallTiming({
      turn,
      tool: call.name,
      toolCallId,
      executionMs: executionTiming.executionMs,
      frameworkMs: elapsedMs - executionTiming.executionMs,
    });
    await emitEvent(eventListener, "tool_call_timing", timing);
  } catch (error) {
    if (settlement.status === "rejected") {
      throw new AggregateError(
        [settlement.error, error],
        "tool execution and settlement emission failed",
      );
    }
    throw error;
  }
  return settlement;
}
