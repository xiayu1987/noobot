/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveTurnTerminalStateApi } from "../../../infrastructure/api/chat/chatApi.js";
import { isTerminalTurnEvent } from "@noobot/session-protocol";
import { SESSION_RUN_EVENT } from "./run-state-machine/constants.js";
import { terminalResolutionMetadata } from "./terminalResolutionMetadata.js";

function clean(input) {
  return String(input || "").trim();
}

function keyOf(userId, sessionId, turnScopeId) {
  return `${clean(valueOf(userId))}::${clean(sessionId)}::${clean(turnScopeId)}`;
}

function valueOf(input) {
  return input && typeof input === "object" && "value" in input ? input.value : input;
}

function versionOf(input = {}) {
  const metadata = terminalResolutionMetadata(input);
  return {
    revision: metadata.revision,
    sequence: metadata.sequence,
    completionCommitId: metadata.completionCommitId,
    summaryVersion: metadata.summaryVersion,
  };
}

function compareVersion(left = {}, right = {}) {
  const leftCommit = clean(left.completionCommitId);
  const rightCommit = clean(right.completionCommitId);
  if (leftCommit && rightCommit && leftCommit !== rightCommit) return null;
  if (
    left.summaryVersion != null &&
    right.summaryVersion != null &&
    left.summaryVersion !== right.summaryVersion
  ) {
    return left.summaryVersion > right.summaryVersion ? 1 : -1;
  }
  const comparisons = [];
  for (const field of ["revision", "sequence"]) {
    const a = left[field];
    const b = right[field];
    if (a == null || b == null) continue;
    if (a !== b) comparisons.push(a > b ? 1 : -1);
  }
  if (comparisons.includes(1) && comparisons.includes(-1)) return null;
  return comparisons[0] || 0;
}

function hasVersion(input = {}) {
  return (
    input.revision != null ||
    input.sequence != null ||
    input.summaryVersion != null ||
    Boolean(clean(input.completionCommitId))
  );
}

function maxVersion(left = {}, right = {}) {
  if (!hasVersion(left)) return right;
  if (!hasVersion(right)) return left;
  const comparison = compareVersion(left, right);
  return comparison === 1 ? left : right;
}

function isTerminalNotification(event = {}) {
  return (
    event?.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE &&
    isTerminalTurnEvent(clean(event.eventType || event.raw?.eventType).toLowerCase())
  );
}

export function createTerminalResolutionCoordinator({
  userId = "",
  fetcher,
  applyTurnTerminalResolution,
  onDiscovery = () => {},
  maxRetries = 3,
  onUnresolved = () => {},
  onTrace = () => {},
} = {}) {
  const entries = new Map();
  let requestSequence = 0;
  let disposed = false;
  const trace = (event, details) => {
    try {
      onTrace(event, details);
    } catch (error) {
      console.warn(`[noobot:terminal-resolution] trace failed for ${event}`, error);
    }
  };

  const getEntry = (key) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        sessionId: "",
        turnScopeId: "",
        inFlight: null,
        timer: null,
        targetVersion: {},
        resolvedVersion: null,
        resolvedResult: null,
        resolvedResponse: null,
        exhaustedVersion: null,
        exhaustedResult: null,
        cooldownUntil: 0,
        cooldownResult: null,
        generation: 0,
      };
      entries.set(key, entry);
    }
    return entry;
  };

  const traceCache = (identity, decision, extra = {}) =>
    trace("stateMachine.terminal.cache", { ...identity, decision, ...extra });

  const readResolvedCache = (entry, requestedVersion, identity) => {
    const comparison = compareVersion(requestedVersion, entry.resolvedVersion || {});
    if (!entry.resolvedResult || comparison === null || comparison > 0) return null;
    const cached = entry.resolvedResult;
    if (cached.applied !== true && cached.retryable === true && entry.resolvedResponse) {
      const reapplied = applyTurnTerminalResolution?.(entry.resolvedResponse) || {
        applied: false,
        reason: "resolution_apply_unavailable",
      };
      entry.resolvedResult = reapplied;
      return Promise.resolve(reapplied);
    }
    traceCache(identity, "resolved", {
      applied: cached?.applied === true,
      reason: cached?.reason || "",
    });
    return Promise.resolve(cached);
  };

  const readExhaustedCache = (entry, requestedVersion, identity) => {
    const comparison = compareVersion(requestedVersion, entry.exhaustedVersion || {});
    if (!entry.exhaustedResult || comparison === null || comparison > 0) return null;
    traceCache(identity, "exhausted", { reason: entry.exhaustedResult?.reason || "" });
    return Promise.resolve(entry.exhaustedResult);
  };

  const readCachedResult = (entry, requestedVersion, identity) => {
    if (entry.cooldownUntil > Date.now()) {
      traceCache(identity, "cooldown", { reason: entry.cooldownResult?.reason || "" });
      return Promise.resolve(entry.cooldownResult);
    }
    if (entry.cooldownUntil) {
      entry.cooldownUntil = 0;
      entry.cooldownResult = null;
    }
    const cached =
      readResolvedCache(entry, requestedVersion, identity) ||
      readExhaustedCache(entry, requestedVersion, identity);
    if (cached) return cached;
    if (entry.inFlight) {
      traceCache(identity, "in_flight");
      return entry.inFlight;
    }
    if (entry.timer) {
      traceCache(identity, "retry_timer");
      return entry.timer.promise;
    }
    return null;
  };

  const resolve = (sessionId, turnScopeId, options = {}) => {
    const session = clean(sessionId);
    const scope = clean(turnScopeId);
    if (!session || !scope) {
      trace("stateMachine.terminal.skipped", {
        sessionId: session,
        turnScopeId: scope,
        reason: "missing_turn_identity",
      });
      return Promise.resolve({ applied: false, reason: "missing_turn_identity" });
    }
    if (disposed) {
      trace("stateMachine.terminal.skipped", {
        sessionId: session,
        turnScopeId: scope,
        reason: "terminal_resolution_disposed",
      });
      return Promise.resolve({ applied: false, reason: "terminal_resolution_disposed" });
    }
    const key = keyOf(userId, session, scope);
    const entry = getEntry(key);
    entry.sessionId = session;
    entry.turnScopeId = scope;
    const requestedVersion = versionOf(options);
    onDiscovery({
      sessionId: session,
      turnScopeId: scope,
      source: options.source || "unknown",
      revision: Number(requestedVersion.revision || 0),
      sequence: Number(requestedVersion.sequence || 0),
      summaryVersion: Number(requestedVersion.summaryVersion || 0),
    });
    entry.targetVersion = maxVersion(entry.targetVersion, requestedVersion);

    if (options.force === true) {
      entry.exhaustedVersion = null;
      entry.exhaustedResult = null;
      entry.cooldownUntil = 0;
      entry.cooldownResult = null;
    }

    const identity = { sessionId: session, turnScopeId: scope };
    const cached = readCachedResult(entry, requestedVersion, identity);
    if (cached) return cached;

    const retry = Number(options.retry || 0);
    const commandId =
      clean(options.commandId) ||
      `terminal-resolution:${Date.now().toString(36)}:${(++requestSequence).toString(36)}`;
    const generation = ++entry.generation;

    const followUp = (extra = {}) =>
      resolve(session, scope, {
        ...extra,
        commandId,
        source: options.source || "terminal_resolution_retry",
        ...entry.targetVersion,
      });

    const traceFetchResult = (response) => {
      const turn = response?.turn;
      trace("stateMachine.terminal.fetch.result", {
        ...identity,
        resolved: response?.resolved === true,
        retryable: response?.retryable === true,
        reason: response?.reason || "",
        revision: Number(turn?.revision || response?.revision || 0),
        sequence: Number(turn?.sequence || response?.sequence || 0),
        terminalState: turn?.state || "",
        responseSessionId: clean(response?.sessionId),
        responseTurnScopeId: clean(response?.turnScopeId),
      });
    };

    const traceApplyResult = (result) => {
      const projection = result?.subSessionEffect?.subSessionProjection;
      trace("stateMachine.terminal.apply", {
        ...identity,
        applied: result?.applied === true,
        retryable: result?.retryable === true,
        reason: result?.reason || "",
        state: result?.turn?.displayState || result?.turn?.state || "",
        terminal: result?.turn?.terminal || null,
        projectionApplied: projection?.applied === true,
        projectionReason: projection?.reason || "",
      });
    };

    const settleResolvedResponse = (response) => {
      const result = applyTurnTerminalResolution?.(response) || {
        applied: false,
        reason: "resolution_apply_unavailable",
      };
      traceApplyResult(result);
      if (generation !== entry.generation) return result;
      entry.resolvedVersion = versionOf(response);
      entry.resolvedResult = result;
      entry.resolvedResponse = response;
      entry.exhaustedVersion = null;
      entry.exhaustedResult = null;
      if (result.applied !== true) return result;
      const pendingComparison = compareVersion(entry.targetVersion, entry.resolvedVersion);
      if (pendingComparison !== 1 && pendingComparison !== null) return result;
      if (entry.inFlight === request) entry.inFlight = null;
      return followUp();
    };

    const scheduleRetry = (response) => {
      const delay = Math.max(0, Number(response.retryAfterMs || 250));
      trace("stateMachine.terminal.retry", { ...identity, retry: retry + 1, delayMs: delay });
      let timerId;
      const retryPromise = new Promise((resolveRetry) => {
        timerId = setTimeout(() => {
          if (entry.timer?.id === timerId) entry.timer = null;
          if (entry.inFlight === request) entry.inFlight = null;
          resolveRetry(followUp({ retry: retry + 1 }));
        }, delay);
      });
      entry.timer = { id: timerId, promise: retryPromise };
      return retryPromise;
    };

    const settleUnresolved = (response) => {
      const result = {
        applied: false,
        reason: response?.reason || "terminal_unresolved",
        response,
      };
      if (response?.retryable !== true || retry >= maxRetries) {
        entry.exhaustedVersion = { ...entry.targetVersion };
        entry.exhaustedResult = result;
      }
      return result;
    };

    const settleResponse = (response) => {
      traceFetchResult(response);
      if (response?.resolved === true) return settleResolvedResponse(response);
      onUnresolved({ ...identity, response, retry });
      if (response?.retryable === true && retry < maxRetries && !disposed) {
        return scheduleRetry(response);
      }
      return settleUnresolved(response);
    };

    const settleFetchError = (error) => {
      const status = Number(error?.status || error?.response?.status || 0);
      const rateLimited = status === 429;
      const retryAfterMs = Math.max(250, Number(error?.retryAfterMs || 0));
      const result = {
        applied: false,
        reason: rateLimited ? "terminal_resolution_rate_limited" : "terminal_resolution_failed",
        retryable: false,
        retryAfterMs,
        error,
      };
      trace("stateMachine.terminal.fetch.failed", {
        ...identity,
        status,
        reason: result.reason,
        retryAfterMs,
      });
      if (generation === entry.generation) {
        entry.cooldownUntil = Date.now() + (rateLimited ? retryAfterMs : 1000);
        entry.cooldownResult = result;
      }
      return result;
    };

    trace("stateMachine.terminal.fetch.start", {
      ...identity,
      source: options.source || "unknown",
      retry,
      revision: Number(requestedVersion.revision || 0),
      sequence: Number(requestedVersion.sequence || 0),
    });
    const request = Promise.resolve()
      .then(() =>
        resolveTurnTerminalStateApi(
          { userId: valueOf(userId), ...identity, commandId },
          { fetcher },
        ),
      )
      .then(settleResponse)
      .catch(settleFetchError)
      .finally(() => {
        if (entry.inFlight === request) entry.inFlight = null;
      });
    entry.inFlight = request;
    return request;
  };

  const observe = (event = {}) => {
    if (!isTerminalNotification(event)) return null;
    return resolve(event.sessionId, event.turnScopeId, {
      commandId: event.commandId || "",
      source: "realtime_notification",
      ...versionOf(event.raw || event),
    });
  };

  const invalidate = (sessionId, turnScopeId) => {
    const key = keyOf(userId, sessionId, turnScopeId);
    const entry = entries.get(key);
    if (entry?.timer?.id) clearTimeout(entry.timer.id);
    entries.delete(key);
  };

  const dispose = () => {
    disposed = true;
    for (const entry of entries.values()) {
      if (entry.timer?.id) clearTimeout(entry.timer.id);
    }
    entries.clear();
  };

  return { observe, resolve, invalidate, dispose };
}
