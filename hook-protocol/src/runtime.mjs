/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  HOOK_EXECUTION,
  HOOK_FAILURE_MODE,
  HOOK_PROTOCOL_VERSION,
  requireHookPointDescriptor,
} from "./points.mjs";

export const HOOK_OUTCOME_STATUS = Object.freeze({
  OK: "ok",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  ABORTED: "aborted",
});

export class HookExecutionError extends Error {
  constructor({ point = "", outcomes = [] } = {}) {
    const firstFailure = outcomes.find((outcome) => outcome?.status !== HOOK_OUTCOME_STATUS.OK);
    const failureLocation = `${point}${firstFailure?.handlerId ? `#${firstFailure.handlerId}` : ""}`;
    const failureMessage = String(firstFailure?.error?.message || "").trim();
    super(`hook execution failed: ${failureLocation}${failureMessage ? `: ${failureMessage}` : ""}`);
    this.name = "HookExecutionError";
    this.code = "HOOK_EXECUTION_FAILED";
    this.point = point;
    this.outcomes = outcomes;
    this.cause = firstFailure?.error;
  }
}

function createHookAbortError({ point = "", handlerId = "", timeoutMs = 0 } = {}) {
  const error = new Error(`hook timeout: ${point}#${handlerId} (${timeoutMs}ms)`);
  error.name = "AbortError";
  error.code = "HOOK_TIMEOUT";
  error.point = point;
  error.handlerId = handlerId;
  error.timeoutMs = timeoutMs;
  return error;
}

function createLinkedAbortController(parentSignal = null) {
  const controller = new AbortController();
  let removeParentListener = () => {};
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (typeof parentSignal?.addEventListener === "function") {
    const abortFromParent = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
    removeParentListener = () => parentSignal.removeEventListener("abort", abortFromParent);
  }
  return { controller, removeParentListener };
}

async function invokeHandler({ registration, point, context, parentSignal }) {
  const startedAt = Date.now();
  const { controller, removeParentListener } = createLinkedAbortController(parentSignal);
  const timeoutMs = registration.timeoutMs;
  const timeoutError = createHookAbortError({ point, handlerId: registration.id, timeoutMs });
  let timer = null;
  let removeInvocationAbortListener = () => {};
  const abortPromise = new Promise((_, reject) => {
    if (controller.signal.aborted) {
      reject(controller.signal.reason || new Error(`hook aborted: ${point}#${registration.id}`));
      return;
    }
    const rejectOnAbort = () => {
      reject(controller.signal.reason || new Error(`hook aborted: ${point}#${registration.id}`));
    };
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    removeInvocationAbortListener = () => controller.signal.removeEventListener("abort", rejectOnAbort);
  });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
    }, timeoutMs);
  }
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => registration.handler(context, {
        protocolVersion: HOOK_PROTOCOL_VERSION,
        point,
        handlerId: registration.id,
        signal: controller.signal,
      })),
      abortPromise,
    ]);
    return Object.freeze({
      protocolVersion: HOOK_PROTOCOL_VERSION,
      point,
      handlerId: registration.id,
      status: HOOK_OUTCOME_STATUS.OK,
      durationMs: Date.now() - startedAt,
      value,
      error: null,
    });
  } catch (error) {
    const status = error?.code === "HOOK_TIMEOUT"
      ? HOOK_OUTCOME_STATUS.TIMED_OUT
      : controller.signal.aborted
        ? HOOK_OUTCOME_STATUS.ABORTED
        : HOOK_OUTCOME_STATUS.FAILED;
    return Object.freeze({
      protocolVersion: HOOK_PROTOCOL_VERSION,
      point,
      handlerId: registration.id,
      status,
      durationMs: Date.now() - startedAt,
      value: null,
      error,
    });
  } finally {
    if (timer) clearTimeout(timer);
    removeInvocationAbortListener();
    removeParentListener();
  }
}

export function createHookManager({ defaultTimeoutMs = 3000, onError = null } = {}) {
  const registry = new Map();
  let sequence = 0;

  function list(point = "") {
    if (point) return (registry.get(requireHookPointDescriptor(point).point) || []).slice();
    return Array.from(registry.entries()).map(([registeredPoint, handlers]) => ({
      point: registeredPoint,
      handlers: handlers.slice(),
    }));
  }

  function on(point, handler, options = {}) {
    const descriptor = requireHookPointDescriptor(point);
    if (typeof handler !== "function") throw new TypeError("hook handler is required");
    const id = String(options?.id || "").trim();
    if (!id) throw new TypeError(`hook handler id is required: ${descriptor.point}`);
    const handlers = registry.get(descriptor.point) || [];
    if (handlers.some((registration) => registration.id === id)) {
      throw new Error(`duplicate hook handler id: ${descriptor.point}#${id}`);
    }
    const configuredTimeoutMs = Number(options?.timeoutMs);
    const registration = Object.freeze({
      sequence: ++sequence,
      id,
      point: descriptor.point,
      handler,
      once: options?.once === true,
      priority: Number.isFinite(Number(options?.priority)) ? Number(options.priority) : 0,
      timeoutMs: Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
        ? configuredTimeoutMs
        : defaultTimeoutMs,
    });
    handlers.push(registration);
    handlers.sort((left, right) => left.priority === right.priority
      ? left.sequence - right.sequence
      : right.priority - left.priority);
    registry.set(descriptor.point, handlers);
    return () => off(descriptor.point, id);
  }

  function once(point, handler, options = {}) {
    return on(point, handler, { ...options, once: true });
  }

  function off(point, handlerId) {
    const descriptor = requireHookPointDescriptor(point);
    const normalizedId = String(handlerId || "").trim();
    if (!normalizedId) return false;
    const handlers = registry.get(descriptor.point) || [];
    const nextHandlers = handlers.filter((registration) => registration.id !== normalizedId);
    if (nextHandlers.length === handlers.length) return false;
    if (nextHandlers.length) registry.set(descriptor.point, nextHandlers);
    else registry.delete(descriptor.point);
    return true;
  }

  function clear(point = "") {
    if (!point) return registry.clear();
    registry.delete(requireHookPointDescriptor(point).point);
  }

  async function emit(point, context = {}, { signal = null } = {}) {
    const descriptor = requireHookPointDescriptor(point);
    const registrations = (registry.get(descriptor.point) || []).slice();
    for (const registration of registrations) {
      if (registration.once) off(descriptor.point, registration.id);
    }
    const runRegistration = async (registration) => {
      const outcome = await invokeHandler({
        registration,
        point: descriptor.point,
        context,
        parentSignal: signal,
      });
      if (outcome.status !== HOOK_OUTCOME_STATUS.OK && typeof onError === "function") {
        onError({ point: descriptor.point, handlerId: registration.id, context, outcome });
      }
      return outcome;
    };
    const outcomes = [];
    if (descriptor.execution === HOOK_EXECUTION.PARALLEL) {
      outcomes.push(...await Promise.all(registrations.map(runRegistration)));
    } else {
      for (const registration of registrations) outcomes.push(await runRegistration(registration));
    }
    const result = Object.freeze({
      protocolVersion: HOOK_PROTOCOL_VERSION,
      executed: true,
      point: descriptor.point,
      context,
      outcomes: Object.freeze(outcomes),
      failures: Object.freeze(outcomes.filter((outcome) => outcome.status !== HOOK_OUTCOME_STATUS.OK)),
    });
    if (result.failures.length && descriptor.failureMode === HOOK_FAILURE_MODE.FAIL_FLOW) {
      throw new HookExecutionError({ point: descriptor.point, outcomes });
    }
    return result;
  }

  return Object.freeze({ on, once, off, clear, list, emit });
}

export function createEmptyHookResult(point, context = {}) {
  const descriptor = requireHookPointDescriptor(point);
  return Object.freeze({
    protocolVersion: HOOK_PROTOCOL_VERSION,
    executed: false,
    point: descriptor.point,
    context,
    outcomes: Object.freeze([]),
    failures: Object.freeze([]),
  });
}
