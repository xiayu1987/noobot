/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSessionEntity } from "../entities/session-entity.js";
import {
  seedImmutableArtifactEventIndex,
  indexImmutableArtifactEvent,
} from "./immutable-artifact-event-index.js";
import { IMMUTABLE_CONTEXT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { IMMUTABLE_SESSION_FORMAT_FILE } from "@noobot/session-protocol/immutable-storage";
import {
  TURN_EVENT_VALUES,
  projectTurnMessage,
  createScopedSessionMetadataRecord,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import { filePath as path } from "@noobot/path-resolver";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
import { assertPreparedTurnReceipt } from "@noobot/event-protocol/turn-outbox";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges, prepareImmutableMessages } from "./immutable-message-changes.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError, writeDurableReplacement } from "./immutable-object-store.js";
import { exportImmutableSession } from "./immutable-session-export.js";
import { stableValue } from "@noobot/shared/value";
import {
  immutableEventSequenceKey,
  updateImmutablePluginArtifact,
} from "./immutable-event-changes.js";
import { writeImmutableCheckpoint } from "./immutable-checkpoint-index.js";
import { indexImmutableOutboxEvent } from "./immutable-outbox-turn-index.js";
import { writeImmutableCommand } from "./immutable-command-index.js";
import { seedImmutableMessageTails } from "./immutable-message-tail-index.js";
import { seedImmutableTitleIndex } from "./immutable-title-index.js";
import { prepareImmutableLifecycleIndex } from "./immutable-lifecycle-index.js";

const STRUCTURAL_FIELDS = new Set([
  "messages",
  "messageOrder",
  "dialogOrder",
  "turnTimings",
  "turnLifecycle",
  "turnSummaryCheckpoints",
  "sessionArtifactEvents",
  "turnOrder",
  "schemaVersion",
  "turnArtifactSequence",
  "artifactEventJournal",
  "sessionArtifacts",
]);

export function immutableSessionImportProjection(source) {
  const session = normalizeSessionEntity(source);
  const metadata = Object.fromEntries(
    Object.entries(session).filter(([key]) => !STRUCTURAL_FIELDS.has(key)),
  );
  return {
    ...metadata,
    messages: session.messages.map((message) =>
      projectTurnMessage(message, session.turnLifecycle.turns[message.turnScopeId]),
    ),
    dialogOrder: session.dialogOrder,
    turnTimings: [...session.turnTimings].sort((a, b) =>
      a.turnScopeId.localeCompare(b.turnScopeId),
    ),
    turnLifecycle: {
      ...session.turnLifecycle,
      commandReceipts: [...session.turnLifecycle.commandReceipts].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.commandId.localeCompare(b.commandId),
      ),
    },
    sessionArtifactEvents: session.sessionArtifactEvents,
    ...(session.turnSummaryCheckpoints
      ? { turnSummaryCheckpoints: session.turnSummaryCheckpoints }
      : {}),
  };
}

async function seedMetadata(store, plan, session) {
  plan.set(
    "metadata",
    "session",
    Object.fromEntries(Object.entries(session).filter(([key]) => !STRUCTURAL_FIELDS.has(key))),
  );
  plan.set("metadata", "facts", {
    contextIndexVersion: IMMUTABLE_CONTEXT_INDEX_VERSION,
    messageCount: 0,
    messageSequence: 0,
    turnSequence: 0,
    dialogSequence: session.dialogOrder.reduce(
      (max, entry) => Math.max(max, entry.dialogOrdinal),
      0,
    ),
    lastDialogOrdinal: 0,
    lastMessageOrdinal: 0,
    lastMessageUid: "",
  });
  const { activeTurnScopeId, sequence } = session.turnLifecycle;
  plan.set("metadata", "lifecycle", { activeTurnScopeId, sequence });
  plan.set("metadata", "commandIndex", { version: 1 });
  plan.set("metadata", "checkpointIndex", { version: 1 });
  seedImmutableMessageTails(plan, session.dialogOrder);
  seedImmutableTitleIndex(plan);
  for (const entry of session.dialogOrder) {
    plan.set("dialogs", entry.dialogProcessId, entry);
    plan.set("dialogOrder", immutableOrderKey(entry.dialogOrdinal), entry.dialogProcessId);
  }
  for (const [key, turn] of Object.entries(session.turnLifecycle.turns))
    plan.set("lifecycle", key, turn);
  for (const [key, turn] of Object.entries(session.turnLifecycle.replacedTurns))
    plan.set("replacements", key, turn);
  for (const receipt of session.turnLifecycle.commandReceipts)
    await writeImmutableCommand(store, plan, receipt);
  for (const timing of session.turnTimings) plan.set("timings", timing.turnScopeId, timing);
}

async function seedCheckpoints(store, plan, session) {
  for (const [scope, state] of Object.entries(session.turnSummaryCheckpoints ?? {})) {
    const { receipts, ...header } = state;
    plan.set("checkpointHeads", scope, header);
    for (const receipt of receipts) await writeImmutableCheckpoint(store, plan, scope, receipt);
  }
}

async function seedEvents({ store, plan, session, authorityEvents, outbox }) {
  const events = normalizeAuthorityEventOutbox(authorityEvents);
  const pending = normalizeAuthorityEventOutbox(outbox);
  const byId = new Map(events.map((event) => [event.eventId, event]));
  for (const event of events) {
    if (
      event.envelope.identity.sessionId !== session.sessionId ||
      (Object.hasOwn(event.envelope.payload, "parentSessionId") &&
        event.envelope.payload.parentSessionId !== session.parentSessionId)
    )
      throw immutableStorageError("Imported authority event belongs to a different session");
  }
  for (const receipt of session.turnLifecycle.commandReceipts) {
    if (TURN_EVENT_VALUES.includes(receipt.type))
      assertPreparedTurnReceipt(byId.get(receipt.eventId), receipt);
  }
  const artifactIds = new Set(session.sessionArtifactEvents.map((event) => event.identity.eventId));
  for (const event of session.sessionArtifactEvents) {
    const record = byId.get(event.identity.eventId);
    if (!record || JSON.stringify(record.envelope) !== JSON.stringify(event))
      throw immutableStorageError("Imported artifact event has no matching authority event");
  }
  let ordinal = 0;
  const floors = new Map();
  seedImmutableArtifactEventIndex(plan);
  for (const event of events) {
    ordinal += 1;
    const key = immutableEventSequenceKey(event.envelope);
    floors.set(key, Math.max(floors.get(key) ?? 0, event.envelope.ordering.sequence));
    await updateImmutablePluginArtifact(plan, event.envelope);
    const record = {
      ...event,
      ordinal,
      artifact: artifactIds.has(event.eventId),
    };
    plan.set("events", event.eventId, record);
    await indexImmutableArtifactEvent(store, plan, record);
    plan.set("eventOrder", immutableOrderKey(ordinal), event.eventId);
  }
  for (const event of pending) {
    const committed = byId.get(event.eventId);
    if (
      !committed ||
      JSON.stringify(committed.envelope) !== JSON.stringify(event.envelope) ||
      committed.committedAt !== event.committedAt
    )
      throw immutableStorageError("Imported outbox event is not committed");
    plan.set("outbox", event.eventId, event);
    await indexImmutableOutboxEvent(store, plan, event);
  }
  plan.set("metadata", "events", { sequence: ordinal, outboxIndexVersion: 1 });
  for (const [key, sequence] of floors) plan.set("eventSequences", key, sequence);
}

async function prepareImmutableSessionImport({
  store,
  get,
  getMetadata,
  session: source,
  authorityEvents = [],
  outbox = [],
  scopedMetadata = null,
}) {
  if (await get("metadata", "session"))
    throw new TypeError("Immutable session is already initialized");
  const session = normalizeSessionEntity(source);
  if (session.sessionId !== store.sessionId)
    throw new TypeError("Imported session identity mismatch");
  const plan = new ImmutableSessionChanges(get, {
    getMetadata,
    readContent: (reference) => store.objects.readValue(reference),
    readContentMetadata: (reference) => store.objects.readValueMetadata(reference),
  });
  await seedMetadata(store, plan, session);
  plan.set("metadata", "scoped", createScopedSessionMetadataRecord(scopedMetadata));
  await seedCheckpoints(store, plan, session);
  await seedEvents({ store, plan, session, authorityEvents, outbox });
  const messages = await prepareImmutableMessages({
    store,
    get: (collection, key) => plan.get(collection, key),
    getMetadata: (collection, key) => plan.getMetadata(collection, key),
    messages: session.messages,
    updatedAt: session.updatedAt,
  });
  for (const change of messages.changes) await plan.apply(change);

  const metadata = Object.fromEntries(
    Object.entries(session).filter(([key]) => !STRUCTURAL_FIELDS.has(key)),
  );
  plan.set("metadata", "session", metadata);
  await prepareImmutableLifecycleIndex(plan, { initialize: true });
  return {
    changes: plan.changes(),
    result: { sessionId: session.sessionId, messageCount: session.messages.length },
  };
}

export async function initializeImmutableSession({
  sessionDir,
  session,
  operationId,
  authorityEvents = [],
  outbox = [],
  scopedMetadata = null,
  objectStore,
}) {
  const expected = immutableSessionImportProjection(session);
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: session.sessionId,
    allowCreate: true,
    objectStore,
  });
  const result = await store.transact({
    expectedGeneration: 0,
    operationId,
    input: { session, authorityEvents, outbox, scopedMetadata },
    prepare: ({ get, getMetadata, input }) =>
      prepareImmutableSessionImport({ store, get, getMetadata, ...input }),
    validate: async (snapshot) => {
      const actual = immutableSessionImportProjection(
        await exportImmutableSession({ store, snapshot }),
      );
      if (JSON.stringify(stableValue(actual)) !== JSON.stringify(stableValue(expected)))
        throw immutableStorageError("Imported session graph differs from its source");
      const actualMetadata = readScopedSessionMetadataRecord(
        await store.get(snapshot, "metadata", "scoped"),
      );
      if (
        JSON.stringify(stableValue(actualMetadata)) !== JSON.stringify(stableValue(scopedMetadata))
      )
        throw immutableStorageError("Imported scoped metadata differs from its source");
    },
  });

  await publishImmutableSessionFormat(sessionDir);
  return result;
}

export async function publishImmutableSessionFormat(sessionDir) {
  const store = await ImmutableSessionStore.open({ sessionDir });
  await writeDurableReplacement(
    path.join(sessionDir, IMMUTABLE_SESSION_FORMAT_FILE),
    Buffer.from(`${store.format}\n`),
  );
}
