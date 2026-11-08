/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { ModelProtocolError } from "./error.js";
import { requireResponsesOutput } from "./responses-output.js";

export const MODEL_REQUEST_EVENT = Object.freeze({
  STARTED: "model.request.started",
  USAGE: "model.request.usage",
  FINISHED: "model.request.finished",
});
export const MODEL_USAGE_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
]);
export const MODEL_MEASUREMENT_REASONS = Object.freeze([
  "provider_not_reported",
  "unsupported",
  "transport_failed",
  "stream_interrupted",
  "request_failed",
  "measurement_failed",
  "no_previous_request",
  "unfinished",
]);

const STREAM_COMPLETED = Object.freeze({ status: "completed", outputUsageFinal: true });
const STREAM_FAILED_WITH_USAGE = Object.freeze({ status: "failed", outputUsageFinal: true });
const STREAM_FAILED_WITHOUT_USAGE = Object.freeze({ status: "failed", outputUsageFinal: false });
const RESPONSES_TERMINALS = Object.freeze({
  completed: STREAM_COMPLETED,
  incomplete: STREAM_FAILED_WITH_USAGE,
  failed: STREAM_FAILED_WITH_USAGE,
});
const STREAM_TERMINALS = Object.freeze({
  anthropic: Object.freeze({
    error: STREAM_FAILED_WITHOUT_USAGE,
  }),
  responses: Object.freeze({
    "response.completed": RESPONSES_TERMINALS.completed,
    "response.incomplete": RESPONSES_TERMINALS.incomplete,
    "response.failed": RESPONSES_TERMINALS.failed,
  }),
  chat: Object.freeze({
    error: STREAM_FAILED_WITHOUT_USAGE,
  }),
});

export function resolveModelStreamTerminal(format, event) {
  if (!Object.hasOwn(STREAM_TERMINALS, format)) return null;
  const terminals = STREAM_TERMINALS[format];
  const type = format === "chat" && event?.error ? "error" : event?.type;
  if (!Object.hasOwn(terminals, type)) return null;
  if (format === "responses") {
    const terminal = requireModelResponseTerminal(format, event.response);
    if (type !== `response.${event.response.status}`)
      throw new ModelProtocolError("Responses terminal event must match response status");
    return terminal;
  }
  return terminals[type];
}

export function requireModelResponseTerminal(format, response) {
  if (format === "chat") {
    if (
      !Array.isArray(response?.choices) ||
      response.choices.length === 0 ||
      !response.choices.every((choice) => hasFinishReason(choice?.finish_reason))
    )
      throw new ModelProtocolError("Chat response requires finish_reason for every choice", {
        details: { responseId: response?.id },
      });
    return STREAM_COMPLETED;
  }
  if (format === "anthropic") {
    if (!hasFinishReason(response?.stop_reason))
      throw new ModelProtocolError("Anthropic response requires a non-empty stop_reason", {
        details: { responseId: response?.id },
      });
    return STREAM_COMPLETED;
  }
  if (format !== "responses") return null;
  if (!Object.hasOwn(RESPONSES_TERMINALS, response?.status)) {
    throw new ModelProtocolError("Responses response requires a terminal status", {
      details: { responseId: response?.id, status: response?.status },
    });
  }
  if (response.status === "completed") {
    if (response.error != null)
      throw new ModelProtocolError(
        "Responses completed response must not contain a non-null error",
        {
          details: { responseId: response.id, path: "error" },
        },
      );
    requireResponsesOutput(response);
  }
  return RESPONSES_TERMINALS[response.status];
}

function hasFinishReason(reason) {
  return typeof reason === "string" && reason.trim().length > 0;
}

export function createChatStreamTerminalTracker() {
  const choices = new Map();
  let terminal = null;
  return {
    accept(event) {
      if (terminal) return terminal;
      if (event?.type === "[DONE]") {
        terminal =
          choices.size > 0 && [...choices.values()].every(Boolean)
            ? STREAM_COMPLETED
            : STREAM_FAILED_WITHOUT_USAGE;
        return terminal;
      }
      if (event?.error) {
        terminal = STREAM_FAILED_WITHOUT_USAGE;
        return terminal;
      }
      for (const choice of event?.choices ?? []) {
        if (!Number.isSafeInteger(choice.index) || choice.index < 0)
          throw new ModelProtocolError("Chat stream choice requires a non-negative index");
        if (choice.finish_reason != null && !hasFinishReason(choice.finish_reason))
          throw new ModelProtocolError("Chat stream finish_reason must be a non-empty string");
        choices.set(
          choice.index,
          choices.get(choice.index) === true || choice.finish_reason != null,
        );
      }
      return null;
    },
    end() {
      return terminal ?? STREAM_FAILED_WITHOUT_USAGE;
    },
  };
}

export function reportedMeasurement(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("reported measurement must be a non-negative safe integer");
  }
  return Object.freeze({ state: "reported", value });
}

export function unavailableMeasurement(reason) {
  if (!MODEL_MEASUREMENT_REASONS.includes(reason))
    throw new TypeError("invalid measurement reason");
  return Object.freeze({ state: "unavailable", reason });
}

export function createUnavailableModelUsage(reason) {
  return Object.freeze(
    Object.fromEntries(MODEL_USAGE_FIELDS.map((key) => [key, unavailableMeasurement(reason)])),
  );
}

export function requireModelUsage(usage) {
  if (!isPlainObject(usage) || Object.keys(usage).length !== MODEL_USAGE_FIELDS.length) {
    throw new TypeError("model usage requires exactly the canonical token fields");
  }
  for (const key of MODEL_USAGE_FIELDS) {
    const field = usage[key];
    if (!isPlainObject(field)) throw new TypeError(`model usage.${key} must be a measurement`);
    if (field.state === "reported" && Object.keys(field).length === 2)
      reportedMeasurement(field.value);
    else if (field.state === "unavailable" && Object.keys(field).length === 2)
      unavailableMeasurement(field.reason);
    else throw new TypeError(`invalid model usage.${key}`);
  }
  const { inputTokens: input, cacheReadInputTokens: read, cacheWriteInputTokens: write } = usage;
  for (const cache of [read, write]) {
    if (input.state === "reported" && cache.state === "reported" && cache.value > input.value) {
      throw new TypeError("model cache tokens exceed input tokens");
    }
  }
  return usage;
}

function requireRequestUnavailableMeasurement(field) {
  if (field.reason === "measurement_failed")
    throw new TypeError("request measurement failure requires measurementError diagnostic");
  return unavailableMeasurement(field.reason);
}

function requireRequestPrefix(prefix) {
  if (prefix?.state === "unavailable") return requireRequestUnavailableMeasurement(prefix);
  if (prefix?.state !== "reported") throw new TypeError("request prefix measurement is required");
  reportedMeasurement(prefix.requestBodyBytes);
  reportedMeasurement(prefix.commonPrefixBytes);
  if (
    prefix.commonPrefixBytes > prefix.requestBodyBytes ||
    !["available", "no_previous_request"].includes(prefix.baseline) ||
    (prefix.baseline === "no_previous_request" && prefix.commonPrefixBytes !== 0)
  ) {
    throw new TypeError("invalid request prefix measurement");
  }
}

function requireRequestUsage(data) {
  if (data.measurementError !== null) {
    if (typeof data.measurementError !== "string" || !data.measurementError || data.usage !== null)
      throw new TypeError("invalid request measurement error");
    return;
  }
  requireModelUsage(data.usage);
  for (const field of Object.values(data.usage))
    if (field.state === "unavailable") requireRequestUnavailableMeasurement(field);
}

export function requireModelRequestMeasurement(type, data) {
  if (!Object.values(MODEL_REQUEST_EVENT).includes(type))
    throw new TypeError("invalid model request event");
  if (
    !data ||
    typeof data.transportRequestId !== "string" ||
    !data.transportRequestId ||
    !Number.isSafeInteger(data.attempt) ||
    data.attempt < 1 ||
    !data.invocation?.invocationId
  ) {
    throw new TypeError("model request measurement requires request and invocation identity");
  }
  if (type === MODEL_REQUEST_EVENT.STARTED) requireRequestPrefix(data.prefix);
  if (type === MODEL_REQUEST_EVENT.USAGE) requireRequestUsage(data);
  if (
    type === MODEL_REQUEST_EVENT.FINISHED &&
    !["completed", "failed", "cancelled"].includes(data.status)
  ) {
    throw new TypeError("invalid model request terminal status");
  }
  return data;
}
