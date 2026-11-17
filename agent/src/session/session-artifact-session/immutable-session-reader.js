/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  assertSessionScopeIdentity,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { commitImmutableSessionChanges } from "./commit-session-changes.js";
import { createImmutableReaderLifecycle } from "@noobot/session-protocol/immutable-storage";
import { acquireImmutableReaderRetention } from "./immutable-reader-retention.js";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableMessage, readImmutableTurnPage } from "./immutable-message-reader.js";
import { readImmutableMessageTailPage } from "./immutable-message-range.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
  readImmutableCheckpointState,
} from "./immutable-checkpoint-reader.js";
import { readImmutableOutboxEvent, readImmutableOutboxPage } from "./immutable-outbox.js";
import { exportImmutableSession } from "./immutable-session-export.js";
import { readImmutableDisplayProjection } from "./immutable-display-projection.js";
import {
  immutableLifecycleCommandKey,
  readImmutableCommandChanges,
} from "./immutable-command-index.js";
import { authorityOutboxSequenceKey } from "@noobot/event-protocol/outbox";
import { readImmutablePluginArtifact } from "./immutable-plugin-artifact.js";
import { readImmutableContextSource } from "./immutable-context-reader.js";
import { readImmutableTurnView } from "./immutable-turn-view.js";
import { readImmutableListProjection } from "./immutable-list-projection.js";
import { readImmutableTurn } from "./immutable-turn-reader.js";
import { readImmutableCompactionPage } from "./immutable-compaction-page.js";
import { readImmutableMutationProjection } from "./immutable-mutation-projection.js";
import { readImmutableLifecycleTurns } from "./immutable-lifecycle-index.js";
import { readImmutableMessageDiagnosticPage } from "./immutable-message-diagnostics.js";
import { buildThinkingDetailPayload } from "../session-thinking-detail-payload.js";

async function readLifecycleSource(store, snapshot, options) {
  const get = (collection, key) => store.get(snapshot, collection, key);
  const metadata = await store.get(snapshot, "metadata", "session");
  const header = await store.get(snapshot, "metadata", "lifecycle");
  if (!header) throw immutableStorageError("Immutable lifecycle header is missing");
  const selected = await readImmutableLifecycleTurns(get, options);
  const turns = Object.fromEntries(selected.map((turn) => [turn.turnScopeId, turn]));
  if (header.activeTurnScopeId && !Object.hasOwn(turns, header.activeTurnScopeId)) {
    const active = await get("lifecycle", header.activeTurnScopeId);
    if (!active || active.turnScopeId !== header.activeTurnScopeId)
      throw immutableStorageError("Immutable active lifecycle turn is missing");
    turns[header.activeTurnScopeId] = active;
  }
  const messageTurns = [];
  for (const scope of Object.keys(turns)) {
    const descriptor = await get("turns", scope);
    if (descriptor) messageTurns.push([scope, descriptor]);
  }
  messageTurns.sort(([, left], [, right]) => left.turnOrdinal - right.turnOrdinal);
  const turnTimings = [];
  for (const scope of Object.keys(turns)) {
    const timing = await get("timings", scope);
    if (timing) turnTimings.push(timing);
  }
  return {
    sessionId: metadata.sessionId,
    aggregateVersion: metadata.aggregateVersion,
    messageTurnScopeIds: messageTurns.map(([scope]) => scope),
    turnLifecycle: { ...header, turns, replacedTurns: {}, commandReceipts: [] },
    turnTimings,
  };
}

async function validateReaderScope(store, snapshot, parentSessionId) {
  const metadata = await store.get(snapshot, "metadata", "session");
  if (!metadata) throw immutableStorageError("Immutable session metadata is missing");
  assertSessionScopeIdentity({ session: metadata, sessionId: store.sessionId, parentSessionId });
}

export async function openImmutableSessionReader({ sessionDir, sessionId, parentSessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const { head, release } = await acquireImmutableReaderRetention(store, (snapshot) =>
    validateReaderScope(store, snapshot, parentSessionId),
  );
  return createImmutableReader(store, head, release);
}

export async function withImmutableSessionReader(options, run) {
  if (!isFunction(run)) throw new TypeError("Scoped reader requires a callback");
  const store = await ImmutableSessionStore.open(options);
  return sessionMutationCoordinator.run(store.lockPath, () =>
    store.objects.withReadScope(async () => {
      const snapshot = await store.snapshot();
      await validateReaderScope(store, snapshot, options.parentSessionId);
      await using reader = createImmutableReader(store, snapshot, async () => {});

      await using transaction = createImmutableReaderLifecycle({
        generation: snapshot.generation,
        methods: {
          commitChanges: ({ expectedGeneration, operationId, changes, committedAt }) =>
            commitImmutableSessionChanges(store, {
              expectedGeneration,
              operationId,
              changes,
              committedAt,
              validateSnapshot: async ({ get }) => {
                assertSessionScopeIdentity({
                  session: await get("metadata", "session"),
                  sessionId: store.sessionId,
                  parentSessionId: options.parentSessionId,
                });
              },
            }),
        },
        release: async () => {},
      });
      return await run(reader, transaction.commitChanges);
    }),
  );
}

export async function openSessionArtifactReader({ sessionDir }) {
  const store = await ImmutableSessionStore.open({ sessionDir });
  const { head, release } = await acquireImmutableReaderRetention(store, async (snapshot) => {
    const metadata = await store.get(snapshot, "metadata", "session");
    if (!metadata || metadata.sessionId !== store.sessionId)
      throw immutableStorageError("Immutable session metadata conflicts with its head");
  });
  return createImmutableReader(store, head, release);
}

function createImmutableReader(store, snapshot, release) {
  const methods = {
    readMetadata: () => store.get(snapshot, "metadata", "session"),
    readScopedMetadata: async () =>
      readScopedSessionMetadataRecord(await store.get(snapshot, "metadata", "scoped")),
    readFacts: () => store.get(snapshot, "metadata", "facts"),
    readListProjection: () =>
      readImmutableListProjection((collection, key) => store.get(snapshot, collection, key)),
    readCompactionPage: (options) => readImmutableCompactionPage(store, snapshot, options),
    readCommitChanges: (options) => store.readCommitChanges(snapshot, options),
    readCommandChanges: (commandId) => readImmutableCommandChanges({ store, snapshot, commandId }),
    readMutationProjection: (commandId) =>
      readImmutableMutationProjection({ store, snapshot, commandId }),
    readContextSource: (options) => readImmutableContextSource({ ...options, store, snapshot }),
    readLifecycleHead: () => store.get(snapshot, "metadata", "lifecycle"),
    readLifecycleSource: (options) => readLifecycleSource(store, snapshot, options),
    readTurnState: (turnScopeId) => store.get(snapshot, "lifecycle", turnScopeId),
    readTurnDescriptor: (turnScopeId) => store.get(snapshot, "turns", turnScopeId),
    readDialog: (dialogProcessId) => store.get(snapshot, "dialogs", dialogProcessId),
    readCommand: (commandId) =>
      store.get(snapshot, "commands", immutableLifecycleCommandKey(commandId)),
    readTurnTiming: (turnScopeId) => store.get(snapshot, "timings", turnScopeId),
    readMessage: (messageUid) => readImmutableMessage(store, snapshot, messageUid),
    readMessageDiagnosticPage: (options) =>
      readImmutableMessageDiagnosticPage(store, snapshot, options),
    readTurnMessageDiagnosticPage: ({ dialogProcessId, ...options }) =>
      readImmutableMessageDiagnosticPage(store, snapshot, options, dialogProcessId),
    readTurnPage: (options) => readImmutableTurnPage({ ...options, store, snapshot }),
    readTurn: (lookupKey) => readImmutableTurn({ store, snapshot, lookupKey }),
    readMessageTailPage: (options) => readImmutableMessageTailPage({ ...options, store, snapshot }),
    readTurnView: (options) => readImmutableTurnView({ ...options, store, snapshot }),
    readCheckpoint: (turnScopeId, checkpointId) =>
      readImmutableCheckpoint(store, snapshot, turnScopeId, checkpointId),
    readCheckpointState: (turnScopeId) =>
      readImmutableCheckpointState(store, snapshot, turnScopeId),
    readCheckpointPage: (options) => readImmutableCheckpointPage({ ...options, store, snapshot }),
    readOutboxPage: (options) => readImmutableOutboxPage({ ...options, store, snapshot }),
    readOutboxEvent: (eventId) => readImmutableOutboxEvent(store, snapshot, eventId),
    readEventSequence: (domain, scopeId) =>
      store.get(snapshot, "eventSequences", authorityOutboxSequenceKey(domain, scopeId)),
    readPluginArtifact: (identity) =>
      readImmutablePluginArtifact(
        (collection, key) => store.get(snapshot, collection, key),
        identity,
      ),
    exportSession: () => exportImmutableSession({ store, snapshot }),
    readDisplayProjection: () => readImmutableDisplayProjection({ store, snapshot }),
    readThinkingDetail: async (lookupKey) =>
      buildThinkingDetailPayload(await readImmutableTurn({ store, snapshot, lookupKey })),
  };
  const scopedMethods = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      (...args) => store.objects.withSnapshot(snapshot, () => method(...args)),
    ]),
  );
  return createImmutableReaderLifecycle({
    generation: snapshot.generation,
    methods: scopedMethods,
    release,
  });
}
