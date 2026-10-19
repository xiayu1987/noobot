/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_SCOPES } from "./constants.js";
import { attachRuntimeEventPayload, normalizeRuntimeEventEnvelope } from "./schema.js";
import { resolveRuntimeEventFile, resolveRuntimeEventsConfig } from "./paths.js";
import { appendJsonLine } from "./transports/jsonl.js";
import { isSessionLogDebugEvent, shouldRecordSessionLog } from "./session-log-protocol.js";
import { resolveWorkspaceSessionLocation } from "./session-location.js";
import { reportRuntimeEventFailure } from "./failure-report.js";

export async function writeRuntimeEvent(event = {}, { desktopRoot = "" } = {}) {
  const config = resolveRuntimeEventsConfig({ desktopRoot });
  if (config.desktopRoot && event.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    throw new Error("Session runtime events are owned by the workspace and cannot use desktopRoot");
  }
  const record = normalizeRuntimeEventEnvelope(event);
  const controlledLog =
    record.scope === RUNTIME_EVENT_SCOPES.SESSION || isSessionLogDebugEvent(record);
  if (controlledLog && !shouldRecordSessionLog(record)) {
    return { ok: true, skipped: true, record };
  }
  attachRuntimeEventPayload(record, event);
  let sessionDir = "";
  if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    const location = await resolveWorkspaceSessionLocation({
      workspaceRoot: config.workspaceRoot,
      userId: record.userId,
      sessionId: record.sessionId,
      parentSessionId: record.parentSessionId,
    });
    if (location.deleted) return { ok: true, skipped: true, deleted: true, record };
    if (location.missingSession) return { ok: true, skipped: true, missingSession: true, record };
    sessionDir = location.sessionDir;
  }
  const file = resolveRuntimeEventFile(record, config, { sessionDir });

  const pendingWrite = appendJsonLine(file, record, {
    maxFileBytes: config.maxFileBytes,
    retentionDays: config.retentionDays,
    maxArchives: config.maxArchives,
  });
  let writeResult;
  try {
    writeResult = await pendingWrite;
  } catch (error) {
    reportRuntimeEventFailure(
      "write failed",
      { scope: record.scope, source: record.source, event: record.event, file },
      error,
    );
    return { ok: false, error, record, file };
  }
  return {
    ok: true,
    file,
    record,
    rotatedFile: writeResult.rotatedFile,
    deletedFiles: writeResult.deletedFiles,
    cleanupError: writeResult.cleanupError,
  };
}
