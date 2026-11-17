/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  executionLogProjectionIdentity,
  executionLogProjectionFailure,
  requireExecutionLogProjectionDelivery,
} from "@noobot/session-protocol";

export function withExecutionLogProjection(port) {
  const sources = new Map();
  const keyOf = (userId, sessionId, turn) => JSON.stringify([userId, sessionId, turn]);
  return {
    ...port,
    async appendLogs(...args) {
      const records = await port.appendLogs(...args);
      for (const record of records) {
        const key = keyOf(args[0], args[1], record.dialogProcessId);
        let source = sources.get(key);
        if (!source) {
          source = { entries: [], offset: 0, acknowledged: 0 };
          sources.set(key, source);
        }
        source.entries.push({
          record,
          sourceId: executionLogProjectionIdentity(record.dialogProcessId, 1, source.offset),
        });
        source.offset += Buffer.byteLength(JSON.stringify(record)) + 1;
      }
      if (args[3]?.deliver) {
        try {
          await this.projectPendingLogs(args[0], args[1], {
            dialogProcessIds: records.map((record) => record.dialogProcessId),
            deliver: args[3].deliver,
          });
        } catch (cause) {
          throw executionLogProjectionFailure(
            cause,
            records,
            records.map(() => "unknown"),
          );
        }
      }
      return records;
    },
    async projectPendingLogs(userId, sessionId, { dialogProcessIds, deliver }) {
      let records = 0;
      for (const turn of new Set(dialogProcessIds)) {
        const source = sources.get(keyOf(userId, sessionId, turn));
        if (!source) continue;
        const pending = source.entries.slice(source.acknowledged);
        if (!pending.length) continue;
        requireExecutionLogProjectionDelivery(pending, await deliver(pending));
        source.acknowledged = source.entries.length;
        records += pending.length;
      }
      return { records };
    },
  };
}
