/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { selectContextSourceMessageUids } from "@noobot/context-protocol/assembly/source";
import { assertSessionMessageEntity } from "@noobot/session-protocol";
import {
  immutableValueIndexReferences,
  IMMUTABLE_CONTEXT_INDEX_VERSION,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableOrderKey } from "./immutable-order-key.js";
import { readImmutableContextCandidates } from "./immutable-context-source-index.js";
import { runStorageBatch } from "./storage-batch-results.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  readImmutableDialogTail,
  requireImmutableMessageTailIndex,
} from "./immutable-message-tail-index.js";

async function* readHistoryDialogs(store, snapshot, facts) {
  const plan = { get: (collection, key) => store.get(snapshot, collection, key) };
  await requireImmutableMessageTailIndex(plan);
  if (!facts.lastMessageUid) {
    if (facts.messageCount !== 0)
      throw immutableStorageError("Context history has no committed message tail");
    return;
  }
  let dialogProcessId = await plan.get("dialogOrder", immutableOrderKey(facts.lastDialogOrdinal));
  if (typeof dialogProcessId !== "string" || !dialogProcessId)
    throw immutableStorageError("Context history tail references a missing dialog");
  let nextDialogProcessId = null;
  let nextOrdinal = null;
  while (dialogProcessId) {
    const dialog = await plan.get("dialogs", dialogProcessId);
    const tail = await readImmutableDialogTail(plan, dialogProcessId);
    if (
      dialog?.dialogProcessId !== dialogProcessId ||
      !Number.isSafeInteger(dialog.dialogOrdinal) ||
      dialog.dialogOrdinal < 1 ||
      (nextOrdinal === null
        ? dialog.dialogOrdinal !== facts.lastDialogOrdinal ||
          tail.messageUid !== facts.lastMessageUid
        : dialog.dialogOrdinal >= nextOrdinal || tail.nextDialogProcessId !== nextDialogProcessId)
    )
      throw immutableStorageError("Context history dialog tail ownership or order mismatch");
    yield dialogProcessId;
    nextDialogProcessId = dialogProcessId;
    nextOrdinal = dialog.dialogOrdinal;
    dialogProcessId = tail.previousDialogProcessId;
  }
}

async function readDialogSource(store, snapshot, dialogProcessId, scope, historyLimit) {
  const descriptor = await store.get(snapshot, "dialogTurns", dialogProcessId);
  immutableValueIndexReferences("dialogTurns", dialogProcessId, descriptor, store.requireReference);
  if (descriptor.count === 0)
    throw immutableStorageError("Context history dialog has no turn membership");
  const records = [];
  const turns = {};
  for (let position = 1; position <= descriptor.count; position += 1) {
    const reference = await store.index.get(descriptor.root, immutableOrderKey(position));
    if (!reference) throw immutableStorageError("Dialog turn position is missing");
    const turnScopeId = await store.objects.readValue(reference);
    if (turnScopeId === scope?.turnScopeId) continue;
    const turn = await store.get(snapshot, "turns", turnScopeId);
    if (!turn || turn.dialogProcessId !== dialogProcessId)
      throw immutableStorageError("Dialog turn ownership mismatch");
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    if (lifecycle) turns[turnScopeId] = lifecycle;
    records.push(...(await readImmutableContextCandidates({ store, snapshot, turn, lifecycle })));
  }
  records.sort((a, b) => a.value.ordinal - b.value.ordinal);
  const source = {
    messages: records.map(({ value }) => value.message),
    turnLifecycle: { turns },
  };
  const selected = selectContextSourceMessageUids({ source, scope, historyLimit });
  const retained = records.filter(({ value }) => selected.has(value.message.messageUid));
  await runStorageBatch(retained, async ({ value, parts }) => {
    for (const part of parts)
      value[part.path[0]][part.path[1]] = await store.objects.readValue(part.reference);
    try {
      assertSessionMessageEntity(value.message);
    } catch (cause) {
      throw immutableStorageError("Invalid immutable context message entity", cause);
    }
  });
  return { ...source, messages: retained.map(({ value }) => value.message) };
}

export async function readImmutableContextSource({ store, snapshot, scope, historyLimit }) {
  return store.objects.withSnapshot(snapshot, () =>
    readContextSource({ store, snapshot, scope, historyLimit }),
  );
}

async function readContextSource({ store, snapshot, scope, historyLimit }) {
  if (!Number.isInteger(historyLimit) || historyLimit < 0)
    throw new TypeError("Context history window requires a nonnegative integer limit");
  const facts = await store.get(snapshot, "metadata", "facts");
  if (facts?.contextIndexVersion !== IMMUTABLE_CONTEXT_INDEX_VERSION)
    throw Object.assign(new Error("Immutable context indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  const lifecycle = await store.get(snapshot, "metadata", "lifecycle");
  const retained = [];
  const turns = {};
  if (historyLimit === 0) return { messages: [], turnLifecycle: { ...lifecycle, turns } };
  for await (const dialogProcessId of readHistoryDialogs(store, snapshot, facts)) {
    if (dialogProcessId === scope?.dialogProcessId) continue;
    const source = await readDialogSource(store, snapshot, dialogProcessId, scope, historyLimit);
    if (!source.messages.length) continue;
    retained.unshift(source.messages);
    Object.assign(turns, source.turnLifecycle.turns);
    if (retained.length >= historyLimit) break;
  }
  return { messages: retained.flat(), turnLifecycle: { ...lifecycle, turns } };
}
