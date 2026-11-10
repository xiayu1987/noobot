/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  accumulateStreamUsage,
  createUnavailableModelUsage,
  normalizeProviderUsage,
  resolveModelResponseFormat,
  resolveModelStreamTerminal,
} from "@noobot/model-protocol";
import { measureRequestPrefix } from "@noobot/model-protocol/request-prefix-node";
import { parseServerSentEvents } from "@noobot/shared/event-stream";
import { tryParseJson } from "./common.js";

function errorMessage(error) {
  return String(error?.message || error);
}

function createRequestPrefixTracker() {
  const previousBodies = new Map();
  return function measureProxyRequestPrefix({ url, bodyText, context = {} }) {
    const scope = JSON.stringify([
      context.sessionId,
      context.parentSessionId,
      url.origin,
      url.pathname,
      tryParseJson(bodyText)?.model ?? context.modelName,
      context.flowName,
    ]);
    try {
      return { prefix: measureRequestPrefix(previousBodies, scope, bodyText) };
    } catch (error) {
      return { prefix: null, measurementError: errorMessage(error) };
    }
  };
}

function collectRawUsage(format, bodyText, contentType) {
  if (
    !String(contentType || "")
      .toLowerCase()
      .includes("text/event-stream")
  ) {
    return tryParseJson(bodyText)?.usage;
  }
  let rawUsage;
  for (const { data } of parseServerSentEvents(bodyText)) {
    if (data === "[DONE]") continue;
    const event = tryParseJson(data);
    if (!event) continue;
    const terminal = format === "responses" ? resolveModelStreamTerminal(format, event) : null;
    rawUsage = accumulateStreamUsage(format, rawUsage, event, terminal);
  }
  return rawUsage;
}

function measureResponseUsage({ url, status, bodyText, contentType }) {
  const format = resolveModelResponseFormat(url);
  if (format === null) return { usage: createUnavailableModelUsage("unsupported") };
  if (!(status >= 200 && status < 300))
    return { usage: createUnavailableModelUsage("request_failed") };
  try {
    const rawUsage = collectRawUsage(format, bodyText, contentType);
    return {
      usage:
        rawUsage === undefined || rawUsage === null
          ? createUnavailableModelUsage("provider_not_reported")
          : normalizeProviderUsage(rawUsage, format),
    };
  } catch (error) {
    return { usage: null, measurementError: errorMessage(error) };
  }
}

export { createRequestPrefixTracker, measureResponseUsage };
