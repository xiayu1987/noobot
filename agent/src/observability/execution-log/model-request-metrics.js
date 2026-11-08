/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_REQUEST_EVENT,
  requireModelRequestMeasurement,
  createUnavailableModelUsage,
} from "@noobot/model-protocol";
import {
  createExecutionModelMeasurements,
  requireExecutionModelMeasurements,
} from "@noobot/session-protocol/execution-report";

function unavailable(group, reason) {
  group.unavailableCount += 1;
  group.unavailableReasons[reason] = (group.unavailableReasons[reason] || 0) + 1;
}

function sample(group, fields, add) {
  const missing = fields.find((field) => field.state !== "reported");
  if (missing) {
    unavailable(group, missing.reason);
    return;
  }
  group.sampleCount += 1;
  add(...fields.map((field) => field.value));
}

function aggregatePrefix(group, prefix) {
  if (prefix.state !== "reported") return unavailable(group, prefix.reason);
  if (prefix.baseline === "no_previous_request") return unavailable(group, "no_previous_request");
  group.sampleCount += 1;
  group.commonPrefixBytesSum += prefix.commonPrefixBytes;
  group.requestBodyBytesSum += prefix.requestBodyBytes;
}

function aggregateUsage(result, usage) {
  const { tokens, cacheRead, cacheWrite } = result.usage;
  sample(tokens, [usage.inputTokens, usage.outputTokens], (input, output) => {
    tokens.inputTokensSum += input;
    tokens.outputTokensSum += output;
  });
  sample(cacheRead, [usage.inputTokens, usage.cacheReadInputTokens], (input, read) => {
    cacheRead.inputTokensSum += input;
    cacheRead.cacheReadInputTokensSum += read;
    if (read > 0) cacheRead.hitRequestCount += 1;
  });
  sample(cacheWrite, [usage.inputTokens, usage.cacheWriteInputTokens], (input, write) => {
    cacheWrite.inputTokensSum += input;
    cacheWrite.cacheWriteInputTokensSum += write;
  });
}

export function createModelRequestMetrics() {
  const requests = new Map();
  return {
    consume(type, data) {
      requireModelRequestMeasurement(type, data);
      const id = data.transportRequestId;
      if (type === MODEL_REQUEST_EVENT.STARTED) {
        if (requests.has(id)) throw new TypeError(`duplicate model request: ${id}`);
        requests.set(id, { start: data });
        return;
      }
      const request = requests.get(id);
      if (
        !request ||
        request.start.invocation.invocationId !== data.invocation.invocationId ||
        request.start.attempt !== data.attempt
      ) {
        throw new TypeError(`unpaired model request event: ${id}`);
      }
      if (request.finish) throw new TypeError(`model request event after terminal: ${id}`);
      if (type === MODEL_REQUEST_EVENT.USAGE) {
        if (request.usage) throw new TypeError(`duplicate model request usage: ${id}`);
        request.measurementError = data.measurementError;
        request.usage =
          data.measurementError === null
            ? data.usage
            : createUnavailableModelUsage("measurement_failed");
      } else {
        if (!request.usage)
          throw new TypeError(`model request terminal without usage state: ${id}`);
        request.finish = data.status;
      }
    },
    summarize() {
      const result = createExecutionModelMeasurements();
      for (const request of requests.values()) {
        result.requests.startedCount += 1;
        result.requests[request.finish ? `${request.finish}Count` : "unfinishedCount"] += 1;
        aggregatePrefix(result.requestPrefix, request.start.prefix);
        if (request.measurementError)
          result.measurementErrors.push({
            transportRequestId: request.start.transportRequestId,
            message: request.measurementError,
          });
        aggregateUsage(result, request.usage ?? createUnavailableModelUsage("unfinished"));
      }
      return requireExecutionModelMeasurements(result);
    },
  };
}
