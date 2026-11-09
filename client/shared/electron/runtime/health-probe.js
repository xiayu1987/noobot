/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const HEALTH_PROBE_STATE = Object.freeze({
  READY: "ready",
  NOT_READY: "not_ready",
  CONNECTION_REFUSED: "connection_refused",
  TIMEOUT: "timeout",
});

export async function probeHealth(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_THRESHOLDS.desktop.healthProbeTimeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HEALTH_HTTP_ERROR: ${response.status}`);
    const data = await response.json();
    if (typeof data?.ok !== "boolean") throw new TypeError("HEALTH_INVALID_RESPONSE");
    return { state: data.ok ? HEALTH_PROBE_STATE.READY : HEALTH_PROBE_STATE.NOT_READY };
  } catch (error) {
    if (controller.signal.aborted) return { state: HEALTH_PROBE_STATE.TIMEOUT };
    if (error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED")
      return { state: HEALTH_PROBE_STATE.CONNECTION_REFUSED };
    const detail = error instanceof Error ? error.message : String(error);
    const failure = new Error(`HEALTH_PROBE_FAILED: ${url}: ${detail}`, { cause: error });
    failure.messageKey = "healthProbeFailed";
    failure.messageParams = { url, detail };
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
