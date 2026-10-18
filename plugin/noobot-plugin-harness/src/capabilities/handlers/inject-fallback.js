/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./shared/bucket-utils.js";
import { appendCapabilityLog } from "./shared/attachment-log-utils.js";
import { readAfterLlmCallText } from "./shared/message/utils.js";

function requireCallbacks(owner, callbacks) {
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") {
      throw new TypeError(`${owner} requires ${name} callback`);
    }
  }
}

export function scheduleInjectTask(ctx, { domain, scheduledEvent, setPendingData }) {
  requireCallbacks("scheduleInjectTask", { setPendingData });
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const detail = setPendingData({ bucket, state, ctx });
  if (!detail) return false;
  appendCapabilityLog(ctx, { domain, event: scheduledEvent, detail });
  return true;
}

export async function captureInjectedResult(
  ctx,
  { domain, completedEvent, failedEvent, isCapturePending, consumeCaptureMeta, applyCaptureResult },
) {
  requireCallbacks("captureInjectedResult", {
    isCapturePending,
    consumeCaptureMeta,
    applyCaptureResult,
  });
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (isCapturePending({ bucket, state, ctx }) !== true) return false;
  const captureMeta = consumeCaptureMeta({ bucket, state, ctx });
  const responseText = readAfterLlmCallText(ctx);
  const { applied, detail } = await applyCaptureResult({
    bucket,
    state,
    ctx,
    responseText,
    captureMeta,
  });
  appendCapabilityLog(ctx, { domain, event: applied ? completedEvent : failedEvent, detail });
  return applied === true;
}
