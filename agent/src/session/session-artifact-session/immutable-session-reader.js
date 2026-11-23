/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  assertSessionScopeIdentity,
  createSessionNotFoundError,
  projectStoredSessionMetadata,
  requireAttachmentBindingTarget,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { commitScopedImmutableSessionChanges } from "./commit-session-changes.js";
import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import {
  createSessionReaderLifecycle,
  projectSessionTurnDescriptor,
} from "@noobot/session-protocol/session-reader";
import { acquireImmutableReaderRetention } from "./immutable-reader-retention.js";
import {
  readImmutableAuthority,
  withImmutableAuthorityMutation,
} from "../session-storage-authority.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  readImmutableMessage,
  readImmutableMessageMetadata,
  readImmutableMessages,
  readImmutableFirstTurnMessage,
  readImmutableTurnPage,
  readImmutableScopedTurnMessagePage,
} from "./immutable-message-reader.js";
import {
  readImmutableMessagePage,
  readImmutableMessageTailPage,
  readImmutableSessionAutoTitle,
} from "./immutable-message-range.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
  readImmutableCheckpointState,
} from "./immutable-checkpoint-reader.js";
import { readImmutableOutboxEvent, readImmutableOutboxPage } from "./immutable-outbox.js";
import { exportImmutableSession } from "./immutable-session-export.js";
import {
  readImmutableDisplayProjection,
  readImmutableDisplaySourcePage,
} from "./immutable-display-projection.js";
import {
  immutableLifecycleCommandKey,
  readImmutableCommandChanges,
} from "./immutable-command-index.js";
import { readImmutablePluginArtifact } from "./immutable-plugin-artifact.js";
import { readImmutableContextSource } from "./immutable-context-reader.js";
import { readImmutableContextCandidatePage } from "./immutable-context-source-index.js";
import { readImmutableListProjection } from "./immutable-list-projection.js";
import { immutableListProjectionSource } from "./immutable-message-preview.js";
import { readImmutableThinkingDetailPage } from "./immutable-turn-reader.js";
import { readImmutableCompactionPage } from "./immutable-compaction-page.js";
import { readImmutableMutationProjection } from "./immutable-mutation-projection.js";
import { readImmutableLifecycleTurns } from "./immutable-lifecycle-index.js";
import { readImmutableMessageDiagnosticPage } from "./immutable-message-diagnostics.js";
import { readImmutableMessageContentPage } from "./immutable-message-content-page.js";
import { readImmutableDialogTurnPage } from "./immutable-dialog-turn-page.js";
import {
  readSessionEventSequenceFloor,
  readTurnLifecycleReplacements,
  requireTurnLifecycleSourceSelection,
} from "@noobot/session-protocol/turn-lifecycle";

async function readLifecycleSource(store, snapshot, options) {
  const { terminalLimit, reconcileTurnScopeIds } = requireTurnLifecycleSourceSelection(options);
  const get = (collection, key) => store.get(snapshot, collection, key);
  const metadata = await store.get(snapshot, "metadata", "session");
  const header = await store.get(snapshot, "metadata", "lifecycle");
  if (!header) throw immutableStorageError("Immutable lifecycle header is missing");
  const selected = await readImmutableLifecycleTurns(get, { terminalLimit });
  const turns = Object.fromEntries(selected.map((turn) => [turn.turnScopeId, turn]));
  if (header.activeTurnScopeId && !Object.hasOwn(turns, header.activeTurnScopeId)) {
    const active = await get("lifecycle", header.activeTurnScopeId);
    if (!active || active.turnScopeId !== header.activeTurnScopeId)
      throw immutableStorageError("Immutable active lifecycle turn is missing");
    Object.defineProperty(turns, header.activeTurnScopeId, { value: active, enumerable: true });
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
  const replacedTurns = await readTurnLifecycleReplacements({
    sequence: header.sequence,
    turnScopeIds: reconcileTurnScopeIds,
    read: (turnScopeId) => get("replacements", turnScopeId),
    invalid: immutableStorageError,
  });
  return {
    sessionId: metadata.sessionId,
    generation: snapshot.generation,
    aggregateVersion: metadata.aggregateVersion,
    messageTurnScopeIds: messageTurns.map(([scope]) => scope),
    turnLifecycle: { ...header, turns, replacedTurns, commandReceipts: [] },
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

function commitChangesFor(store, parentSessionId) {
  return (request) =>
    commitScopedImmutableSessionChanges(store, request, async ({ get }) => {
      const session = await get("metadata", "session");
      if (!session) throw immutableStorageError("Immutable session metadata is missing");
      assertSessionScopeIdentity({ session, sessionId: store.sessionId, parentSessionId });
    });
}

function prepareChangesAt({ generation }) {
  return (command) =>
    prepareScopedSessionCommitRequest({ epoch: null, expectedGeneration: generation }, command);
}

export function withImmutableSessionCommit(options, run) {
  return withImmutableAuthorityMutation(options.sessionDir, async () => {
    const store = await ImmutableSessionStore.open(options);
    const snapshot = await store.snapshot();
    await using transaction = createSessionReaderLifecycle({
      generation: snapshot.generation,
      methods: {
        prepareRequest: prepareChangesAt(snapshot),
        commitChanges: commitChangesFor(store, options.parentSessionId),
      },
      release: async () => {},
    });
    return await run({
      prepareRequest: transaction.prepareRequest,
      commitChanges: transaction.commitChanges,
    });
  });
}

export async function withImmutableSessionReader(options, run) {
  if (!isFunction(run)) throw new TypeError("Scoped reader requires a callback");
  const store = await ImmutableSessionStore.open(options);
  return withImmutableAuthorityMutation(store.sessionDir, () =>
    store.objects.withReadScope(async () => {
      const snapshot = await store.snapshot();
      await validateReaderScope(store, snapshot, options.parentSessionId);
      await using reader = createImmutableReader(store, snapshot, async () => {});

      await using transaction = createSessionReaderLifecycle({
        generation: snapshot.generation,
        methods: {
          commitChanges: commitChangesFor(store, options.parentSessionId),
          readCurrent: async (read) => {
            if (!isFunction(read)) throw new TypeError("Current reader requires a callback");
            const current = await store.snapshot();
            await validateReaderScope(store, current, options.parentSessionId);
            await using currentReader = createImmutableReader(store, current, async () => {});
            return await read(currentReader);
          },
        },
        release: async () => {},
      });
      return await run(reader, transaction.commitChanges, transaction.readCurrent);
    }),
  );
}

export async function openSessionArtifactReader({ sessionDir }) {
  const { immutable, document } = await readImmutableAuthority(sessionDir);
  if (!immutable && !document) throw createSessionNotFoundError();
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
    prepareRequest: prepareChangesAt(snapshot),
    readMetadata: async ({ includeAutoTitle = false } = {}) => {
      const metadata = await store.get(snapshot, "metadata", "session");
      if (!metadata) throw immutableStorageError("Immutable session metadata is missing");
      const facts = projectStoredSessionMetadata(metadata);
      if (!includeAutoTitle) return facts;
      const autoTitle = await readImmutableSessionAutoTitle(store, snapshot);
      return autoTitle ? { ...facts, autoTitle } : facts;
    },
    readScopedMetadata: async () =>
      readScopedSessionMetadataRecord(await store.get(snapshot, "metadata", "scoped")),
    readFacts: () => store.get(snapshot, "metadata", "facts"),
    readListProjection: () =>
      readImmutableListProjection(immutableListProjectionSource(store, snapshot)),
    readCompactionPage: (options) => readImmutableCompactionPage(store, snapshot, options),
    readCommitChanges: (options) => store.readCommitChanges(snapshot, options),
    readCommandChanges: (commandId) => readImmutableCommandChanges({ store, snapshot, commandId }),
    readMutationProjection: (commandId) =>
      readImmutableMutationProjection({ store, snapshot, commandId }),
    readContextSource: (options) => readImmutableContextSource({ ...options, store, snapshot }),
    readContextCandidatePage: (options) =>
      readImmutableContextCandidatePage({ ...options, store, snapshot }),
    readLifecycleHead: () => store.get(snapshot, "metadata", "lifecycle"),
    readLifecycleSource: (options) => readLifecycleSource(store, snapshot, options),
    readTurnState: (turnScopeId) => store.get(snapshot, "lifecycle", turnScopeId),
    readTurnDescriptor: async (turnScopeId) =>
      projectSessionTurnDescriptor(turnScopeId, await store.get(snapshot, "turns", turnScopeId)),
    readDialog: (dialogProcessId) => store.get(snapshot, "dialogs", dialogProcessId),
    readDialogTurnPage: (options) => readImmutableDialogTurnPage({ ...options, store, snapshot }),
    readCommand: (commandId) =>
      store.get(snapshot, "commands", immutableLifecycleCommandKey(commandId)),
    readTurnTiming: (turnScopeId) => store.get(snapshot, "timings", turnScopeId),
    readMessage: (messageUid) => readImmutableMessage(store, snapshot, messageUid),
    readAttachmentBindingTarget: async ({ messageUid, turnScopeId }) => {
      const entry = await readImmutableMessageMetadata({ store, snapshot, messageUid });
      const message = entry?.value.message;
      requireAttachmentBindingTarget(message, turnScopeId);
      return message.attachments;
    },
    readMessages: (options) => readImmutableMessages({ ...options, store, snapshot }),
    readMessageContentPage: (options) =>
      readImmutableMessageContentPage({ ...options, store, snapshot }),
    readMessageDiagnosticPage: (options) =>
      readImmutableMessageDiagnosticPage(store, snapshot, options),
    readTurnMessageDiagnosticPage: ({ dialogProcessId, ...options }) =>
      readImmutableMessageDiagnosticPage(store, snapshot, options, dialogProcessId),
    readFirstTurnMessage: (turnScopeId, maxBytes) =>
      readImmutableFirstTurnMessage({ store, snapshot, turnScopeId, maxBytes }),
    readTurnPage: (options) => readImmutableTurnPage({ ...options, store, snapshot }),
    readScopedTurnMessagePage: (options) =>
      readImmutableScopedTurnMessagePage({ ...options, store, snapshot }),
    readThinkingDetailPage: (options) =>
      readImmutableThinkingDetailPage({ ...options, store, snapshot }),
    readMessagePage: (options) => readImmutableMessagePage({ ...options, store, snapshot }),
    readMessageTailPage: (options) => readImmutableMessageTailPage({ ...options, store, snapshot }),
    readCheckpoint: (turnScopeId, checkpointId) =>
      readImmutableCheckpoint(store, snapshot, turnScopeId, checkpointId),
    readCheckpointState: (turnScopeId) =>
      readImmutableCheckpointState(store, snapshot, turnScopeId),
    readCheckpointPage: (options) => readImmutableCheckpointPage({ ...options, store, snapshot }),
    readOutboxPage: (options) => readImmutableOutboxPage({ ...options, store, snapshot }),
    readOutboxEvent: (eventId) => readImmutableOutboxEvent(store, snapshot, eventId),
    readEventSequence: (domain, scopeId) =>
      readSessionEventSequenceFloor({
        sessionId: snapshot.sessionId,
        domain,
        scopeId,
        readLifecycleHead: () => store.get(snapshot, "metadata", "lifecycle"),
        readStoredFloor: (key) => store.get(snapshot, "eventSequences", key),
      }),
    readPluginArtifact: (identity) =>
      readImmutablePluginArtifact(
        (collection, key) => store.get(snapshot, collection, key),
        identity,
      ),
    exportSession: () => exportImmutableSession({ store, snapshot }),
    readDisplayProjection: ({ includeThinkingTimeline } = {}) =>
      readImmutableDisplayProjection({ store, snapshot, includeThinkingTimeline }),
    readDisplaySourcePage: (options) =>
      readImmutableDisplaySourcePage({ ...options, store, snapshot }),
  };
  const scopedMethods = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      (...args) => store.objects.withSnapshot(snapshot, () => method(...args)),
    ]),
  );
  return createSessionReaderLifecycle({
    generation: snapshot.generation,
    methods: scopedMethods,
    release,
  });
}
