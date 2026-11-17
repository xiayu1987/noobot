/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitIndexedTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  decideAggregateConcurrency,
  materializeTurnTerminalMessages,
} from "@noobot/session-protocol";
import { ImmutableSessionChanges, prepareImmutableMessages } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { appendImmutableEvent } from "./immutable-event-changes.js";
import { immutableLifecycleCommandKey, writeImmutableCommand } from "./immutable-command-index.js";

export async function prepareImmutableTurnCommit({
  store,
  get,
  getMetadata,
  event,
  messages = [],
  now,
  createEventId,
}) {
  if (event.sessionId !== store.sessionId)
    throw new TypeError("Lifecycle session ownership mismatch");
  const plan = new ImmutableSessionChanges(get, {
    getMetadata,
    readContent: (reference) => store.objects.readValue(reference),
    readContentMetadata: (reference) => store.objects.readValueMetadata(reference),
  });
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
  if (!result.applied) return { abort: true, changes: [], result };
  for (const turn of result.changedTurns) plan.set("lifecycle", turn.turnScopeId, turn);
  const updatedAt = result.turn.updatedAt;
  if (messages.length) {
    const prepared = await prepareImmutableMessages({
      store,
      get: (collection, key) => plan.get(collection, key),
      getMetadata: (collection, key) => plan.getMetadata(collection, key),
      messages,
      updatedAt,
    });
    for (const change of prepared.changes) await plan.apply(change);
  } else {
    plan.set("metadata", "session", { ...metadata, updatedAt });
  }
  if (
    event.eventType === "turn.action_accepted" &&
    messages.some(
      (message) => message.role === "user" && message.turnCommit?.commandId === event.causationId,
    )
  ) {
    const current = await plan.get("metadata", "session");
    const concurrency = decideAggregateConcurrency({
      expectedAggregateVersion: null,
      aggregateVersion: current.aggregateVersion,
    });
    if (!concurrency.allowed)
      throw new TypeError(`Turn acceptance rejected: ${concurrency.reason}`);
    plan.set("metadata", "session", {
      ...current,
      aggregateVersion: concurrency.nextAggregateVersion,
    });
  }
  await writeImmutableCommand(store, plan, result.commandReceipt);
  plan.set("metadata", "lifecycle", { ...header, ...result.header });
  await appendImmutableEvent(store, plan, { ...result.committedEvent, deliveries: {} });
  return { changes: plan.changes(), result };
}
