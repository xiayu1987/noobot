/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { summaryCheckpointToolPairMemberships } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import { requireToolPairMembershipHeader } from "@noobot/session-protocol/partition-tool-pairs";
import { immutableStorageError } from "./immutable-object-store.js";

export async function withImmutableToolPair(store, snapshot, identity, visit) {
  const pair = await store.get(snapshot, "toolPairs", identity);
  if (pair === null) return visit(null);
  const header = requireToolPairMembershipHeader({ ...pair, identity }, immutableStorageError);
  if (!header.ownerUid && !header.resultCount)
    throw immutableStorageError("Empty immutable tool pair");
  return store.objects.withSnapshot(snapshot, () => {
    async function checkResult(uid, reference) {
      if ((await store.objects.readValue(reference)) !== uid)
        throw immutableStorageError("Immutable tool result index identity mismatch");
    }
    return visit({
      header,
      async hasResult(uid) {
        const reference = await store.index.get(pair.resultsRoot, uid);
        if (reference === null) return false;
        await checkResult(uid, reference);
        return true;
      },
      async verifyResultCount(signal) {
        let count = 0;
        for await (const [uid, reference] of store.index.entries(pair.resultsRoot)) {
          signal?.throwIfAborted();
          await checkResult(uid, reference);
          count += 1;
        }
        if (count !== header.resultCount)
          throw immutableStorageError("Immutable tool result index count mismatch");
      },
    });
  });
}

async function removeMembership(store, pair, role, messageUid) {
  if (role === "declaration") {
    if (pair.ownerUid !== messageUid)
      throw immutableStorageError("Tool declaration index ownership mismatch");
    pair.ownerUid = "";
  } else if (role === "result") {
    if ((await store.index.get(pair.resultsRoot, messageUid)) === null)
      throw immutableStorageError("Tool result index membership missing");
    pair.resultsRoot = await store.index.set(pair.resultsRoot, messageUid, null);
    pair.resultCount -= 1;
  }
}

async function addMembership(store, pair, role, messageUid) {
  if (role === "declaration") {
    if (pair.ownerUid && pair.ownerUid !== messageUid)
      throw Object.assign(new Error("Tool call already has a declaration"), {
        code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
      });
    pair.ownerUid = messageUid;
  } else if (role === "result") {
    pair.resultsRoot = await store.index.set(
      pair.resultsRoot,
      messageUid,
      await store.objects.putValue(messageUid),
    );
    pair.resultCount += 1;
  }
}

export async function updateImmutableToolPairs(store, plan, previous, message) {
  const before = summaryCheckpointToolPairMemberships(previous);
  const after = summaryCheckpointToolPairMemberships(message);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) === after.get(key)) continue;
    const pair = {
      ...((await plan.get("toolPairs", key)) ?? {
        ownerUid: "",
        resultsRoot: null,
        resultCount: 0,
      }),
    };
    await removeMembership(store, pair, before.get(key), previous?.messageUid);
    await addMembership(store, pair, after.get(key), message?.messageUid);
    if (!Number.isSafeInteger(pair.resultCount) || pair.resultCount < 0)
      throw immutableStorageError("Invalid tool result count");
    if (!pair.ownerUid && pair.resultCount === 0) plan.remove("toolPairs", key);
    else plan.set("toolPairs", key, pair);
  }
}
