/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { filePath as path } from "@noobot/path-resolver";
import { open } from "node:fs/promises";
import {
  EXECUTION_LOG_PROJECTION_CURSOR_FILE,
  requireExecutionLogProjectionCursor,
  requireExecutionLogProjectionDelivery,
  executionLogProjectionFailure,
} from "@noobot/session-protocol";
import {
  readExecutionTurnIndex,
  resolveExecutionTurnDir,
} from "./session-artifact-execution-logs.js";
import { writeDurableReplacement, withStorageCleanup } from "./session-artifact-io.js";

export async function projectTurnExecutionLogs({
  storageService,
  sessionDir,
  dialogProcessId,
  deliver,
  readProjectionBatches,
}) {
  if (!isFunction(deliver)) throw new TypeError("Execution projection requires delivery port");
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const index = await readExecutionTurnIndex({ storageService, turnDir });
  if (index === null || !index.segments.length) return { records: 0, pending: false };
  const cursorFile = path.join(turnDir, EXECUTION_LOG_PROJECTION_CURSOR_FILE);
  let cursor = await storageService.readOptionalJson(cursorFile);
  if (cursor === null) cursor = { version: 1, sequence: 1, offset: 0 };
  requireExecutionLogProjectionCursor(cursor);
  const start = cursor.sequence - 1;
  if (index.segments[start]?.sequence !== cursor.sequence)
    throw new Error("Execution projection cursor names an absent segment");
  for (let position = start; position < index.segments.length; position += 1) {
    const segment = index.segments[position];
    const offset = position === start ? cursor.offset : 0;
    if (offset > segment.bytes)
      throw new Error("Execution projection cursor exceeds source boundary");
    if (offset === segment.bytes) continue;
    const handle = await open(path.join(turnDir, segment.file), "r");
    return withStorageCleanup(
      async () => {
        const sourceInfo = await handle.stat({ bigint: true });
        if (sourceInfo.size !== BigInt(segment.bytes))
          throw new Error("Execution projection source requires index repair");
        if (offset > 0) {
          const boundary = Buffer.alloc(1);
          await handle.read(boundary, 0, 1, offset - 1);
          if (boundary[0] !== 10)
            throw new Error("Execution projection cursor splits a source record");
        }
        for await (const batch of readProjectionBatches({
          handle,
          segment,
          dialogProcessId,
          offset,
          sourceInfo,
        })) {
          const outcomes = requireExecutionLogProjectionDelivery(
            batch.records,
            await deliver(batch.records, { receiptDirectory: turnDir }),
          );
          const next = { version: 1, sequence: segment.sequence, offset: batch.end };
          try {
            await writeDurableReplacement(cursorFile, `${JSON.stringify(next)}\n`);
          } catch (cause) {
            throw executionLogProjectionFailure(
              cause,
              batch.records.map(({ record }) => record),
              outcomes,
            );
          }
          return {
            records: batch.records.length,
            pending: batch.end < segment.bytes || position < index.segments.length - 1,
          };
        }
      },
      () => handle.close(),
    );
  }
  return { records: 0, pending: false };
}
