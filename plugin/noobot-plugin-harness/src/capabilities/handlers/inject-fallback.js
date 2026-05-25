/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractRawTextContent,
} from "./shared.js";

export function scheduleInjectTask(
  ctx = {},
  {
    domain = CAPABILITY_DOMAIN.GUIDANCE,
    scheduledEvent = "",
    setPendingData = null,
    buildScheduledDetail = null,
  } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || typeof setPendingData !== "function") return false;
  const { bucket, state } = holder;
  const result = setPendingData({ bucket, state, ctx });
  if (!result) return false;
  appendCapabilityLog(ctx, {
    domain,
    event: String(scheduledEvent || "").trim() || "inject_task_scheduled",
    detail:
      typeof buildScheduledDetail === "function"
        ? buildScheduledDetail({ bucket, state, ctx, result })
        : {},
  });
  return true;
}

export async function captureInjectedResult(
  ctx = {},
  {
    domain = CAPABILITY_DOMAIN.GUIDANCE,
    completedEvent = "",
    failedEvent = "",
    isCapturePending = null,
    consumeCaptureMeta = null,
    applyCaptureResult = null,
    buildCompletedDetail = null,
    buildFailedDetail = null,
  } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (
    !holder ||
    typeof isCapturePending !== "function" ||
    typeof consumeCaptureMeta !== "function" ||
    typeof applyCaptureResult !== "function"
  ) {
    return false;
  }
  const { bucket, state } = holder;
  if (isCapturePending({ bucket, state, ctx }) !== true) return false;
  const captureMeta = consumeCaptureMeta({ bucket, state, ctx });
  const responseText =
    extractRawTextContent(ctx?.ai?.content) ||
    extractRawTextContent(ctx?.modelResponse?.content) ||
    "";
  const result = await applyCaptureResult({ bucket, state, ctx, responseText, captureMeta });
  const applied = result === true || (result && result.applied === true);
  if (applied) {
    appendCapabilityLog(ctx, {
      domain,
      event: String(completedEvent || "").trim() || "inject_capture_completed",
      detail: typeof buildCompletedDetail === "function" ? buildCompletedDetail({ result, captureMeta }) : {},
    });
    return true;
  }
  appendCapabilityLog(ctx, {
    domain,
    event: String(failedEvent || "").trim() || "inject_capture_failed",
    detail:
      typeof buildFailedDetail === "function"
        ? buildFailedDetail({ result, captureMeta, responseText })
        : {},
  });
  return false;
}
