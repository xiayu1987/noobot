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
import {
  immutableValueIndexReferences,
  requireImmutableContextIndex,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  CONTEXT_CANDIDATE_PAGE_SIZE,
  requireContextCandidatePage,
} from "@noobot/session-protocol/context-read-budget";
import { immutableStorageContextDirectory } from "@noobot/session-protocol/immutable-context-directory-adapter";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { updateImmutableContextDirectory } from "./immutable-context-directory.js";

const ranges = "contextCandidateRanges";
const rangeKey = (scope, prefix) => JSON.stringify([scope, prefix]);

export function seedImmutableContextCandidates(plan, scope) {
  plan.set("contextSources", scope, { count: 0, root: null, directory: { ordinals: [] } });
}

export async function removeImmutableContextCandidates(plan, scope) {
  const descriptor = await plan.get("contextSources", scope);
  const root = immutableStorageContextDirectory.requirePage(descriptor?.directory, "");
  if (!Object.hasOwn(root, "ordinals") || root.ordinals.length !== 0)
    throw immutableStorageError("Deleted turn retains context candidates");
  plan.remove("contextSources", scope);
}

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
  const ordinals = entries.map(([key]) => {
    const ordinal = Number(key);
    if (immutableOrderKey(ordinal) !== key)
      throw immutableStorageError("Context candidate has an invalid ordinal key");
    return ordinal;
  });
  const transitions = [];
  const result = await store.index.updateMany(
    descriptor.root,
    entries.map(([key]) => key),
    ({ previous, slot }) => {
      const reference = entries[slot][1];
      if ((previous === null) !== (reference === null))
        transitions.push([ordinals[slot], reference !== null]);
      return reference;
    },
  );
  if (result.changed === 0) return;
  let directoryRoot = descriptor.directory;
  const directory = {
    getMany: async (prefixes) => {
      const pages = await plan.getMany(
        ranges,
        prefixes.filter(Boolean).map((prefix) => rangeKey(scope, prefix)),
      );
      return new Map(
        prefixes.map((prefix) => [
          prefix,
          prefix ? pages.get(rangeKey(scope, prefix)) : directoryRoot,
        ]),
      );
    },
    set: (prefix, page) => {
      if (prefix) plan.set(ranges, rangeKey(scope, prefix), page);
      else directoryRoot = page;
    },
    remove: (prefix) => plan.remove(ranges, rangeKey(scope, prefix)),
  };
  for (const [ordinal, present] of transitions)
    await immutableStorageContextDirectory.update(directory, ordinal, present);
  const next = {
    count: descriptor.count + result.added - result.removed,
    root: result.root,
    directory: directoryRoot,
  };
  requireContextSourceDescriptor(store, scope, next);
  plan.set("contextSources", scope, next);
  if ((descriptor.count === 0) === (next.count === 0)) return;
  const turn = await plan.get("turns", scope);
  if (!turn || turn.turnScopeId !== scope)
    throw immutableStorageError("Context source has no owning turn");
  const membership = await plan.get("contextTurns", turn.dialogProcessId);
  immutableValueIndexReferences(
    "contextTurns",
    turn.dialogProcessId,
    membership,
    store.requireReference,
  );
  const changed = await store.index.applyMany(membership.root, [
    [scope, next.count === 0 ? null : await store.objects.putValue(scope)],
  ]);
  if (
    changed.added !== Number(descriptor.count === 0) ||
    changed.removed !== Number(next.count === 0)
  )
    throw immutableStorageError("Context turn membership disagrees with candidate transition");
  plan.set("contextTurns", turn.dialogProcessId, {
    count: membership.count + changed.added - changed.removed,
    root: changed.root,
  });
  const count = membership.count + changed.added - changed.removed;
  if ((membership.count === 0) !== (count === 0)) {
    const dialog = await plan.get("dialogs", turn.dialogProcessId);
    if (dialog?.dialogProcessId !== turn.dialogProcessId)
      throw immutableStorageError("Context membership has no owning dialog");
    await updateImmutableContextDirectory(plan, dialog.dialogOrdinal, count > 0);
  }
}

async function readCandidatePage({
  store,
  snapshot,
  turn,
  lifecycle,
  descriptor,
  budget,
  before,
  limit,
}) {
  if (lifecycle !== null) {
    assertTurnRecord(lifecycle);
    if (
      lifecycle.turnScopeId !== turn.turnScopeId ||
      lifecycle.dialogProcessId !== turn.dialogProcessId
    )
      throw immutableStorageError("Context source lifecycle ownership mismatch");
  }
  const ordinals = [];
  for await (const ordinal of immutableStorageContextDirectory.read(
    (prefix) =>
      prefix
        ? store.get(snapshot, ranges, rangeKey(turn.turnScopeId, prefix))
        : descriptor.directory,
    { before },
  )) {
    if (ordinal > turn.messageSequence)
      throw immutableStorageError("Context candidate exceeds its turn sequence");
    ordinals.push(ordinal);
    if (ordinals.length > limit) break;
  }
  const hasMore = ordinals.length > limit;
  if (
    ordinals.length > descriptor.count ||
    (before === 0 && !hasMore && ordinals.length !== descriptor.count)
  )
    throw immutableStorageError("Context source index count mismatch");
  if (hasMore) ordinals.pop();
  budget.consume("candidates", ordinals.length);
  const keys = ordinals.map(immutableOrderKey);
  const references = await store.index.getMany(descriptor.root, keys);
  const order = await store.index.getMany(turn.messageOrderRoot, keys);
  const identities = await store.objects.readValues(
    keys.map((key) => {
      const reference = order.get(key);
      if (reference === null) throw immutableStorageError("Context candidate has no turn position");
      return reference;
    }),
    { budget },
  );
  const batch = keys.map((key) => {
    const reference = references.get(key);
    if (reference === null)
      throw immutableStorageError("Context directory has no indexed candidate");
    return reference;
  });
  const values = await store.objects.readValuesMetadata(batch, { budget });
  const records = values.map((metadata, position) =>
    projectCandidateMetadata({
      metadata,
      identity: identities[position],
      ordinal: ordinals[position],
      sessionId: store.sessionId,
      turn,
      lifecycle,
    }),
  );
  return { records, cursor: ordinals.at(-1) ?? before, hasMore, total: descriptor.count };
}

function projectCandidateMetadata({ metadata, identity, ordinal, sessionId, turn, lifecycle }) {
  const { value } = metadata;
  if (
    typeof identity !== "string" ||
    !identity ||
    value?.message?.messageUid !== identity ||
    value.message.sessionId !== sessionId ||
    value.message.turnScopeId !== turn.turnScopeId ||
    value.message.dialogProcessId !== turn.dialogProcessId ||
    value.turnOrdinal !== ordinal ||
    !isContextSourceMessageCandidate(value.message)
  )
    throw immutableStorageError("Context source index ownership or membership mismatch");
  try {
    assertSessionMessageMetadata(metadata);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable context message metadata", cause);
  }
  return {
    ...metadata,
    value: { ...value, message: projectTurnMessage(value.message, lifecycle) },
  };
}

export async function readImmutableContextCandidatePage({
  store,
  snapshot,
  turnScopeId,
  before = 0,
  limit = CONTEXT_CANDIDATE_PAGE_SIZE,
  limits,
}) {
  const budget = requireContextCandidatePage({ turnScopeId, before, limit, limits });
  return store.objects.withSnapshot(snapshot, async () => {
    requireImmutableContextIndex(await store.get(snapshot, "metadata", "facts"));
    const turn = await store.get(snapshot, "turns", turnScopeId);
    if (turn?.turnScopeId !== turnScopeId || before > turn.messageSequence)
      throw immutableStorageError("Context candidate page has no owning turn or cursor");
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    const descriptor = requireContextSourceDescriptor(
      store,
      turnScopeId,
      await store.get(snapshot, "contextSources", turnScopeId),
    );
    const page = await readCandidatePage({
      store,
      snapshot,
      turn,
      lifecycle,
      descriptor,
      budget,
      before,
      limit,
    });
    return { ...page, generation: snapshot.generation, turnScopeId };
  });
}

export async function* iterateImmutableContextCandidates({
  store,
  snapshot,
  turn,
  lifecycle,
  budget,
}) {
  const descriptor = requireContextSourceDescriptor(
    store,
    turn.turnScopeId,
    await store.get(snapshot, "contextSources", turn.turnScopeId),
  );
  budget.assertAvailable("candidates", descriptor.count);
  let count = 0;
  let before = 0;
  let page;
  do {
    page = await readCandidatePage({
      store,
      snapshot,
      turn,
      lifecycle,
      descriptor,
      budget,
      before,
      limit: CONTEXT_CANDIDATE_PAGE_SIZE,
    });
    count += page.records.length;
    if (count > descriptor.count)
      throw immutableStorageError("Context source index count mismatch");
    yield* page.records;
    before = page.cursor;
  } while (page.hasMore);
  if (count !== descriptor.count)
    throw immutableStorageError("Context source index count mismatch");
}
