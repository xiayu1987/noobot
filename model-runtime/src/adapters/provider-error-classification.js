/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { classifyProviderFailure } from "@noobot/model-protocol";
import { classifyTransportError } from "../policies/default-retry-policy.js";

function parseRetryAfter(retryAfter, clock) {
  if (retryAfter == null || retryAfter === "") return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
  if (Number.isFinite(date)) return Math.max(0, date - Number(clock.now()));
  return null;
}

export function classifyProviderError(error, { operatorId, clock }) {
  const retryAfter = error?.headers?.get?.("retry-after") ?? error?.headers?.["retry-after"];
  const retryAfterMs = parseRetryAfter(retryAfter, clock);
  const classification =
    error?.status !== undefined || error?.type || error?.providerFailure === true
      ? classifyProviderFailure({
          operatorId,
          status: error.status,
          code: error.code,
          type: error.type,
          detailCode: error.details?.error_code,
          retryAfterMs,
        })
      : classifyTransportError(error);
  return retryAfterMs === null ? classification : { ...classification, retryAfterMs };
}
