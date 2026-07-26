/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveTurnTerminalStateApi } from "../../services/api/chatApi";
import { SESSION_RUN_EVENT } from "./sessionRunStateMachine/constants";
import { terminalResolutionMetadata } from "./terminalResolutionMetadata";

const TERMINAL_NOTIFICATION_TYPES = new Set([
  "turn.completed",
  "turn.stop_completed",
  "turn.failed",
]);
const TERMINAL_CHANNEL_STATES = new Set(["completed", "user_stopped", "error", "expired"]);

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
  if (left.summaryVersion != null && right.summaryVersion != null &&
      left.summaryVersion !== right.summaryVersion) {
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
  return input.revision != null || input.sequence != null ||
    input.summaryVersion != null || Boolean(clean(input.completionCommitId));
}

function maxVersion(left = {}, right = {}) {
  if (!hasVersion(left)) return right;
  if (!hasVersion(right)) return left;
  const comparison = compareVersion(left, right);
  // Incomparable metadata may describe a different commit. Preserve the new
  // target so it cannot be hidden by an older cached watermark.
  return comparison === 1 ? left : right;
}

function isTerminalNotification(event = {}) {
  if (event?.type === SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE) {
    return TERMINAL_NOTIFICATION_TYPES.has(clean(event.eventType || event.raw?.eventType).toLowerCase());
  }
  return event?.type === SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE &&
    TERMINAL_CHANNEL_STATES.has(clean(event.state || event.backendState).toLowerCase());
}

/**
 * Single-flight authoritative terminal reader.
 *
 * All notification/replay/hydration callers share one Turn-keyed request. A
 * successfully applied commit is retained as a version watermark, so replaying
 * the same (or an unversioned) discovery cannot issue another network read.
 */
export function createTerminalResolutionCoordinator({
  userId = "",
  fetcher,
  applyTurnTerminalResolution,
  onDiscovery = () => {},
  maxRetries = 3,
  onUnresolved = () => {},
} = {}) {
  const entries = new Map();
  let requestSequence = 0;
  let disposed = false;

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

  const resolve = (sessionId, turnScopeId, options = {}) => {
    const session = clean(sessionId);
    const scope = clean(turnScopeId);
    if (!session || !scope) return Promise.resolve({ applied: false, reason: "missing_turn_identity" });
    if (disposed) return Promise.resolve({ applied: false, reason: "terminal_resolution_disposed" });
    const key = keyOf(userId, session, scope);
    const entry = getEntry(key);
    entry.sessionId = session;
    entry.turnScopeId = scope;
    const requestedVersion = versionOf(options);
    onDiscovery({
      sessionId: session, turnScopeId: scope, source: options.source || "unknown",
      revision: Number(requestedVersion.revision || 0), sequence: Number(requestedVersion.sequence || 0),
      summaryVersion: Number(requestedVersion.summaryVersion || 0),
    });
    entry.targetVersion = maxVersion(entry.targetVersion, requestedVersion);

    if (options.force === true) {
      entry.exhaustedVersion = null;
      entry.exhaustedResult = null;
      entry.cooldownUntil = 0;
      entry.cooldownResult = null;
    }

    if (entry.cooldownUntil > Date.now()) return Promise.resolve(entry.cooldownResult);
    if (entry.cooldownUntil) {
      entry.cooldownUntil = 0;
      entry.cooldownResult = null;
    }

    // An unversioned discovery describes the already-known Turn. A versioned
    // notification only invalidates the cache when it is strictly newer.
    const resolvedComparison = compareVersion(requestedVersion, entry.resolvedVersion || {});
    if (entry.resolvedResult && resolvedComparison !== null && resolvedComparison <= 0) {
      // The authoritative GET may have completed before Session detail was
      // hydrated, so the first local projection can legitimately return
      // `session_projection_unavailable`. Re-apply the cached response when a
      // later discovery arrives instead of treating that temporary result as
      // a settled UI projection.
      if (entry.resolvedResult.applied !== true && entry.resolvedResult.retryable === true && entry.resolvedResponse) {
        const reapplied = applyTurnTerminalResolution?.(entry.resolvedResponse) || {
          applied: false,
          reason: "resolution_apply_unavailable",
        };
        entry.resolvedResult = reapplied;
        return Promise.resolve(reapplied);
      }
      return Promise.resolve(entry.resolvedResult);
    }
    // A valid authoritative read can arrive while its Session projection is not
    // loaded (for example during list/detail switching). Do not hit the server
    // again for the same commit. Re-try only the local atomic projection; once
    // the Session is available this settles the Turn without another GET.
    const exhaustedComparison = compareVersion(requestedVersion, entry.exhaustedVersion || {});
    if (entry.exhaustedResult && exhaustedComparison !== null && exhaustedComparison <= 0) {
      return Promise.resolve(entry.exhaustedResult);
    }
    if (entry.inFlight) return entry.inFlight;
    if (entry.timer) return entry.timer.promise;

    const retry = Number(options.retry || 0);
    const commandId = clean(options.commandId) ||
      `terminal-resolution:${Date.now().toString(36)}:${(++requestSequence).toString(36)}`;
    const generation = ++entry.generation;

    const request = Promise.resolve()
      .then(() => resolveTurnTerminalStateApi({
        userId: valueOf(userId),
        sessionId: session,
        turnScopeId: scope,
        commandId,
      }, { fetcher }))
      .then((response) => {
        if (response?.resolved === true) {
          const result = applyTurnTerminalResolution?.(response) || {
            applied: false,
            reason: "resolution_apply_unavailable",
          };
          // Cache the authoritative commit independently from the UI projection.
          // Projection may legitimately be deferred until the Session detail is
          // loaded; treating that as a failed read causes every discovery source
          // to issue another GET and can trigger rate limiting.
          if (generation === entry.generation) {
            // A resolved response is authoritative even when the current
            // session projection is temporarily unavailable. Keep the response
            // so later lifecycle notifications only retry local application.
            entry.resolvedVersion = versionOf(response);
            entry.resolvedResult = result;
            entry.resolvedResponse = response;
            entry.exhaustedVersion = null;
            entry.exhaustedResult = null;
          }
          if (result?.applied === true && generation === entry.generation) {
            entry.resolvedVersion = versionOf(response);
            entry.resolvedResult = result;
            entry.resolvedResponse = response;
            entry.exhaustedVersion = null;
            entry.exhaustedResult = null;
            const pendingComparison = compareVersion(entry.targetVersion, entry.resolvedVersion);
            if (pendingComparison === 1 || pendingComparison === null) {
              // A newer notification arrived while this request was running.
              // Release this generation before starting exactly one follow-up.
              if (entry.inFlight === request) entry.inFlight = null;
              return resolve(session, scope, {
                commandId,
                source: options.source || "terminal_resolution_retry",
                ...entry.targetVersion,
              });
            }
          }
          return result;
        }
        onUnresolved({ sessionId: session, turnScopeId: scope, response, retry });
        if (response?.retryable === true && retry < maxRetries && !disposed) {
          const delay = Math.max(0, Number(response.retryAfterMs || 250));
          let timerId;
          const retryPromise = new Promise((resolveRetry) => {
            timerId = setTimeout(() => {
              if (entry.timer?.id === timerId) entry.timer = null;
              // The parent promise is waiting for this retry. It must not remain
              // the Turn's single-flight value or resolve() would return itself.
              if (entry.inFlight === request) entry.inFlight = null;
              resolveRetry(resolve(session, scope, {
                retry: retry + 1,
                commandId,
                source: options.source || "terminal_resolution_retry",
                ...entry.targetVersion,
              }));
            }, delay);
          });
          entry.timer = { id: timerId, promise: retryPromise };
          return retryPromise;
        }
        const result = { applied: false, reason: response?.reason || "terminal_unresolved", response };
        // A non-retryable unresolved response is also authoritative for this
        // discovery generation. Cache it just like an exhausted retry series,
        // otherwise DONE, final-detail hydration and CHANNEL_STATE each issue
        // the same GET for one Turn. A newer version or force still clears the
        // watermark through the normal invalidation path above.
        if (response?.retryable !== true || retry >= maxRetries) {
          entry.exhaustedVersion = { ...entry.targetVersion };
          entry.exhaustedResult = result;
        }
        return result;
      })
      .catch((error) => {
        const status = Number(error?.status || error?.response?.status || 0);
        const retryAfterMs = Math.max(250, Number(error?.retryAfterMs || 0));
        const result = {
          applied: false,
          reason: status === 429 ? "terminal_resolution_rate_limited" : "terminal_resolution_failed",
          retryable: false,
          retryAfterMs,
          error,
        };
        // A rate-limited request must not be retriggered by every replay source.
        // Keep a short per-Turn circuit breaker; a newer lifecycle event or an
        // explicit force can still reconcile once the server has cooled down.
        if (generation === entry.generation) {
          entry.cooldownUntil = Date.now() + (status === 429 ? retryAfterMs : 1000);
          entry.cooldownResult = result;
        }
        return result;
      })
      .finally(() => {
        if (entry.inFlight === request) entry.inFlight = null;
      });
    entry.inFlight = request;
    return request;
  };

  // Re-apply an already accepted authoritative response after a Session is
  // hydrated. This is deliberately local-only: it cannot create a request,
  // retry timer, or 429 storm.
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
