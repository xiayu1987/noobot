/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readIndexedContextWindow } from "@noobot/context-protocol/assembly/source";
import { assertSessionMessageEntity } from "@noobot/session-protocol";
import { createContextReadBudget } from "@noobot/session-protocol/context-read-budget";
import {
  immutableValueIndexReferences,
  requireImmutableContextIndex,
} from "@noobot/session-protocol/immutable-storage-graph";
import { readImmutableContextDialogs } from "./immutable-context-directory.js";
import { iterateImmutableContextCandidates } from "./immutable-context-source-index.js";
import { immutableStorageError } from "./immutable-object-store.js";

async function* readContextTurnScopes(store, snapshot, dialogProcessId, budget) {
  const descriptor = await store.get(snapshot, "dialogTurns", dialogProcessId);
  immutableValueIndexReferences("dialogTurns", dialogProcessId, descriptor, store.requireReference);
  if (descriptor.count === 0)
    throw immutableStorageError("Context history dialog has no turn membership");
  const context = await store.get(snapshot, "contextTurns", dialogProcessId);
  immutableValueIndexReferences("contextTurns", dialogProcessId, context, store.requireReference);
  if (context.count > descriptor.count)
    throw immutableStorageError("Context turn membership exceeds dialog membership");
  if (context.count === 0)
    throw immutableStorageError("Context directory references an empty dialog");
  budget.consume("turns", context.count);
  let count = 0;
  for await (const [key, reference] of store.index.entries(context.root)) {
    if (count >= context.count)
      throw immutableStorageError("Context turn membership count mismatch");
    const [turnScopeId] = await store.objects.readValues([reference], { budget });
    if (turnScopeId !== key)
      throw immutableStorageError("Context turn membership identity mismatch");
    count += 1;
    yield turnScopeId;
  }
  if (count !== context.count)
    throw immutableStorageError("Context turn membership count mismatch");
}

async function readDialogSource({ store, snapshot, dialogProcessId, scope, budget }) {
  const records = [];
  const turns = {};
  for await (const turnScopeId of readContextTurnScopes(store, snapshot, dialogProcessId, budget)) {
    if (turnScopeId === scope?.turnScopeId) continue;
    const turn = await store.get(snapshot, "turns", turnScopeId);
    if (turn?.turnScopeId !== turnScopeId || turn.dialogProcessId !== dialogProcessId)
      throw immutableStorageError("Dialog turn ownership mismatch");
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    if (lifecycle) turns[turnScopeId] = lifecycle;
    let count = 0;
    for await (const candidate of iterateImmutableContextCandidates({
      store,
      snapshot,
      turn,
      lifecycle,
      budget,
    })) {
      records.push(candidate);
      count += 1;
    }
    if (count === 0)
      throw immutableStorageError("Context turn membership references an empty candidate index");
  }
  records.sort((a, b) => a.value.ordinal - b.value.ordinal);
  return {
    messages: records.map(({ value }) => value.message),
    turnLifecycle: { turns },
    materialize: (selected) => materializeDialog(store, records, selected, budget),
  };
}

async function materializeDialog(store, records, selected, budget) {
  const retained = records.filter(({ value }) => selected.has(value.message.messageUid));
  await store.objects.materializeValues(retained, { budget });
  for (const { value } of retained) {
    try {
      assertSessionMessageEntity(value.message);
    } catch (cause) {
      throw immutableStorageError("Invalid immutable context message entity", cause);
    }
  }
  return retained.map(({ value }) => value.message);
}

export async function readImmutableContextSource({ store, snapshot, scope, historyLimit, limits }) {
  const budget = createContextReadBudget(limits);
  return store.objects.withSnapshot(snapshot, () =>
    readContextSource({ store, snapshot, scope, historyLimit, budget }),
  );
}

async function readContextSource({ store, snapshot, scope, historyLimit, budget }) {
  return readIndexedContextWindow({
    scope,
    historyLimit,
    async readLifecycle() {
      requireImmutableContextIndex(await store.get(snapshot, "metadata", "facts"));
      const lifecycle = await store.get(snapshot, "metadata", "lifecycle");
      if (!lifecycle) throw immutableStorageError("Immutable lifecycle header is missing");
      return lifecycle;
    },
    async *readDialogs() {
      for await (const dialogProcessId of readImmutableContextDialogs(store, snapshot, budget))
        yield { dialogProcessId, descriptor: dialogProcessId };
    },
    readDialog: (dialogProcessId) =>
      readDialogSource({ store, snapshot, dialogProcessId, scope, budget }),
  });
}
