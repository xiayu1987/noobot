/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { LifecycleTerminalIndex } from "@noobot/session-protocol/lifecycle-terminal-index";
import { assertTurnRecord } from "@noobot/session-protocol";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";

const index = new LifecycleTerminalIndex(immutableStorageError);

async function requireImmutableLifecycleIndex(get) {
  const descriptor = await get("metadata", "lifecycleIndex");
  if (descriptor === null)
    throw Object.assign(new Error("Lifecycle index requires an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  return index.requireDescriptor(get);
}

export async function prepareImmutableLifecycleIndex(plan, { initialize = false } = {}) {
  if (
    !initialize &&
    plan.changes().some(({ collection }) => collection === "lifecycle" || collection === "turns")
  )
    await requireImmutableLifecycleIndex((...args) => plan.get(...args));
  return index.prepare(plan, { initialize });
}

export async function readImmutableLifecycleTurns(get, options) {
  await requireImmutableLifecycleIndex(get);
  return index.read(get, options);
}

export async function upgradeImmutableLifecycleIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-lifecycle-index:${snapshot.generation}`,
    input: {},
    prepare: async ({ get, snapshot: pinned }) => {
      if (await get("metadata", "lifecycleIndex")) {
        await requireImmutableLifecycleIndex(get);
        return { abort: true, changes: [], result: { upgraded: false } };
      }
      const plan = new ImmutableSessionChanges(get);
      for await (const [scope, turn] of store.entries(pinned, "lifecycle")) {
        assertTurnRecord(turn);
        if (turn.turnScopeId !== scope)
          throw immutableStorageError("Lifecycle upgrade ownership mismatch");
        plan.set("lifecycle", scope, turn);
      }
      await prepareImmutableLifecycleIndex(plan, { initialize: true });
      return {
        changes: plan.changes().filter(({ collection }) => collection !== "lifecycle"),
        result: { upgraded: true },
      };
    },
  });
}
