/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { summarizeDiagnosticMessages } from "@noobot/shared/message-diagnostics";
import {
  createModelRequest,
  createModelResponse,
  MODEL_OPERATION_KIND,
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  ModelProtocolError,
  normalizeRetryPolicy,
  SYSTEM_CLOCK_PORT,
} from "@noobot/model-protocol";
import { normalizeMessages } from "../normalization/message-normalizer.js";
import { normalizeModelOutput } from "../normalization/response-normalizer.js";
import {
  classifyReasoningOnly,
  appendReasoningContext,
} from "../policies/reasoning-retry-policy.js";
import { isToolCallStreamingMismatch } from "../policies/tool-call-retry-policy.js";
import { runModelAttempt } from "./attempt-runner.js";
import { executeTransportRetry } from "./retry-coordinator.js";
import { createProviderAdapterRegistry } from "../adapters/registry.js";

function projectObservableModel(model = {}) {
  return Object.freeze({
    alias: String(model.alias || "").trim(),
    model: String(model.model || "").trim(),
    operatorId: String(model.operatorId || "").trim(),
    modelFamily: String(model.modelFamily || "").trim(),
    adapterId: String(model.adapterId || "").trim(),
  });
}

export function createModelRequestExecutor({
  registry = createProviderAdapterRegistry(),
  credentialPort,
  observationPort = { emit() {} },
  clock = SYSTEM_CLOCK_PORT,
  clientDecorator = null,
  providerRuntime = {},
} = {}) {
  if (!credentialPort || typeof credentialPort.resolve !== "function")
    throw new TypeError("model runtime requires credentialPort.resolve");
  const modelObservationStates = new Map();
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
      const invocation = {
        requestId: input.invocation?.requestId || randomUUID(),
        invocationId: input.invocation?.invocationId || randomUUID(),
        ...input.invocation,
      };
      const retry = normalizeRetryPolicy(input.policies?.retry);
      let messages = normalizeMessages(input.messages);
      let streaming = input.options?.streaming === true;
      let semanticAttempts = 0;
      let mismatchAttempts = 0;
      let totalAttempts = 0;
      const attempts = [];
      let finalResult;
      const requestBase = createModelRequest({ ...input, invocation, messages });
      const adapter = registry.resolve(requestBase.model);
      const modelObservationState = resolveModelObservationState(requestBase.model);
      const credential = await credentialPort.resolve({ modelSpec: requestBase.model, invocation });
      if (!credential) {
        throw new ModelProtocolError(
          `model credential missing: ${requestBase.model.alias || requestBase.model.model}`,
          {
            code: MODEL_ERROR_CODE.CREDENTIAL_MISSING,
            kind: MODEL_ERROR_KIND.AUTHENTICATION,
            details: { alias: requestBase.model.alias, model: requestBase.model.model },
          },
        );
      }
      const observableModel = projectObservableModel(requestBase.model);
      const observe = (type, payload = {}) =>
        observationPort.emit(type, { invocation, ...payload, model: observableModel });
      observe("model.invocation.started");
      if (requestBase.operation.kind !== MODEL_OPERATION_KIND.CHAT) {
        if (typeof adapter.executeOperation !== "function") {
          throw new TypeError(
            `provider adapter ${adapter.id} does not support operation: ${requestBase.operation.kind}`,
          );
        }
        const result = await executeTransportRetry({
          policy: retry.transport,
          clock,
          classify: adapter.classifyError,
          observe,
          run: async () => {
            totalAttempts += 1;
            const attempt = totalAttempts;
            observe("model.invocation.attempt_started", {
              attempt,
              operationKind: requestBase.operation.kind,
              streaming: false,
            });
            try {
              return await adapter.executeOperation({
                modelSpec: requestBase.model,
                credential,
                operation: requestBase.operation,
                headers: {
                  "X-Model-Name": String(requestBase.model.model || "").trim(),
                  "X-Plugin-Flow": invocation.flow,
                  "X-Plugin-Purpose": invocation.purpose,
                  "X-Plugin-Domain": invocation.domain,
                  ...(invocation.sessionId ? { "X-Plugin-Session-Id": invocation.sessionId } : {}),
                  ...(invocation.parentSessionId
                    ? { parentSessionid: invocation.parentSessionId }
                    : {}),
                  ...(requestBase.options.headers || {}),
                },
                signal: requestBase.options.signal,
                locale: requestBase.options.locale,
                clock,
                ...providerRuntime,
              });
            } catch (error) {
              const classification = adapter.classifyError(error);
              attempts.push({
                attempt,
                status: "failed",
                kind: "transport",
                streaming: false,
                error: {
                  message: String(error?.message || error || "model operation failed"),
                  retryable: classification?.retryable === true,
                  kind: String(classification?.kind || "unknown"),
                },
              });
              throw error;
            }
          },
        });
        const output = normalizeModelOutput({ content: result.value?.rawText || "" });
        attempts.push({
          attempt: totalAttempts,
          status: "completed",
          kind: requestBase.operation.kind,
          streaming: false,
          output,
        });
        observe("model.invocation.completed", {
          attemptCount: totalAttempts,
          operationKind: requestBase.operation.kind,
        });
        return createModelResponse({
          invocation,
          operationKind: requestBase.operation.kind,
          output,
          result: result.value,
          attemptCount: totalAttempts,
          attempts,
          model: requestBase.model,
          provider: {
            operatorId: requestBase.model.operatorId,
            adapterId: adapter.id,
          },
        });
      }
      while (true) {
        const request = createModelRequest({
          ...requestBase,
          messages,
          options: { ...input.options, streaming },
        });
        const baseHeaders = {
          "X-Model-Name": String(request.model.model || "").trim(),
          "X-Plugin-Flow": invocation.flow,
          "X-Plugin-Purpose": invocation.purpose,
          "X-Plugin-Domain": invocation.domain,
          ...(invocation.sessionId ? { "X-Plugin-Session-Id": invocation.sessionId } : {}),
          ...(invocation.parentSessionId ? { parentSessionid: invocation.parentSessionId } : {}),
          ...(request.options.headers || {}),
        };
        const baseClient = adapter.createClient({
          modelSpec: request.model,
          credential,
          streaming,
          headers: baseHeaders,
          flow: invocation.flow,
        });
        const client =
          typeof clientDecorator === "function"
            ? clientDecorator(baseClient, { request })
            : baseClient;
        const result = await executeTransportRetry({
          policy: retry.transport,
          clock,
          classify: adapter.classifyError,
          observe,
          run: async () => {
            totalAttempts += 1;
            const attempt = totalAttempts;
            modelObservationState.sequence += 1;
            observationPort.emit("model_context_trace", {
              stage: "llm_invoke_messages",
              authority: "model_invoke_port",
              protocolVersion: 2,
              modelInstanceId: modelObservationState.modelInstanceId,
              invocationId: invocation.invocationId,
              invocationSequence: modelObservationState.sequence,
              attempt,
              model: {
                alias: String(request.model.alias || "").trim(),
                name: String(request.model.model || "").trim(),
                streaming,
                boundToolCount: request.tools.length,
              },
              invocation: {
                ...invocation,
                contextSequencePolicy: invocation.contextSequencePolicy,
              },
              context: {
                summaryCheckpointRevision: Math.max(
                  0,
                  Number(request.metadata?.context?.summaryCheckpointRevision) || 0,
                ),
              },
              messages: summarizeDiagnosticMessages(request.messages),
            });
            observe("model.invocation.attempt_started", { attempt, streaming });
            try {
              return await runModelAttempt({
                adapter,
                client,
                modelSpec: request.model,
                messages: request.messages,
                tools: request.tools,
                toolOptions: request.options.toolBinding || {},
                invokeOptions: {
                  signal: request.options.signal,
                  callbacks: request.options.callbacks,
                  ...request.options.invoke,
                },
              });
            } catch (error) {
              const classification = adapter.classifyError(error);
              attempts.push({
                attempt,
                status: "failed",
                kind: "transport",
                streaming,
                error: {
                  message: String(error?.message || error || "model attempt failed"),
                  retryable: classification?.retryable === true,
                  kind: String(classification?.kind || "unknown"),
                },
              });
              throw error;
            }
          },
        });
        const output = normalizeModelOutput(result.value);
        if (
          streaming &&
          isToolCallStreamingMismatch(result.value, output.toolCalls) &&
          mismatchAttempts < retry.toolCallMismatch.maxAttempts
        ) {
          attempts.push({
            attempt: totalAttempts,
            status: "retry",
            kind: "tool_call_streaming_mismatch",
            streaming,
            output,
          });
          mismatchAttempts += 1;
          streaming = retry.toolCallMismatch.downgradeStreaming === true ? false : streaming;
          observe("model.invocation.semantic_retry", {
            kind: "tool_call_streaming_mismatch",
            attempt: totalAttempts,
            nextStreaming: streaming,
          });
          continue;
        }
        // A provider may include reasoning alongside a valid tool call. Tool
        // calls are actionable model output and must reach the tool runner;
        // only responses with no tool calls can be retried as reasoning-only.
        if (classifyReasoningOnly(result.value) && output.toolCalls.length === 0) {
          if (semanticAttempts < retry.reasoningOnly.maxAttempts) {
            attempts.push({
              attempt: totalAttempts,
              status: "retry",
              kind: "reasoning_only",
              streaming,
              output,
            });
            semanticAttempts += 1;
            messages = appendReasoningContext(messages, output.reasoning);
            observe("model.invocation.semantic_retry", {
              kind: "reasoning_only",
              attempt: totalAttempts,
            });
            continue;
          }
          const error = new ModelProtocolError("model returned reasoning without a final answer", {
            code: MODEL_ERROR_CODE.REASONING_RETRY_EXHAUSTED,
            kind: MODEL_ERROR_KIND.REASONING_ONLY,
            details: { attemptCount: totalAttempts, reasoning: output.reasoning },
          });
          attempts.push({
            attempt: totalAttempts,
            status: "failed",
            kind: "reasoning_only",
            streaming,
            output,
          });
          observe("model.invocation.failed", {
            attemptCount: totalAttempts,
            code: error.code,
            kind: error.kind,
          });
          throw error;
        }
        attempts.push({
          attempt: totalAttempts,
          status: "completed",
          kind: "response",
          streaming,
          output,
        });
        finalResult = { output, result };
        break;
      }
      observe("model.invocation.completed", { attemptCount: totalAttempts });
      return createModelResponse({
        invocation,
        operationKind: requestBase.operation.kind,
        output: finalResult.output,
        result: {},
        attemptCount: totalAttempts,
        attempts,
        model: requestBase.model,
        provider: {
          operatorId: requestBase.model.operatorId,
          adapterId: adapter.id,
        },
      });
    },
  });
}
