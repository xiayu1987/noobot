/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_TITLE_INDEX_VERSION,
  immutableTitleIndexRequiresUpgrade,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { seedImmutableTitleIndex, updateImmutableTitleCandidate } from "./immutable-title-index.js";

export async function upgradeImmutableTitleIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-title-index-v${IMMUTABLE_TITLE_INDEX_VERSION}:${snapshot.generation}`,
    input: {},
    prepare: async ({ get }) => {
      const descriptor = await get("metadata", "titleIndex");
      if (!immutableTitleIndexRequiresUpgrade(descriptor)) {
        if (descriptor.root !== null) store.requireReference(descriptor.root);
        return { abort: true, changes: [], result: { upgraded: false } };
      }
      const facts = await get("metadata", "facts");
      if (
        !facts ||
        !Number.isSafeInteger(facts.messageSequence) ||
        facts.messageSequence < 0 ||
        facts.messageCount !== facts.messageSequence
      )
        throw immutableStorageError("Invalid session facts during title index upgrade");
      const plan = new ImmutableSessionChanges(get);
      seedImmutableTitleIndex(plan);
      for (let ordinal = 1; ordinal <= facts.messageSequence; ordinal += 1) {
        const uid = await get("messageOrder", immutableOrderKey(ordinal));
        const record = uid && (await get("messages", uid));
        if (
          !record ||
          record.ordinal !== ordinal ||
          record.message.messageUid !== uid ||
          record.message.sessionId !== sessionId
        )
          throw immutableStorageError("Message ownership mismatch during title index upgrade");
        await updateImmutableTitleCandidate(store, plan, null, record);
      }
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
