/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_COMMAND } from "@noobot/session-protocol";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  immutableLifecycleCommandKey,
  immutableAttachmentBindingKey,
  indexImmutableCommand,
} from "./immutable-command-index.js";

async function upgradeCommandEntry({ store, plan, get, key, value }) {
  const identity = JSON.parse(key);
  if (identity[0] === "lifecycle" && key === immutableLifecycleCommandKey(value?.commandId)) {
    await indexImmutableCommand(store, plan, value);
    if (
      value.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND &&
      (await get("commands", immutableAttachmentBindingKey(value.result.messageUid))) !==
        value.commandId
    )
      throw immutableStorageError("Command upgrade found a missing attachment binding");
    return;
  }
  if (identity[0] !== "attachmentBinding" || identity.length !== 2)
    throw immutableStorageError("Command upgrade found an invalid command key");
  const receipt = await get("commands", immutableLifecycleCommandKey(value));
  if (
    receipt?.type !== SESSION_COMMAND.TURN_ATTACHMENTS_BIND ||
    receipt.result?.messageUid !== identity[1] ||
    key !== immutableAttachmentBindingKey(identity[1])
  )
    throw immutableStorageError("Command upgrade found an orphan attachment binding");
}

export async function upgradeImmutableCommandIndexes({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-command-indexes:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const header = await get("metadata", "commandIndex");
      if (header?.version === 1) return { abort: true, changes: [], result: { upgraded: false } };
      if (header !== null || !(await get("metadata", "lifecycle")))
        throw immutableStorageError("Invalid command index version during upgrade");
      const plan = new ImmutableSessionChanges(get);
      for await (const [scope] of store.entries(pinned, "turnCommands"))
        plan.remove("turnCommands", scope);
      for await (const [key, value] of store.entries(pinned, "commands")) {
        await upgradeCommandEntry({ store, plan, get, key, value });
      }
      plan.set("metadata", "commandIndex", { version: 1 });
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
