/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_SCOPES, RUNTIME_EVENT_ERROR_CODE } from "./constants.js";
import path from "node:path";
import {
  requireExecutionProjectionDeliveryContext,
  requireExecutionProjectionSourceOwner,
  executionProjectionReceiptName,
} from "@noobot/session-protocol";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { attachRuntimeEventPayload, normalizeRuntimeEventEnvelope } from "./schema.js";
import { resolveRuntimeEventFile, resolveRuntimeEventsConfig } from "./paths.js";
import { appendJsonLine, flushJsonLineBatches } from "./transports/jsonl.js";
import { isSessionLogDebugEvent, shouldRecordSessionLog } from "./session-log-protocol.js";
import { resolveWorkspaceSessionLocation } from "./session-location.js";
import { reportRuntimeEventFailure } from "./failure-report.js";
import { withSessionEventPublications } from "./session-publication.js";

const pendingWrites = new Set();
const flushBarriers = new Set();

export async function flushRuntimeEvents() {
  const failures = new Set();
  flushBarriers.add(failures);
  try {
    do {
      await drainRuntimeEventWrites();
    } while (pendingWrites.size);
    if (failures.size) throw new AggregateError(failures, "Runtime event flush failed");
  } finally {
    flushBarriers.delete(failures);
  }
}

async function drainRuntimeEventWrites() {
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
  try {
    await flushJsonLineBatches();
  } catch (error) {
    if (!(error instanceof AggregateError)) throw error;
    for (const failure of error.errors) recordWriteFailure(failure);
  }
}

function recordWriteFailure(error) {
  for (const failures of flushBarriers) failures.add(error);
}

export async function writeRuntimeEvent(event = {}, options = {}) {
  const [result] = await writeRuntimeEvents([event], options);
  return result;
}

export function writeRuntimeEvents(events, options) {
  const pending = prepareAndWriteRuntimeEvents(events, options)
    .then(
      (results) => {
        for (const result of results) {
          if (!result.ok) recordWriteFailure(result.error);
        }
        return results;
      },
      (error) => {
        recordWriteFailure(error);
        throw error;
      },
    )
    .finally(() => pendingWrites.delete(pending));
  pendingWrites.add(pending);
  return pending;
}

async function prepareAndWriteRuntimeEvents(
  events,
  { desktopRoot = "", locationResolver, projection } = {},
) {
  if (
    !Array.isArray(events) ||
    !events.length ||
    events.length > QUANTITY_THRESHOLDS.runtimeEvents.batchMaxRecords
  )
    throw new TypeError("Runtime event batch exceeds its protocol record budget");
  const config = resolveRuntimeEventsConfig({ desktopRoot });
  if (projection !== undefined) requireExecutionProjectionDeliveryContext(projection);
  const records = events.map((event) => prepareRecord(event, config));
  const sessionRecords = records
    .filter(({ record, skipped }) => !skipped && record.scope === RUNTIME_EVENT_SCOPES.SESSION)
    .map(({ record }) => record);
  return withSessionEventPublications(config.workspaceRoot, sessionRecords, () =>
    writePreparedRuntimeEvents(records, { config, locationResolver, projection }),
  );
}

async function writePreparedRuntimeEvents(records, { config, locationResolver, projection }) {
  const locations = new Map();
  const prepared = [];
  for (const item of records)
    prepared.push(await prepareOutput(item, { config, locations, locationResolver, projection }));
  return Promise.all(
    prepared.map((item) => (Object.hasOwn(item, "ok") ? item : appendPrepared(item, config))),
  );
}

async function sessionLocation(record, { config, locations, locationResolver }) {
  const key = JSON.stringify([record.userId, record.sessionId]);
  if (!locations.has(key))
    locations.set(
      key,
      await resolveWorkspaceSessionLocation({
        workspaceRoot: config.workspaceRoot,
        userId: record.userId,
        sessionId: record.sessionId,
        locationResolver,
      }),
    );
  return locations.get(key);
}

function outputProjection(record, file, projection) {
  if (projection === undefined) return undefined;
  const sourceId = record.data?.executionLogSourceId;
  if (record.scope !== RUNTIME_EVENT_SCOPES.SESSION)
    throw new TypeError("Projection requires a session event");
  requireExecutionProjectionSourceOwner(sourceId, record);
  return {
    file: path.join(
      projection.receiptDirectory,
      executionProjectionReceiptName(path.basename(file)),
    ),
    sourceId,
  };
}

async function prepareOutput(item, context) {
  if (item.skipped) return item;
  const { record } = item;
  let sessionDir = "";
  if (record.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    const location = await sessionLocation(record, context);
    if (location.missingSession) {
      const error = Object.assign(new Error("Runtime event session is not registered"), {
        code: RUNTIME_EVENT_ERROR_CODE.SESSION_NOT_REGISTERED,
      });
      reportRuntimeEventFailure(
        "session not registered",
        {
          userId: record.userId,
          sessionId: record.sessionId,
        },
        error,
      );
      return { ok: false, error, record };
    }
    if (location.deleted) return { ok: true, skipped: true, record, deleted: true };
    sessionDir = location.sessionDir;
  }
  const file = resolveRuntimeEventFile(record, context.config, { sessionDir });
  return { record, file, projection: outputProjection(record, file, context.projection) };
}

function prepareRecord(event, config) {
  if (config.desktopRoot && event.scope === RUNTIME_EVENT_SCOPES.SESSION) {
    throw new Error("Session runtime events are owned by the workspace and cannot use desktopRoot");
  }
  const record = normalizeRuntimeEventEnvelope(event);
  record.time = new Date().toISOString();
  const controlledLog =
    record.scope === RUNTIME_EVENT_SCOPES.SESSION || isSessionLogDebugEvent(record);
  if (controlledLog && !shouldRecordSessionLog(record)) {
    return { ok: true, skipped: true, record };
  }
  attachRuntimeEventPayload(record, event);
  return { record };
}

async function appendPrepared({ record, file, projection }, config) {
  let writeResult;
  try {
    writeResult = await appendJsonLine(file, record, {
      maxFileBytes: config.maxFileBytes,
      retentionDays: config.retentionDays,
      maxArchives: config.maxArchives,
      projection,
    });
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
