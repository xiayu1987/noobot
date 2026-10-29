/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_ERROR_CODE,
  isNewerSessionAggregateVersion as isNewerProtocolAggregateVersion,
} from "@noobot/session-protocol";
import { isApiRequestError } from "@noobot/shared/request-error";
import { isObjectLike, requireFunctionDependencies } from "@noobot/shared/value";
import { isCommandResultError } from "../../../../infrastructure/websocket/chatWebSocketProtocol.js";

function getCurrentSessionAggregateVersion(activeSession) {
  const session = activeSession.value;
  if (!isObjectLike(session)) {
    throw new TypeError("aggregate version requires an active session");
  }
  return session.aggregateVersion;
}

function readMutationVersionConflict(error) {
  if (!isApiRequestError(error)) return null;
  if (error.serverErrorCode !== SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT) return null;
  return error;
}

function readStreamVersionConflict(error) {
  if (!isCommandResultError(error)) return null;
  const resultError = error.data.error;
  if (resultError.code !== SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT) return null;
  return resultError;
}

function requireConflictOptions(owner, conflictOptions) {
  if (!isObjectLike(conflictOptions)) {
    throw new TypeError(`${owner} requires conflictOptions`);
  }
}

export function isNewerSessionAggregateVersion(nextVersion, currentVersion) {
  return isNewerProtocolAggregateVersion(nextVersion, currentVersion);
}

export function applyLatestSessionAggregateVersion(session, source) {
  if (!isObjectLike(session) || !isObjectLike(source)) {
    throw new TypeError("applyLatestSessionAggregateVersion requires a session and a source");
  }
  if (!isNewerSessionAggregateVersion(source.aggregateVersion, session.aggregateVersion))
    return false;
  session.aggregateVersion = source.aggregateVersion;
  return true;
}

export function createSessionAggregateVersionManager({ activeSession, log = null }) {
  if (!isObjectLike(activeSession) || !("value" in activeSession)) {
    throw new TypeError("createSessionAggregateVersionManager requires an activeSession ref");
  }
  function getVersion() {
    return getCurrentSessionAggregateVersion(activeSession);
  }

  function applyConflictVersion({ sessionId, previousVersion, conflict, logContext }) {
    const { currentVersion } = conflict;
    const changed = applyLatestSessionAggregateVersion(activeSession.value, {
      aggregateVersion: currentVersion,
    });
    log?.("versionConflict.version.apply", {
      sessionId,
      ...logContext,
      currentVersion,
      previousVersion,
      applied: changed,
    });
    return changed;
  }

  async function runWithConflictRetry({ attemptAt, readConflict, conflictOptions }) {
    let expectedAggregateVersion = getVersion();
    try {
      return await attemptAt(expectedAggregateVersion, 1);
    } catch (error) {
      const conflict = readConflict(error);
      if (!conflict) throw error;
      const versionApplied = applyConflictVersion({
        previousVersion: expectedAggregateVersion,
        conflict,
        ...conflictOptions,
      });
      if (!versionApplied) throw error;
      expectedAggregateVersion = getVersion();
      return attemptAt(expectedAggregateVersion, 2);
    }
  }

  async function runAggregateVersionedMutation({ mutate, shouldRetry, conflictOptions }) {
    requireFunctionDependencies("runAggregateVersionedMutation", { mutate });
    if (typeof shouldRetry !== "boolean") {
      throw new TypeError("runAggregateVersionedMutation requires a boolean shouldRetry");
    }
    requireConflictOptions("runAggregateVersionedMutation", conflictOptions);
    return runWithConflictRetry({
      attemptAt: async (expectedAggregateVersion, attempt) => ({
        payload: await mutate({ expectedAggregateVersion, attempt }),
        expectedAggregateVersion,
        attempt,
      }),
      readConflict: shouldRetry ? readMutationVersionConflict : () => null,
      conflictOptions,
    });
  }

  async function runAggregateVersionedStream({ buildPayload, stream, conflictOptions }) {
    requireFunctionDependencies("runAggregateVersionedStream", { buildPayload, stream });
    requireConflictOptions("runAggregateVersionedStream", conflictOptions);
    return runWithConflictRetry({
      attemptAt: async (expectedAggregateVersion, attempt) => {
        const payload = buildPayload({ expectedAggregateVersion, attempt });
        await stream(payload);
        return { payload, expectedAggregateVersion, attempt };
      },
      readConflict: readStreamVersionConflict,
      conflictOptions,
    });
  }

  return {
    getVersion,
    applyConflictVersion,
    runAggregateVersionedMutation,
    runAggregateVersionedStream,
  };
}
