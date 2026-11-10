/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { createEventStreamParser } from "@noobot/shared/event-stream";
import {
  MODEL_REQUEST_EVENT,
  accumulateStreamUsage,
  createAnthropicStreamTerminalTracker,
  createChatStreamTerminalTracker,
  createUnavailableModelUsage,
  requireModelRequestMeasurement,
  hasModelStreamOutput,
  normalizeProviderUsage,
  resolveModelResponseFormat,
  unavailableMeasurement,
} from "@noobot/model-protocol";
import { measureRequestPrefix } from "@noobot/model-protocol/request-prefix-node";
import { responseMediaType } from "../adapters/response-mode.js";
import {
  validatedModelResponseTerminal,
  validatedModelStreamTerminal,
} from "../normalization/response-terminal.js";
import {
  createModelResponseDecoder,
  parseModelResponseJson,
} from "../normalization/response-decoding.js";

function collectedUsage(format, rawUsage, reason) {
  if (format === null) return createUnavailableModelUsage("unsupported");
  if (rawUsage === undefined) return createUnavailableModelUsage(reason);
  return normalizeProviderUsage(rawUsage, format);
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function createUsageCollector(format, finish, onOutput) {
  let rawUsage;
  let decodedResponse;
  let measurementError = null;
  let terminal = null;
  let pending = "";
  const decode = createModelResponseDecoder();
  const parseFrames = createEventStreamParser();
  const chatTerminal = format === "chat" ? createChatStreamTerminalTracker() : null;
  const anthropicTerminal = format === "anthropic" ? createAnthropicStreamTerminalTracker() : null;
  const streamTerminal = chatTerminal ?? anthropicTerminal;
  const accept = (event) => {
    terminal = streamTerminal
      ? streamTerminal.accept(event)
      : validatedModelStreamTerminal(format, event);
    if (hasModelStreamOutput(format, event)) onOutput?.();
    rawUsage = accumulateStreamUsage(format, rawUsage, event, terminal);
  };
  const result = (reason) => {
    if (measurementError !== null) return { usage: null, measurementError };
    let usage = null;
    try {
      usage = collectedUsage(format, rawUsage, reason);
      if (terminal?.outputUsageFinal === false || (!terminal && reason === "stream_interrupted")) {
        usage = { ...usage, outputTokens: unavailableMeasurement("stream_interrupted") };
      }
    } catch (error) {
      usage = null;
      measurementError = String(error.message);
    }
    return { usage, measurementError };
  };
  const reject = (error) => {
    measurementError ??= String(error.message);
    pending = "";
    finish("failed", result("stream_interrupted"));
    throw error;
  };
  return {
    chunk(bytes, streaming) {
      if (format === null || measurementError !== null || terminal) return;
      let decoded;
      try {
        decoded = decode(bytes, { stream: true });
      } catch (error) {
        reject(error);
      }
      if (!streaming) {
        pending += decoded;
        return;
      }
      for (const { data } of parseFrames(decoded)) {
        try {
          accept(data === "[DONE]" ? { type: data } : parseModelResponseJson(data));
        } catch (error) {
          reject(error);
        }
        if (!terminal) continue;
        finish(terminal.status, result("provider_not_reported"));
        return;
      }
    },
    end(streaming, status) {
      if (measurementError !== null || terminal) return;
      try {
        pending += decode();
      } catch (error) {
        reject(error);
      }
      if (format !== null && !streaming && measurementError === null) {
        try {
          decodedResponse = parseModelResponseJson(pending);
          rawUsage = decodedResponse?.usage;
          terminal = validatedModelResponseTerminal(format, decodedResponse);
        } catch (error) {
          reject(error);
        }
      }
      pending = "";
      if (streaming && chatTerminal) terminal = chatTerminal.end();
      finish(
        streaming && !terminal ? "failed" : (terminal?.status ?? status),
        result(streaming && !terminal ? "stream_interrupted" : "provider_not_reported"),
      );
    },
    fail(status) {
      finish(status, result("transport_failed"));
    },
    decoded() {
      return decodedResponse;
    },
    cancel(status) {
      finish(status, result("stream_interrupted"));
    },
  };
}

class MeasuredJsonResponse extends Response {
  #collector;

  constructor(body, init, collector) {
    super(body, init);
    this.#collector = collector;
  }

  async json() {
    if (this.bodyUsed) throw new TypeError("Response body is already consumed");
    const reader = this.body.getReader();
    try {
      while (!(await reader.read()).done) continue;
      return this.#collector.decoded();
    } finally {
      reader.releaseLock();
    }
  }
}

export function createMeasuredFetch({
  fetchImpl,
  previousBodies,
  invocation,
  model,
  operationKind,
  attempt,
  observe,
  onOutput,
}) {
  return async (input, init = {}) => {
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "POST") return fetchImpl(input, init);
    const url = requestUrl(input);
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const requestBody = init.body ?? (input instanceof Request ? input.body : undefined);
    const scope = JSON.stringify([
      invocation.sessionId,
      invocation.parentSessionId,
      new URL(url).origin,
      new URL(url).pathname,
      model.model,
      invocation.flow,
      operationKind,
    ]);
    const identity = { transportRequestId: randomUUID(), attempt: attempt(), operationKind };
    const emit = (type, data) => {
      const payload = { ...identity, ...data, invocation };
      requireModelRequestMeasurement(type, payload);
      observe(type, payload);
    };
    emit(MODEL_REQUEST_EVENT.STARTED, {
      prefix: measureRequestPrefix(previousBodies, scope, requestBody),
    });
    let finished = false;
    const finish = (status, usage) => {
      if (finished) return;
      finished = true;
      emit(MODEL_REQUEST_EVENT.USAGE, usage);
      emit(MODEL_REQUEST_EVENT.FINISHED, { status });
    };
    const format = resolveModelResponseFormat(url);
    const collector = createUsageCollector(format, finish, onOutput);
    const cancelled = () => (signal?.aborted ? "cancelled" : "failed");
    let response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      collector.fail(cancelled());
      throw error;
    }
    const status = response.ok ? "completed" : "failed";
    if (!response.ok) {
      finish(status, {
        usage: createUnavailableModelUsage("request_failed"),
        measurementError: null,
      });
      return response;
    }
    if (!response.body) {
      collector.end(false, status);
      return response;
    }
    const streaming = responseMediaType(response) === "text/event-stream";
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            collector.end(streaming, status);
            controller.close();
          } else {
            collector.chunk(chunk.value, streaming);
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          collector.cancel(cancelled());
          controller.error(error);
          await reader.cancel(error);
        }
      },
      async cancel(reason) {
        collector.cancel(cancelled());
        await reader.cancel(reason);
      },
    });
    const responseInit = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
    return !streaming && format !== null
      ? new MeasuredJsonResponse(body, responseInit, collector)
      : new Response(body, responseInit);
  };
}
