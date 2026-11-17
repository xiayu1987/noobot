/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isContextSourceMessageCandidate } from "@noobot/context-protocol/assembly/source";
import {
  assertSessionMessageMetadata,
  assertTurnRecord,
  projectTurnMessage,
} from "@noobot/session-protocol";
import { immutableValueIndexReferences } from "@noobot/session-protocol/immutable-storage-graph";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { immutableStorageError } from "./immutable-object-store.js";

function requireContextSourceDescriptor(store, scope, descriptor) {
  immutableValueIndexReferences("contextSources", scope, descriptor, store.requireReference);
  return descriptor;
}

export async function updateImmutableContextSource(store, plan, scope, entries) {
  const descriptor = requireContextSourceDescriptor(
    store,
    scope,
    await plan.get("contextSources", scope),
  );
  const result = await store.index.applyMany(descriptor.root, entries);
  if (result.changed === 0) return;
  const next = {
    count: descriptor.count + result.added - result.removed,
    root: result.root,
  };
  requireContextSourceDescriptor(store, scope, next);
  plan.set("contextSources", scope, next);
}

export async function readImmutableContextCandidates({ store, snapshot, turn, lifecycle }) {
  if (lifecycle !== null) {
    assertTurnRecord(lifecycle);
    if (
      lifecycle.turnScopeId !== turn.turnScopeId ||
      lifecycle.dialogProcessId !== turn.dialogProcessId
    )
      throw immutableStorageError("Context source lifecycle ownership mismatch");
  }
  const descriptor = requireContextSourceDescriptor(
    store,
    turn.turnScopeId,
    await store.get(snapshot, "contextSources", turn.turnScopeId),
  );
  const records = [];
  let batch = [];
  const readBatch = async () => {
    const values = await store.objects.readValuesMetadata(batch.map(([, reference]) => reference));
    for (let position = 0; position < values.length; position += 1) {
      const metadata = values[position];
      const { value } = metadata;
      if (
        value?.message?.messageUid !== batch[position][0] ||
        value.message.sessionId !== store.sessionId ||
        value.message.turnScopeId !== turn.turnScopeId ||
        value.message.dialogProcessId !== turn.dialogProcessId ||
        !Number.isSafeInteger(value.turnOrdinal) ||
        value.turnOrdinal < 1 ||
        value.turnOrdinal > turn.messageSequence ||
        !isContextSourceMessageCandidate(value.message)
      )
        throw immutableStorageError("Context source index ownership or membership mismatch");
      try {
        assertSessionMessageMetadata(metadata);
      } catch (cause) {
        throw immutableStorageError("Invalid immutable context message metadata", cause);
      }
      records.push({
        ...metadata,
        value: { ...value, message: projectTurnMessage(value.message, lifecycle) },
      });
    }
  };
  for await (const entry of store.index.entries(descriptor.root)) {
    batch.push(entry);
    if (batch.length === QUANTITY_THRESHOLDS.immutableStorage.messagePageSize) {
      await readBatch();
      batch = [];
    }
  }
  if (batch.length) await readBatch();
  if (records.length !== descriptor.count)
    throw immutableStorageError("Context source index count mismatch");
  return records;
}
