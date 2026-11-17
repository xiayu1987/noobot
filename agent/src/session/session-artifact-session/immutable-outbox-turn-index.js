/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAuthorityOutboxTurnRemoval } from "@noobot/event-protocol/outbox";
import { immutableStorageError } from "./immutable-object-store.js";

export async function requireImmutableOutboxIndex(plan) {
  const header = await plan.get("metadata", "events");
  if (header?.outboxIndexVersion !== 1)
    throw Object.assign(new Error("Immutable outbox indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  return header;
}

async function readScope(plan, turnScopeId) {
  const descriptor = await plan.get("turnOutbox", turnScopeId);
  if (
    descriptor !== null &&
    (descriptor.turnScopeId !== turnScopeId ||
      !Number.isSafeInteger(descriptor.count) ||
      descriptor.count < 1 ||
      !descriptor.root)
  )
    throw immutableStorageError("Invalid outbox turn descriptor");
  return descriptor;
}

export async function indexImmutableOutboxEvent(store, plan, event) {
  const { turnScopeId } = event.envelope.identity;
  if (!turnScopeId) return;
  const previous = await readScope(plan, turnScopeId);
  if (await store.index.get(previous?.root ?? null, event.eventId))
    throw immutableStorageError("Duplicate outbox turn membership");
  const count = (previous?.count ?? 0) + 1;
  if (!Number.isSafeInteger(count)) throw immutableStorageError("Outbox turn count overflow");
  const root = await store.index.set(
    previous?.root ?? null,
    event.eventId,
    await store.objects.putValue(event.eventId),
  );
  plan.set("turnOutbox", turnScopeId, { turnScopeId, count, root });
}

export async function removeImmutableOutboxEvent(store, plan, event) {
  const { turnScopeId } = event.envelope.identity;
  if (turnScopeId) {
    const previous = await readScope(plan, turnScopeId);
    const reference = await store.index.get(previous?.root ?? null, event.eventId);
    if (!reference || (await store.objects.readValue(reference)) !== event.eventId)
      throw immutableStorageError("Missing outbox turn membership");
    const root = await store.index.set(previous.root, event.eventId, null);
    const count = previous.count - 1;
    if ((root === null) !== (count === 0))
      throw immutableStorageError("Outbox turn count mismatch");
    if (count === 0) plan.remove("turnOutbox", turnScopeId);
    else plan.set("turnOutbox", turnScopeId, { turnScopeId, count, root });
  }
  plan.remove("outbox", event.eventId);
}

async function removeTurnEvents(store, plan, turnScopeId) {
  const descriptor = await readScope(plan, turnScopeId);
  if (descriptor === null) return 0;
  let count = 0;
  for await (const [eventId, reference] of store.index.entries(descriptor.root)) {
    if ((await store.objects.readValue(reference)) !== eventId)
      throw immutableStorageError("Outbox turn membership identity mismatch");
    const event = await plan.get("outbox", eventId);
    if (
      !event ||
      event.eventId !== eventId ||
      event.envelope.identity.sessionId !== store.sessionId ||
      event.envelope.identity.turnScopeId !== turnScopeId
    )
      throw immutableStorageError("Outbox turn event ownership mismatch");
    plan.remove("outbox", eventId);
    count += 1;
  }
  if (count !== descriptor.count) throw immutableStorageError("Outbox turn count mismatch");
  plan.remove("turnOutbox", turnScopeId);
  return count;
}

export async function prepareImmutableOutboxTurnRemoval(store, plan, source) {
  const { turnScopeIds } = parseAuthorityOutboxTurnRemoval(source);
  await requireImmutableOutboxIndex(plan);
  let removed = 0;
  for (const turnScopeId of turnScopeIds) {
    removed += await removeTurnEvents(store, plan, turnScopeId);
  }
  return { removed };
}
