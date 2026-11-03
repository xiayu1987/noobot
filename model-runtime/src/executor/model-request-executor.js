/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { summarizeDiagnosticMessages } from "@noobot/shared/message-diagnostics";
import {
  createModelRequest,
  createModelResponse,
  classifyModelFailure,
  MODEL_ATTEMPT_KIND,
  MODEL_ATTEMPT_STATUS,
  MODEL_INVOCATION_EVENT,
  MODEL_CONTEXT_TRACE,
  MODEL_OPERATION_KIND,
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  MODEL_RESPONSE_SOURCE,
  ModelProtocolError,
  normalizeRetryPolicy,
  NOOP_OBSERVATION_PORT,
  requireModelResponseSource,
  projectModelAttemptError,
  projectModelInvocationFailure,
  requireCredentialPort,
  requireObservationPort,
  requireOperationStreamingModes,
  SYSTEM_CLOCK_PORT,
} from "@noobot/model-protocol";
import { normalizeMessages } from "../normalization/message-normalizer.js";
import {
  normalizeModelOutput,
  normalizeModelResponse,
} from "../normalization/response-normalizer.js";
import { classifyReasoningOnly } from "../policies/reasoning-retry-policy.js";
import { classifyEmptyResponse } from "../policies/empty-response-retry-policy.js";
import { isToolCallStreamingMismatch } from "../policies/tool-call-retry-policy.js";
import { runModelAttempt } from "./attempt-runner.js";
import { executeTransportRetry } from "./retry-coordinator.js";
import { createProviderAdapterRegistry } from "../adapters/registry.js";
import {
  alternateStreamingMode,
  mayRetryWithAlternateStreaming,
  resolvePreferredStreaming,
  streamingProviderCacheKey,
} from "../policies/streaming-mode-policy.js";
import { text, isFunction } from "@noobot/shared/value";

function wrapStreamingCallbacks(callbacks, attemptState) {
  if (!Array.isArray(callbacks) || !callbacks.length) return callbacks;
  return callbacks.map((callback = {}) => ({
    ...callback,
    handleLLMNewToken: (...args) => {
      const token = String(args[0] || "");
      attemptState.streamedTokens += token.length;
      return callback.handleLLMNewToken?.(...args);
    },
    handleLLMEnd: (...args) => callback.handleLLMEnd?.(...args),
  }));
}

function projectObservableModel(model = {}) {
  return Object.freeze({
    alias: text(model.alias),
    model: text(model.model),
    operatorId: text(model.operatorId),
    modelFamily: text(model.modelFamily),
    adapterId: text(model.adapterId),
  });
}

function buildInvocationHeaders({
  model = {},
  invocation = {},
  operationKind = "",
  headers = {},
} = {}) {
  return {
    "X-Model-Name": text(model.model),
    "X-Model-Operation": operationKind,
    "X-Plugin-Flow": invocation.flow,
    "X-Plugin-Purpose": invocation.purpose,
    "X-Plugin-Domain": invocation.domain,
    ...(invocation.sessionId ? { "X-Plugin-Session-Id": invocation.sessionId } : {}),
    ...(invocation.parentSessionId ? { parentSessionid: invocation.parentSessionId } : {}),
    ...(headers || {}),
  };
}

export function createModelRequestExecutor({
  registry = createProviderAdapterRegistry(),
  credentialPort,
  observationPort = NOOP_OBSERVATION_PORT,
  clock = SYSTEM_CLOCK_PORT,
  clientDecorator = null,
  providerRuntime = {},
} = {}) {
  requireCredentialPort(credentialPort);
  requireObservationPort(observationPort);
  const modelObservationStates = new Map();
  const streamingModes = new Map();
  const resolveModelObservationState = (modelSpec = {}) => {
    const key = JSON.stringify([
      modelSpec.operatorId,
      modelSpec.adapterId,
      modelSpec.alias,
      modelSpec.model,
    ]);
    let state = modelObservationStates.get(key);
    if (!state) {
      state = { modelInstanceId: randomUUID(), sequence: 0 };
      modelObservationStates.set(key, state);
    }
    return state;
  };
  return Object.freeze({
    async invoke(input = {}) {
      const retry = normalizeRetryPolicy(input.policies?.retry);
      const messages = normalizeMessages(input.messages);
      let reasoningOnlyAttempts = 0;
      let emptyResponseAttempts = 0;
      let toolCallRecoveryAttempts = 0;
      let alternateStreamingAttempted = false;
      let totalAttempts = 0;
      const attempts = [];
      const requestBase = createModelRequest({ ...input, messages });
      const invocation = requestBase.invocation;
      const adapter = registry.resolve(requestBase.model);
      const streamingCacheKey = streamingProviderCacheKey({
        model: requestBase.model,
        operation: requestBase.operation,
        tools: requestBase.tools,
      });
      let streaming = resolvePreferredStreaming({
        requested: input.options?.streaming === true,
        cached: streamingModes.get(streamingCacheKey),
      });
      const modelObservationState = resolveModelObservationState(requestBase.model);
      const observableModel = projectObservableModel(requestBase.model);
      const classifications = new Map();
      const classify = (error) => {
        if (!classifications.has(error)) {
          classifications.set(
            error,
            classifyModelFailure(error, (value) => adapter.classifyError(value)),
          );
        }
        return classifications.get(error);
      };
      const observe = (type, payload = {}) =>
        observationPort.emit(type, { invocation, ...payload, model: observableModel });
      const isCancelled = (error) =>
        requestBase.options.signal?.aborted || classify(error).kind === MODEL_ERROR_KIND.ABORTED;
      const pushAttempt = ({ status, kind, attemptStreaming = streaming, output, error }) =>
        attempts.push({
          attempt: totalAttempts,
          status,
          kind,
          streaming: attemptStreaming,
          output,
          ...(error ? { error } : {}),
        });
      const recordFailedAttempt = (kind, error, attemptStreaming, output) => {
        if (isCancelled(error)) return;
        const classification = classify(error);
        pushAttempt({
          status: MODEL_ATTEMPT_STATUS.FAILED,
          kind,
          attemptStreaming,
          output,
          error: projectModelAttemptError({
            message: String(error?.message ?? error),
            code: text(error?.code) || null,
            ...classification,
          }),
        });
      };
      const recordingAttempt = async (kind, attemptStreaming, run) => {
        try {
          return await run();
        } catch (error) {
          recordFailedAttempt(kind, error, attemptStreaming);
          throw error;
        }
      };
      const failAttempt = (kind, error, output) => {
        recordFailedAttempt(kind, error, streaming, output);
        return error;
      };
      let terminalObservationEmitted = false;
      const observeTerminalError = (error) => {
        if (terminalObservationEmitted) return;
        terminalObservationEmitted = true;
        if (isCancelled(error)) {
          observe(MODEL_INVOCATION_EVENT.CANCELLED, { attemptCount: totalAttempts });
          return;
        }
        const classification = classify(error);
        observe(
          MODEL_INVOCATION_EVENT.FAILED,
          projectModelInvocationFailure({
            attemptCount: totalAttempts,
            message: String(error?.message ?? error),
            code: text(error?.code) || null,
            kind: classification.kind,
            classificationError: classification.classificationError,
            failedAttempts: attempts
              .filter(({ status }) => status === MODEL_ATTEMPT_STATUS.FAILED)
              .map(({ attempt, kind, error: attemptError }) => ({
                attempt,
                kind,
                error: attemptError,
              })),
          }),
        );
      };
      const respond = (output, result) => {
        terminalObservationEmitted = true;
        observe(MODEL_INVOCATION_EVENT.COMPLETED, {
          attemptCount: totalAttempts,
          operationKind: requestBase.operation.kind,
        });
        return createModelResponse({
          invocation,
          operationKind: requestBase.operation.kind,
          output,
          result,
          attemptCount: totalAttempts,
          attempts,
          model: requestBase.model,
          provider: {
            operatorId: requestBase.model.operatorId,
            adapterId: adapter.id,
          },
        });
      };
      const retryToolCallRecovery = (kind, output) => {
        if (toolCallRecoveryAttempts >= retry.toolCallMismatch.maxAttempts) return false;
        pushAttempt({ status: MODEL_ATTEMPT_STATUS.RETRY, kind, output });
        toolCallRecoveryAttempts += 1;
        streaming = retry.toolCallMismatch.downgradeStreaming === true ? false : streaming;
        streamingModes.set(streamingCacheKey, streaming);
        observe(MODEL_INVOCATION_EVENT.SEMANTIC_RETRY, {
          kind,
          attempt: totalAttempts,
          nextStreaming: streaming,
        });
        return true;
      };
      const retrySemantic = async (kind, output, delayMs) => {
        pushAttempt({ status: MODEL_ATTEMPT_STATUS.RETRY, kind, output });
        observe(MODEL_INVOCATION_EVENT.SEMANTIC_RETRY, {
          kind,
          attempt: totalAttempts,
          ...(delayMs === undefined ? {} : { delayMs }),
        });
        if (delayMs > 0) await clock.sleep(delayMs);
        return true;
      };
      const invokeOperationTransport = (credential) =>
        executeTransportRetry({
          policy: retry.transport,
          clock,
          classify,
          observe,
          signal: requestBase.options.signal,
          run: () => {
            totalAttempts += 1;
            observe(MODEL_INVOCATION_EVENT.ATTEMPT_STARTED, {
              attempt: totalAttempts,
              operationKind: requestBase.operation.kind,
              streaming,
            });
            return recordingAttempt(MODEL_ATTEMPT_KIND.TRANSPORT, streaming, () =>
              adapter.executeOperation({
                modelSpec: requestBase.model,
                credential,
                operation: requestBase.operation,
                streaming,
                headers: buildInvocationHeaders({
                  model: requestBase.model,
                  invocation,
                  operationKind: requestBase.operation.kind,
                  headers: requestBase.options.headers,
                }),
                signal: requestBase.options.signal,
                locale: requestBase.options.locale,
                clock,
                ...providerRuntime,
              }),
            );
          },
        });
      const attemptOperationTransport = async (credential, modes) => {
        try {
          return await invokeOperationTransport(credential);
        } catch (error) {
          const switchable = modes.includes(alternateStreamingMode(streaming));
          if (!switchable || !switchStreamingMode(error)) throw error;
          return invokeOperationTransport(credential);
        }
      };
      const executeOperation = async (credential) => {
        if (!isFunction(adapter.executeOperation)) {
          throw new TypeError(
            `provider adapter ${adapter.id} does not support operation: ${requestBase.operation.kind}`,
          );
        }
        const modes = requireOperationStreamingModes(
          adapter.resolveOperationStreamingModes({
            modelSpec: requestBase.model,
            operation: requestBase.operation,
          }),
        );
        if (!modes.includes(streaming)) [streaming] = modes;
        const result = await attemptOperationTransport(credential, modes);
        streamingModes.set(streamingCacheKey, streaming);
        const output = await recordingAttempt(MODEL_ATTEMPT_KIND.RESPONSE, streaming, () =>
          normalizeModelOutput(
            { content: result.value?.rawText || "" },
            MODEL_RESPONSE_SOURCE.MESSAGE,
          ),
        );
        pushAttempt({
          status: MODEL_ATTEMPT_STATUS.COMPLETED,
          kind: MODEL_ATTEMPT_KIND.RESPONSE,
          output,
        });
        return respond(output, result.value);
      };
      let attemptState = { streamedTokens: 0 };
      const emitContextTrace = (request) => {
        modelObservationState.sequence += 1;
        observationPort.emit(MODEL_CONTEXT_TRACE.EVENT, {
          stage: MODEL_CONTEXT_TRACE.INVOKE_STAGE,
          authority: MODEL_CONTEXT_TRACE.INVOKE_AUTHORITY,
          protocolVersion: MODEL_CONTEXT_TRACE.PROTOCOL_VERSION,
          modelInstanceId: modelObservationState.modelInstanceId,
          invocationId: invocation.invocationId,
          invocationSequence: modelObservationState.sequence,
          attempt: totalAttempts,
          model: {
            alias: text(request.model.alias),
            name: text(request.model.model),
            streaming,
            boundToolCount: request.tools.length,
          },
          invocation,
          ...request.metadata,
          messages: summarizeDiagnosticMessages(request.messages),
        });
      };
      const createChatClient = (request, credential) => {
        const baseClient = adapter.createClient({
          modelSpec: request.model,
          credential,
          streaming,
          headers: buildInvocationHeaders({
            model: request.model,
            invocation,
            operationKind: request.operation.kind,
            headers: request.options.headers,
          }),
          flow: invocation.flow,
        });
        return typeof clientDecorator === "function"
          ? clientDecorator(baseClient, { request })
          : baseClient;
      };
      const invokeChatTransport = (request, client) =>
        executeTransportRetry({
          policy: retry.transport,
          clock,
          classify,
          observe,
          signal: request.options.signal,
          streamedTokens: () => attemptState.streamedTokens,
          run: () => {
            totalAttempts += 1;
            attemptState = { streamedTokens: 0 };
            emitContextTrace(request);
            observe(MODEL_INVOCATION_EVENT.ATTEMPT_STARTED, { attempt: totalAttempts, streaming });
            return recordingAttempt(MODEL_ATTEMPT_KIND.TRANSPORT, streaming, () =>
              runModelAttempt({
                adapter,
                client,
                modelSpec: request.model,
                messages: request.messages,
                tools: request.tools,
                toolOptions: request.options.toolBinding || {},
                invokeOptions: {
                  signal: request.options.signal,
                  callbacks: wrapStreamingCallbacks(request.options.callbacks, attemptState),
                  ...request.options.invoke,
                },
              }),
            );
          },
        });
      const switchStreamingMode = (error) => {
        if (requestBase.options.signal?.aborted || alternateStreamingAttempted) return false;
        if (!mayRetryWithAlternateStreaming(attemptState.streamedTokens, classify(error))) {
          return false;
        }
        alternateStreamingAttempted = true;
        streaming = alternateStreamingMode(streaming);
        observe(MODEL_INVOCATION_EVENT.STREAMING_MODE_RETRY, {
          attempt: totalAttempts,
          nextStreaming: streaming,
          reason: "request_failed_before_output",
          error: attempts.at(-1)?.error,
        });
        return true;
      };
      const attemptChatTransport = async (request, client) => {
        try {
          return { result: await invokeChatTransport(request, client) };
        } catch (error) {
          if (!switchStreamingMode(error)) throw error;
          return { switched: true };
        }
      };
      const shouldRetryChatResponse = async (responseSource, value, normalized) => {
        const { output, invalidToolCalls } = normalized;
        if (
          streaming &&
          isToolCallStreamingMismatch(responseSource, { ...output, invalidToolCalls }) &&
          retryToolCallRecovery(MODEL_ATTEMPT_KIND.TOOL_CALL_STREAMING_MISMATCH, output)
        ) {
          return true;
        }
        if (invalidToolCalls.length) {
          if (streaming && retryToolCallRecovery(MODEL_ATTEMPT_KIND.TOOL_CALL_INVALID, output)) {
            return true;
          }
          throw failAttempt(
            MODEL_ATTEMPT_KIND.TOOL_CALL_INVALID,
            new ModelProtocolError("model returned an invalid tool call", {
              code: MODEL_ERROR_CODE.TOOL_CALL_INVALID,
              kind: MODEL_ERROR_KIND.TOOL_CALL_INVALID,
              details: { attemptCount: totalAttempts, invalidToolCalls },
            }),
            output,
          );
        }
        if (classifyReasoningOnly(value) && output.toolCalls.length === 0) {
          if (reasoningOnlyAttempts < retry.reasoningOnly.maxAttempts) {
            reasoningOnlyAttempts += 1;
            return retrySemantic(MODEL_ATTEMPT_KIND.REASONING_ONLY, output);
          }
          throw failAttempt(
            MODEL_ATTEMPT_KIND.REASONING_ONLY,
            new ModelProtocolError("model returned reasoning without a final answer", {
              code: MODEL_ERROR_CODE.REASONING_RETRY_EXHAUSTED,
              kind: MODEL_ERROR_KIND.REASONING_ONLY,
              details: { attemptCount: totalAttempts, reasoning: output.reasoning },
            }),
            output,
          );
        }
        if (!classifyEmptyResponse(output)) return false;
        if (emptyResponseAttempts < retry.emptyResponse.maxAttempts) {
          emptyResponseAttempts += 1;
          return retrySemantic(
            MODEL_ATTEMPT_KIND.EMPTY_RESPONSE,
            output,
            retry.emptyResponse.baseDelayMs * emptyResponseAttempts,
          );
        }
        throw failAttempt(
          MODEL_ATTEMPT_KIND.EMPTY_RESPONSE,
          new ModelProtocolError("model returned no final text or tool call", {
            code: MODEL_ERROR_CODE.EMPTY_RESPONSE_RETRY_EXHAUSTED,
            kind: MODEL_ERROR_KIND.EMPTY_RESPONSE,
            details: { attemptCount: totalAttempts, finishReason: output.finishReason },
          }),
          output,
        );
      };
      const executeChat = async (responseSource, credential) => {
        while (true) {
          const request = createModelRequest({
            ...requestBase,
            messages,
            options: { ...input.options, streaming },
          });
          const transport = await attemptChatTransport(
            request,
            createChatClient(request, credential),
          );
          if (transport.switched) continue;
          const { value } = transport.result;
          streamingModes.set(streamingCacheKey, streaming);
          const normalized = await recordingAttempt(MODEL_ATTEMPT_KIND.RESPONSE, streaming, () =>
            normalizeModelResponse(value, responseSource),
          );
          if (await shouldRetryChatResponse(responseSource, value, normalized)) continue;
          pushAttempt({
            status: MODEL_ATTEMPT_STATUS.COMPLETED,
            kind: MODEL_ATTEMPT_KIND.RESPONSE,
            output: normalized.output,
          });
          return respond(normalized.output, {});
        }
      };
      const resolveCredential = async () => {
        const credential = await credentialPort.resolve({
          modelSpec: requestBase.model,
          invocation,
        });
        if (credential) return credential;
        throw new ModelProtocolError(
          `model credential missing: ${requestBase.model.alias || requestBase.model.model}`,
          {
            code: MODEL_ERROR_CODE.CREDENTIAL_MISSING,
            kind: MODEL_ERROR_KIND.AUTHENTICATION,
            details: { alias: requestBase.model.alias, model: requestBase.model.model },
          },
        );
      };
      observe(MODEL_INVOCATION_EVENT.STARTED);
      try {
        const responseSource = requireModelResponseSource(
          adapter.resolveResponseSource({ modelSpec: requestBase.model }),
        );
        const credential = await resolveCredential();
        if (requestBase.operation.kind !== MODEL_OPERATION_KIND.CHAT) {
          return await executeOperation(credential);
        }
        return await executeChat(responseSource, credential);
      } catch (error) {
        observeTerminalError(error);
        throw error;
      }
    },
  });
}
