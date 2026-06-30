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

export function getCurrentSessionVersion(activeSession) {
  const session = activeSession?.value || activeSession;
  return session?.version ?? session?.revision;
}

export function isSessionVersionConflict(result, payload) {
  if (result?.status === 409) return true;
  const errorText = String(payload?.error || payload?.message || "").toLowerCase();
  return errorText.includes("version") && errorText.includes("conflict");
}

export function isNewerSessionVersion(nextVersion, currentVersion) {
  if (!hasValue(nextVersion)) return false;
  if (!hasValue(currentVersion)) return true;
  const nextNumber = numericValue(nextVersion);
  const currentNumber = numericValue(currentVersion);
  if (nextNumber !== null && currentNumber !== null) return nextNumber > currentNumber;
  return nextVersion !== currentVersion;
}

export function applyLatestSessionVersion(session, source = {}) {
  if (!session || !source) return false;
  let changed = false;
  if (isNewerSessionVersion(source.version, session.version)) {
    session.version = source.version;
    changed = true;
  }
  if (isNewerSessionVersion(source.revision, session.revision)) {
    session.revision = source.revision;
    changed = true;
  }
  return changed;
}

export function createSessionVersionManager({
  activeSession,
  fetchSessionDetail,
  applySessionDetail,
  log = null,
} = {}) {
  function getVersion() {
    return getCurrentSessionVersion(activeSession);
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
      version: getVersion(),
    });
    applySessionDetail(detail, { preserveCurrentMessages: true });
    const nextVersion = getVersion();
    const changed = isNewerSessionVersion(nextVersion, previousVersion);
    log?.("versionConflict.detail.apply.after", {
      sessionId,
      ...logContext,
      version: nextVersion,
      previousVersion,
      versionChanged: changed,
    });
    return changed;
  }

  async function runVersionedMutation({
    mutate,
    shouldRetry = true,
    refreshOptions = {},
  } = {}) {
    if (typeof mutate !== "function") return null;
    let attempt = 1;
    let expectedVersion = getVersion();
    let response = await mutate({ expectedVersion, attempt });
    const failed = () => response?.result?.ok === false || response?.payload?.ok === false;
    if (shouldRetry && failed() && isSessionVersionConflict(response?.result, response?.payload)) {
      const refreshed = await refreshAfterConflict({
        previousVersion: expectedVersion,
        ...refreshOptions,
      });
      if (refreshed) {
        attempt = 2;
        expectedVersion = getVersion();
        response = await mutate({ expectedVersion, attempt });
      }
    }
    return { ...response, expectedVersion, attempt };
  }

  return {
    getVersion,
    refreshAfterConflict,
    runVersionedMutation,
  };
}
