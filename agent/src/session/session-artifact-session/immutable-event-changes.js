/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getEventFamily } from "@noobot/event-protocol";
import {
  PLUGIN_ARTIFACT_FAMILY,
  pluginArtifactKey,
  reducePluginArtifact,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  assertAuthorityEventSequenceAdvance,
  assertNewAuthorityEventScope,
  assertUncommittedAuthorityEvent,
  authorityOutboxSequenceKey,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import { immutableOrderKey } from "./immutable-order-key.js";
import { indexImmutableArtifactEvent } from "./immutable-artifact-event-index.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutablePluginArtifact } from "./immutable-plugin-artifact.js";
import {
  requireImmutableOutboxIndex,
  indexImmutableOutboxEvent,
} from "./immutable-outbox-turn-index.js";

export function immutableEventSequenceKey(envelope) {
  return authorityOutboxSequenceKey(envelope.ordering.domain, envelope.ordering.scopeId);
}

export async function updateImmutablePluginArtifact(plan, envelope) {
  if (envelope.protocol.family !== PLUGIN_ARTIFACT_FAMILY) return;
  const key = pluginArtifactKey(envelope.payload);
  const current = await readImmutablePluginArtifact(
    (...args) => plan.get(...args),
    envelope.payload,
  );
  const reduced = reducePluginArtifact(current, envelope);
  if (!reduced.applied) throw new TypeError(`Plugin artifact rejected: ${reduced.reason}`);
  plan.set("pluginArtifacts", key, reduced.artifact);
}

export async function appendImmutableEvent(store, plan, source) {
  const sessionId = store.sessionId;
  const [event] = normalizeAuthorityEventOutbox([source]);
  const metadata = await plan.get("metadata", "session");
  const header = await requireImmutableOutboxIndex(plan);
  if (!metadata || !header) throw immutableStorageError("Immutable events are not initialized");
  assertNewAuthorityEventScope(event, { sessionId, parentSessionId: metadata.parentSessionId });
  assertUncommittedAuthorityEvent(await plan.get("events", event.eventId));
  const key = immutableEventSequenceKey(event.envelope);
  const floor = (await plan.get("eventSequences", key)) ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0)
    throw immutableStorageError("Invalid immutable event sequence floor");
  assertAuthorityEventSequenceAdvance(event.envelope, floor);
  const ordinal = header.sequence + 1;
  if (
    !Number.isSafeInteger(header.sequence) ||
    header.sequence < 0 ||
    !Number.isSafeInteger(ordinal)
  )
    throw immutableStorageError("Invalid immutable event ordinal");
  const descriptor = getEventFamily(event.envelope.protocol.family);
  const record = { ...event, ordinal, artifact: descriptor.sessionArtifact === true };
  await updateImmutablePluginArtifact(plan, event.envelope);
  plan.set("events", event.eventId, record);
  await indexImmutableArtifactEvent(store, plan, record);
  plan.set("eventOrder", immutableOrderKey(ordinal), event.eventId);
  plan.set("eventSequences", key, event.envelope.ordering.sequence);
  plan.set("outbox", event.eventId, record);
  await indexImmutableOutboxEvent(store, plan, record);
  plan.set("metadata", "events", { ...header, sequence: ordinal });
  return record;
}
