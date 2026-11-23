/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitIndexedTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  decideTurnAcceptanceVersionAdvance,
  materializeTurnTerminalMessages,
  requireNextTurnAcceptanceVersion,
} from "@noobot/session-protocol";
import { prepareImmutableMessages } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { appendImmutableEvent } from "./immutable-event-changes.js";
import { immutableLifecycleCommandKey, writeImmutableCommand } from "./immutable-command-index.js";

export async function prepareImmutableTurnCommit({
  store,
  plan,
  event,
  messages = [],
  now,
  createEventId,
}) {
  if (event.sessionId !== store.sessionId)
    throw new TypeError("Lifecycle session ownership mismatch");
  const metadata = await plan.get("metadata", "session");
  const header = await plan.get("metadata", "lifecycle");
  const events = await plan.get("metadata", "events");
  if (!metadata || !header || !events)
    throw immutableStorageError("Immutable lifecycle is not initialized");
  const result = await commitIndexedTurnLifecycle({
    header,
    event,
    now,
    createEventId,
    parentSessionId: metadata.parentSessionId,
    readTurn: (key) => plan.get("lifecycle", key),
    readReplacement: (key) => plan.get("replacements", key),
    readCommand: (key) => plan.get("commands", immutableLifecycleCommandKey(key)),
    isCommittedEventId: async (key) => (await plan.get("events", key)) !== null,
    readPreparedEvent: async (key) => {
      const record = await plan.get("events", key);
      if (record === null)
        throw immutableStorageError("Lifecycle receipt references a missing event");
      return record;
    },
    materializeTerminal: async ({ terminalStatus, previousSummaryVersion }) => {
      const turn = await plan.get("turns", terminalStatus.turnScopeId);
      if (turn && turn.dialogProcessId !== terminalStatus.dialogProcessId)
        return { materialized: false, reason: "turn_execution_identity_conflict" };

      return materializeTurnTerminalMessages({
        messages: [],
        terminalStatus,
        previousSummaryVersion,
      });
    },
  });
  if (!result.applied) return result;
  for (const turn of result.changedTurns) plan.set("lifecycle", turn.turnScopeId, turn);
  const updatedAt = result.turn.updatedAt;
  if (messages.length) {
    await prepareImmutableMessages({ store, plan, messages, updatedAt });
  } else {
    plan.set("metadata", "session", { ...metadata, updatedAt });
  }
  if (decideTurnAcceptanceVersionAdvance(event, messages)) {
    const current = await plan.get("metadata", "session");
    plan.set("metadata", "session", {
      ...current,
      aggregateVersion: requireNextTurnAcceptanceVersion(current.aggregateVersion),
    });
  }
  await writeImmutableCommand(store, plan, result.commandReceipt);
  plan.set("metadata", "lifecycle", { ...header, ...result.header });
  await appendImmutableEvent(store, plan, { ...result.committedEvent, deliveries: {} });
  return result;
}
