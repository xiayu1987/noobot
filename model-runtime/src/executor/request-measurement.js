/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { createEventStreamParser } from "@noobot/shared/event-stream";
import {
  MODEL_REQUEST_EVENT,
  createAnthropicStreamTerminalTracker,
  createChatStreamTerminalTracker,
  createUnavailableModelUsage,
  requireModelRequestMeasurement,
  requireModelResponseTerminal,
  resolveModelResponseFormat,
  resolveModelStreamTerminal,
  unavailableMeasurement,
} from "@noobot/model-protocol";
import { normalizeProviderUsage } from "../normalization/usage-normalizer.js";
import { responseMediaType } from "../adapters/response-mode.js";

function measurePrefix(previousBodies, scope, body) {
  if (typeof body !== "string") {
    previousBodies.delete(scope);
    return { state: "unavailable", reason: "unsupported" };
  }
  const current = Buffer.from(body, "utf8");
  const previous = previousBodies.get(scope);
  let commonPrefixBytes = 0;
  if (previous) {
    const limit = Math.min(current.length, previous.length);
    while (commonPrefixBytes < limit && current[commonPrefixBytes] === previous[commonPrefixBytes])
      commonPrefixBytes += 1;
  }
  previousBodies.set(scope, current);
  return {
    state: "reported",
    requestBodyBytes: current.length,
    commonPrefixBytes,
    baseline: previous ? "available" : "no_previous_request",
  };
}

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

function createUsageCollector(format, finish) {
  let rawUsage;
  let measurementError = null;
  let terminal = null;
  let pending = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parseFrames = createEventStreamParser();
  const chatTerminal = format === "chat" ? createChatStreamTerminalTracker() : null;
  const anthropicTerminal = format === "anthropic" ? createAnthropicStreamTerminalTracker() : null;
  const streamTerminal = chatTerminal ?? anthropicTerminal;
  const accept = (event) => {
    terminal = streamTerminal
      ? streamTerminal.accept(event)
      : resolveModelStreamTerminal(format, event);
    if (format === "anthropic") {
      if (event.type === "message_start") rawUsage = { ...event.message?.usage };
      if (event.type === "message_delta") rawUsage = { ...rawUsage, ...event.usage };
      return;
    }
    if (format === "responses") {
      if (terminal) {
        rawUsage = event.response?.usage;
      }
      return;
    }
    if (event.usage != null) rawUsage = event.usage;
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
    finish("failed", result("stream_interrupted"));
  };
  return {
    chunk(bytes, streaming) {
      if (format === null || measurementError !== null || terminal) return;
      let decoded;
      try {
        decoded = decoder.decode(bytes, { stream: true });
      } catch (error) {
        reject(error);
        return;
      }
      if (!streaming) {
        pending += decoded;
        return;
      }
      for (const { data } of parseFrames(decoded)) {
        try {
          accept(data === "[DONE]" ? { type: data } : JSON.parse(data));
        } catch (error) {
          reject(error);
          return;
        }
        if (!terminal) continue;
        finish(terminal.status, result("provider_not_reported"));
        return;
      }
    },
    end(streaming, status) {
      if (measurementError !== null || terminal) return;
      try {
        pending += decoder.decode();
      } catch (error) {
        reject(error);
        return;
      }
      if (format !== null && !streaming && measurementError === null) {
        try {
          const response = JSON.parse(pending);
          rawUsage = response.usage;
          terminal = requireModelResponseTerminal(format, response);
        } catch (error) {
          reject(error);
          pending = "";
          return;
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
    cancel(status) {
      finish(status, result("stream_interrupted"));
    },
  };
}

export function createMeasuredFetch({
  fetchImpl,
  previousBodies,
  invocation,
  model,
  operationKind,
  attempt,
  observe,
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
      prefix: measurePrefix(previousBodies, scope, requestBody),
    });
    let finished = false;
    const finish = (status, usage) => {
      if (finished) return;
      finished = true;
      emit(MODEL_REQUEST_EVENT.USAGE, usage);
      emit(MODEL_REQUEST_EVENT.FINISHED, { status });
    };
    const collector = createUsageCollector(resolveModelResponseFormat(url), finish);
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
        }
      },
      async cancel(reason) {
        collector.cancel("cancelled");
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
