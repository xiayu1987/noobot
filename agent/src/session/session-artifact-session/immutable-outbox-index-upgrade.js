/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { indexImmutableOutboxEvent } from "./immutable-outbox-turn-index.js";

export async function upgradeImmutableOutboxIndexes({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-outbox-indexes:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const header = await get("metadata", "events");
      if (header?.outboxIndexVersion === 1)
        return { abort: true, changes: [], result: { upgraded: false } };
      if (!header || Object.hasOwn(header, "outboxIndexVersion"))
        throw immutableStorageError("Invalid outbox index version during upgrade");
      const plan = new ImmutableSessionChanges(get);
      for await (const [scope] of store.entries(pinned, "turnOutbox"))
        plan.remove("turnOutbox", scope);
      for await (const [key, source] of store.entries(pinned, "outbox")) {
        const [event] = normalizeAuthorityEventOutbox([source]);
        const committed = await get("events", key);
        if (
          event.eventId !== key ||
          event.envelope.identity.sessionId !== sessionId ||
          !committed ||
          JSON.stringify(event.envelope) !== JSON.stringify(committed.envelope) ||
          event.committedAt !== committed.committedAt
        )
          throw immutableStorageError("Outbox index upgrade found an uncommitted event");
        await indexImmutableOutboxEvent(store, plan, event);
      }
      plan.set("metadata", "events", { ...header, outboxIndexVersion: 1 });
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
