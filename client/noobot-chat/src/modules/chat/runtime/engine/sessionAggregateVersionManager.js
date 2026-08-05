/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function getCurrentSessionAggregateVersion(activeSession) {
  const session = activeSession?.value || activeSession;
  return session?.aggregateVersion;
}

export function isSessionAggregateVersionConflict(result, payload) {
  if (String(payload?.errorCode || "").trim() === "SESSION_AGGREGATE_VERSION_CONFLICT") return true;
  const errorText = String(payload?.error || payload?.message || "").toLowerCase();
  return errorText.includes("version") && errorText.includes("conflict");
}

export function isNewerSessionAggregateVersion(nextVersion, currentVersion) {
  if (!hasValue(nextVersion)) return false;
  if (!hasValue(currentVersion)) return true;
  const nextNumber = numericValue(nextVersion);
  const currentNumber = numericValue(currentVersion);
  if (nextNumber !== null && currentNumber !== null) return nextNumber > currentNumber;
  return nextVersion !== currentVersion;
}

export function applyLatestSessionAggregateVersion(session, source = {}) {
  if (!session || !source) return false;
  if (!isNewerSessionAggregateVersion(source.aggregateVersion, session.aggregateVersion)) return false;
  session.aggregateVersion = source.aggregateVersion;
  return true;
}

export function createSessionAggregateVersionManager({
  activeSession,
  fetchSessionDetail,
  applySessionDetail,
  log = null,
} = {}) {
  function getVersion() {
    return getCurrentSessionAggregateVersion(activeSession);
  }

  async function refreshAfterConflict({ sessionId, previousVersion, detailOptions = {}, logContext = {} } = {}) {
    if (typeof fetchSessionDetail !== "function" || typeof applySessionDetail !== "function") return false;
    const detail = await fetchSessionDetail(sessionId, {
      source: "versionConflict",
      force: true,
      reuseRecentlyLoaded: false,
      ...detailOptions,
    });
    if (!detail) return false;
    log?.("versionConflict.detail.apply.before", {
      sessionId,
      ...logContext,
      aggregateVersion: getVersion(),
    });
    applySessionDetail(detail);
    const nextVersion = getVersion();
    const changed = isNewerSessionAggregateVersion(nextVersion, previousVersion);
    log?.("versionConflict.detail.apply.after", {
      sessionId,
      ...logContext,
      aggregateVersion: nextVersion,
      previousVersion,
      versionChanged: changed,
    });
    return changed;
  }

  async function runAggregateVersionedMutation({
    mutate,
    shouldRetry = true,
    refreshOptions = {},
  } = {}) {
    if (typeof mutate !== "function") return null;
    let attempt = 1;
    let expectedAggregateVersion = getVersion();
    let response = await mutate({ expectedAggregateVersion, attempt });
    const failed = () => response?.result?.ok === false || response?.payload?.ok === false;
    if (shouldRetry && failed() && isSessionAggregateVersionConflict(response?.result, response?.payload)) {
      const refreshed = await refreshAfterConflict({
        previousVersion: expectedAggregateVersion,
        ...refreshOptions,
      });
      if (refreshed) {
        attempt = 2;
        expectedAggregateVersion = getVersion();
        response = await mutate({ expectedAggregateVersion, attempt });
      }
    }
    return { ...response, expectedAggregateVersion, attempt };
  }

  return {
    getVersion,
    refreshAfterConflict,
    runAggregateVersionedMutation,
  };
}
