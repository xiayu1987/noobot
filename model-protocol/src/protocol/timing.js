/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_INVOCATION_EVENT } from "./constants.js";
import { MODEL_REQUEST_EVENT } from "./measurement.js";

export function requireModelTiming(value) {
  if (
    typeof value?.clockId !== "string" ||
    !value.clockId ||
    !Number.isFinite(value.atMs) ||
    value.atMs < 0
  )
    throw new TypeError(
      "model timing requires a clock identity and non-negative monotonic milliseconds",
    );
  return value;
}

function finishInterval(state, { key, timing, invocationId, request }) {
  const { pending } = state;
  const start = pending.get(key);
  if (!start || timing.atMs < start.atMs || start.invocationId !== invocationId)
    throw new TypeError(`unpaired or reversed model timing: ${key}`);
  pending.delete(key);
  (request ? state.requests : state.invocations).set(key, {
    startMs: start.atMs,
    endMs: timing.atMs,
    invocationId,
  });
}

function unionDuration(intervals) {
  let total = 0;
  let end = -Infinity;
  for (const [start, finish] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  return total;
}

const starts = new Set([MODEL_INVOCATION_EVENT.STARTED, MODEL_REQUEST_EVENT.STARTED]);
const terminals = new Set([
  MODEL_INVOCATION_EVENT.COMPLETED,
  MODEL_INVOCATION_EVENT.FAILED,
  MODEL_INVOCATION_EVENT.CANCELLED,
  MODEL_REQUEST_EVENT.FINISHED,
]);

function timingIdentity(event, data) {
  const request = event.startsWith("model.request.");
  const invocationId = data.invocation?.invocationId;
  if (typeof invocationId !== "string" || !invocationId)
    throw new TypeError("missing model invocation identity");
  const identity = request ? data.transportRequestId : invocationId;
  if (typeof identity !== "string" || !identity)
    throw new TypeError("missing model timing identity");
  return { request, invocationId, key: `${request ? "request" : "invocation"}:${identity}` };
}

function recordTiming(state, event, data) {
  const timing = requireModelTiming(data?.timing);
  state.clockId ??= timing.clockId;
  if (state.clockId !== timing.clockId) throw new TypeError("model timing crosses clock domains");
  const { request, invocationId, key } = timingIdentity(event, data);
  const { seen, pending } = state;
  if (starts.has(event)) {
    if (seen.has(key)) throw new TypeError(`duplicate model timing: ${key}`);
    seen.add(key);
    if (request && !pending.has(`invocation:${invocationId}`))
      throw new TypeError("model request outside its invocation");
    pending.set(key, { ...timing, invocationId });
  } else finishInterval(state, { key, timing, invocationId, request });
}

export function summarizeModelPipelineTiming(events) {
  const state = {
    pending: new Map(),
    seen: new Set(),
    invocations: new Map(),
    requests: new Map(),
  };
  for (const { event, data } of events) {
    if (starts.has(event) || terminals.has(event)) recordTiming(state, event, data);
  }
  const { pending, invocations, requests, clockId } = state;
  if (pending.size || !invocations.size || !requests.size)
    throw new TypeError("incomplete model pipeline timing");
  const invocationIntervals = [...invocations.values()];
  const startMs = Math.min(...invocationIntervals.map((interval) => interval.startMs));
  const endMs = Math.max(...invocationIntervals.map((interval) => interval.endMs));
  for (const { startMs: start, endMs: end, invocationId } of requests.values()) {
    const invocation = invocations.get(`invocation:${invocationId}`);
    if (!invocation || start < invocation.startMs || end > invocation.endMs)
      throw new TypeError("model request outside its invocation");
  }
  const transportMs = unionDuration(
    [...requests.values()].map(({ startMs, endMs }) => [startMs, endMs]),
  );
  return {
    clockId,
    startMs,
    endMs,
    elapsedMs: endMs - startMs,
    transportMs,
    transportIntervals: [...requests.values()].map(({ startMs, endMs }) => ({
      clockId,
      startMs,
      endMs,
    })),
    localMs: endMs - startMs - transportMs,
    requestCount: requests.size,
    invocationCount: invocations.size,
  };
}
