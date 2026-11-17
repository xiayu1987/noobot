/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { immutableStorageError } from "./immutable-object-store.js";

function memberships(message) {
  const pairs = new Map();
  if (!message) return pairs;
  const key = (id) => JSON.stringify([message.dialogProcessId, message.turnScopeId, id]);
  for (const call of resolveContextToolCalls(message)) {
    const id = resolveContextToolCallDeclarationId(call);
    if (id) pairs.set(key(id), "declaration");
  }
  const result = resolveContextToolResultCallId(message);
  if (result) pairs.set(key(result), "result");
  return pairs;
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
  const before = memberships(previous);
  const after = memberships(message);
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

export async function assertImmutableToolPairClosure(get, messages, summarizedMessageUids) {
  const selected = new Set(summarizedMessageUids);
  const counts = new Map();
  for (const message of messages) {
    if (!selected.has(message.messageUid)) continue;
    for (const key of memberships(message).keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, selectedCount] of counts) {
    const pair = await get("toolPairs", key);
    if (!pair) throw immutableStorageError("Selected message has no tool pair index");
    if (pair.ownerUid && selectedCount !== pair.resultCount + 1)
      throw Object.assign(
        new Error(`summary checkpoint splits tool call pair: ${JSON.parse(key)[2]}`),
        {
          code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT,
          statusCode: 409,
        },
      );
  }
}
