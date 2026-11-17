/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  IMMUTABLE_MESSAGE_TAIL_VERSION,
  seedImmutableMessageTails,
  appendImmutableMessageTail,
} from "./immutable-message-tail-index.js";

function requireMessageFacts(facts) {
  if (
    !facts ||
    !Number.isSafeInteger(facts.messageSequence) ||
    facts.messageSequence < 0 ||
    facts.messageCount !== facts.messageSequence
  )
    throw immutableStorageError("Invalid session facts during message tail upgrade");
  return facts;
}

async function rebuildMessageTails(plan, dialogs, facts, { get, sessionId }) {
  const byId = new Map(dialogs.map((dialog) => [dialog.dialogProcessId, dialog]));
  const nextFacts = {
    ...facts,
    lastMessageUid: "",
    lastMessageOrdinal: 0,
    lastDialogOrdinal: 0,
  };
  const visited = new Set();
  for (let ordinal = 1; ordinal <= facts.messageSequence; ordinal += 1) {
    const uid = await get("messageOrder", immutableOrderKey(ordinal));
    const record = uid && (await get("messages", uid));
    const dialog = record && byId.get(record.message.dialogProcessId);
    if (
      !dialog ||
      record.ordinal !== ordinal ||
      record.message.messageUid !== uid ||
      record.message.sessionId !== sessionId
    )
      throw immutableStorageError("Message order ownership mismatch during tail upgrade");
    visited.add(dialog.dialogProcessId);
    await appendImmutableMessageTail(plan, record.message);
    if (dialog.dialogOrdinal < nextFacts.lastDialogOrdinal) continue;
    nextFacts.lastMessageUid = uid;
    nextFacts.lastMessageOrdinal = ordinal;
    nextFacts.lastDialogOrdinal = dialog.dialogOrdinal;
  }
  if (visited.size !== dialogs.length)
    throw immutableStorageError("Empty dialog during message tail upgrade");
  return nextFacts;
}

export async function upgradeImmutableMessageTailIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-message-tail-index:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const version = await get("metadata", "messageTailIndex");
      if (version?.version === IMMUTABLE_MESSAGE_TAIL_VERSION)
        return { abort: true, changes: [], result: { upgraded: false } };
      if (version !== null && ![1, 2].includes(version?.version))
        throw immutableStorageError("Unknown message tail index version");
      const plan = new ImmutableSessionChanges(get);
      const facts = requireMessageFacts(await get("metadata", "facts"));
      for (const collection of ["dialogTails", "messagePredecessors"])
        for await (const [key] of store.entries(pinned, collection)) plan.remove(collection, key);
      const dialogs = [];
      for await (const [, dialog] of store.entries(pinned, "dialogs")) dialogs.push(dialog);
      seedImmutableMessageTails(plan, dialogs);
      const nextFacts = await rebuildMessageTails(plan, dialogs, facts, { get, sessionId });
      plan.set("metadata", "facts", nextFacts);
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
