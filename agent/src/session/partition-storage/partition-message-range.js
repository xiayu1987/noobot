/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  createSessionMessagePageRecord,
  nextSessionMessagePageCursor,
  requireMessagePage,
  requirePageBounds,
  requireSessionMessagePageDirection,
  requireSessionMessagePagePosition,
  sessionMessagePageLength,
  sessionMessagePageWindow,
} from "@noobot/session-protocol/message-read-budget";
import {
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";
import { requiresDisplayMessageContent } from "../session-summary-builders/message-summary-projection.js";
import { hasToolResultArtifacts } from "../session-summary-builders/turn-artifact-projection.js";
import {
  materializeMessage,
  readPartitionSuffixAnchor,
  readSessionOrderRecord,
} from "./partition-message-reader.js";

export class PartitionMessageRange {
  #transactions;

  constructor(journal, scope) {
    this.#transactions = new PartitionSessionTransactions(journal, scope);
  }

  readPage(snapshot, options) {
    return this.#readGlobalPage(snapshot, options, { purpose: "global" });
  }

  readDisplaySourcePage(snapshot, options) {
    return this.#readGlobalPage(snapshot, options, {
      purpose: "display-source",
      selectContent: (message) =>
        requiresDisplayMessageContent(message) || hasToolResultArtifacts(message),
    });
  }

  #readGlobalPage(
    snapshot,
    {
      cursor = null,
      limit = QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize,
      maxBytes,
      direction = "forward",
    } = {},
    { purpose, selectContent },
  ) {
    requireSessionMessagePageDirection(direction);
    const position = requireSessionMessagePagePosition(
      [snapshot.sessionId, snapshot.epoch, snapshot.sequence, purpose, direction],
      cursor,
    );
    const budget = requirePageBounds({ after: position.after, limit, maxBytes });
    return this.#transactions.read(snapshot, async (read, scope) => {
      const messageCount = await readPartitionSessionMessageCount(read);
      const window = sessionMessagePageWindow({
        after: position.after,
        count: messageCount,
        limit: Math.min(limit, snapshot.limits.pageRecords),
        direction,
      });
      const records = await readWindow({
        read,
        scope,
        snapshot,
        position: { ...position, after: window.after },
        limit: window.length,
        count: messageCount,
        budget,
        selectContent,
        direction,
      });
      return {
        generation: snapshot.sequence,
        messageCount,
        records,
        nextCursor: nextSessionMessagePageCursor(
          position,
          records.length,
          position.after + records.length < messageCount,
        ),
      };
    });
  }

  readTailPage(
    snapshot,
    {
      turnScopeId,
      cursor = null,
      limit = QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize,
      maxBytes,
    },
  ) {
    const position = requireSessionMessagePagePosition(
      [snapshot.sessionId, snapshot.epoch, snapshot.sequence, "suffix", turnScopeId],
      cursor,
    );
    const budget = requireMessagePage({ turnScopeId, after: position.after, limit, maxBytes });
    return this.#transactions.read(snapshot, async (read, scope, { generation }) => {
      const suffix = await readPartitionSuffixAnchor({
        read,
        scope,
        snapshot,
        turnScopeId,
        generation,
      });
      if (suffix === null) return null;
      const { messageSuffix, deletedCount, retainedMessageCount } = suffix;
      const records = await readWindow({
        read,
        scope,
        snapshot,
        position,
        limit,
        count: deletedCount,
        budget,
        firstOrdinal: retainedMessageCount + 1,
      });
      return {
        generation: snapshot.sequence,
        messageSuffix,
        records,
        nextCursor: nextSessionMessagePageCursor(
          position,
          records.length,
          position.after + records.length < deletedCount,
        ),
      };
    });
  }
}

async function readWindow({
  read,
  scope,
  snapshot,
  position,
  limit,
  count,
  budget,
  firstOrdinal = 1,
  selectContent,
  direction = "forward",
}) {
  const length = Math.min(
    snapshot.limits.pageRecords,
    sessionMessagePageLength(position.after, count, limit),
  );
  const projected = await read.readWindow(length, async (index) => {
    const offset = direction === "backward" ? length - index - 1 : index;
    const record = await readSessionOrderRecord(
      { read, scope, snapshot },
      firstOrdinal + position.after + offset,
    );
    const { lifecycle } = await requirePartitionVisibleMessageTurnOwnership(read, [record]);
    const ordinal = record.sessionOrdinal;
    const { turnOrdinal } = record;
    budget.consume("bytes", Buffer.byteLength(JSON.stringify({ ordinal, turnOrdinal })));
    const message = await materializeMessage(read, {
      snapshot,
      record,
      lifecycle: lifecycle.get(record.message.turnScopeId),
      budget,
      selectContent,
    });
    return createSessionMessagePageRecord({ ordinal, turnOrdinal, message });
  });
  return direction === "backward" ? projected.reverse() : projected;
}
