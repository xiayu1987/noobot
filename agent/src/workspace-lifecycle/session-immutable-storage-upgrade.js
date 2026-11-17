/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readSessionArtifact } from "../session/session-artifact-session/session-artifact-reader.js";
import { TURN_EVENT_VALUES } from "@noobot/session-protocol";
import {
  initializeImmutableSession,
  publishImmutableSessionFormat,
} from "../session/session-artifact-session/immutable-session-bootstrap.js";
import { readAuthorityOutboxProjection } from "../session/authority-outbox-store/outbox-journal.js";
import { listAuthorityOutboxProjection } from "@noobot/event-protocol/outbox";
import { requirePreparedOutboxEvent } from "@noobot/event-protocol/turn-outbox";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session/session-artifact-files.js";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  IMMUTABLE_SESSION_FORMAT_FILE,
  IMMUTABLE_SESSION_HEAD_FILE,
} from "@noobot/session-protocol/immutable-storage";
import { listQuarantinedUnits } from "./migration-quarantine.js";
import { ImmutableSessionStore } from "../session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionImportStore } from "../session/session-artifact-session/immutable-session-import-store.js";
import { migrateImmutableSessionSegments } from "../session/session-artifact-session/immutable-segment-migration.js";
import { immutableStorageError } from "../session/session-artifact-session/immutable-object-store.js";
import { upgradeImmutableContextIndexes } from "../session/session-artifact-session/immutable-context-index-upgrade.js";
import { upgradeImmutableOutboxIndexes } from "../session/session-artifact-session/immutable-outbox-index-upgrade.js";
import { upgradeImmutableCommandIndexes } from "../session/session-artifact-session/immutable-command-index-upgrade.js";
import { upgradeImmutableCheckpointIndexes } from "../session/session-artifact-session/immutable-checkpoint-index-upgrade.js";
import { upgradeImmutableMessageTailIndex } from "../session/session-artifact-session/immutable-message-tail-index-upgrade.js";
import { upgradeImmutableTitleIndex } from "../session/session-artifact-session/immutable-title-index-upgrade.js";
import { upgradeImmutableArtifactEventIndex } from "../session/session-artifact-session/immutable-artifact-event-index-upgrade.js";
import { upgradeImmutableCommitIndex } from "../session/session-artifact-session/immutable-commit-index-upgrade.js";
import { upgradeImmutableMessageFields } from "../session/session-artifact-session/immutable-message-fields-upgrade.js";
import { walkSessionManifestDirectories, ignoreSessionProgress } from "./session-directory-walk.js";
import { upgradeImmutableListProjection } from "../session/session-artifact-session/immutable-list-projection.js";
import { upgradeImmutableLifecycleIndex } from "../session/session-artifact-session/immutable-lifecycle-index.js";
import {
  readLegacyScopedMetadata,
  upgradeImmutableScopedMetadata,
} from "../session/session-artifact-session/immutable-scoped-metadata-upgrade.js";

export async function migrateSessionImmutableStorage({
  storageService,
  sessionDir,
  readOperationInput,
}) {
  return sessionMutationCoordinator.run(
    resolveSessionArtifactMutationLock(sessionDir),
    async () => {
      const switched = await storageService.exists(
        path.join(sessionDir, IMMUTABLE_SESSION_FORMAT_FILE),
      );
      if (
        switched ||
        (await storageService.exists(path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE)))
      ) {
        await migrateImmutableSessionSegments({
          sessionDir,
          migrateMessageReceipts: true,
          readOperationInput,
        });
        const store = await ImmutableSessionStore.open({ sessionDir });
        const snapshot = await store.snapshot();
        const metadata = await store.get(snapshot, "metadata", "session");
        if (!metadata || metadata.sessionId !== store.sessionId)
          throw immutableStorageError("Immutable migration metadata ownership mismatch");
        await upgradeImmutableContextIndexes({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableOutboxIndexes({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableArtifactEventIndex({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableCommandIndexes({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableCheckpointIndexes({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableMessageTailIndex({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableTitleIndex({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableCommitIndex({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableListProjection({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableLifecycleIndex({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableMessageFields({ sessionDir, sessionId: store.sessionId });
        await upgradeImmutableScopedMetadata({
          storageService,
          sessionDir,
          sessionId: store.sessionId,
        });
        await publishImmutableSessionFormat(sessionDir);
        return { generation: (await store.snapshot()).generation, replayed: true };
      }
      const session = await readSessionArtifact({ storageService, sessionDir });
      if (!session) throw new TypeError("Cannot migrate a missing legacy session");
      const projection = await readAuthorityOutboxProjection(sessionDir);
      const outbox = listAuthorityOutboxProjection(projection);
      const committedIds = new Set([
        ...session.turnLifecycle.commandReceipts
          .filter((receipt) => TURN_EVENT_VALUES.includes(receipt.type))
          .map((receipt) => receipt.eventId),
        ...session.sessionArtifactEvents.map((envelope) => envelope.identity.eventId),
        ...outbox.map((record) => record.eventId),
      ]);
      const authorityEvents = [...committedIds].map((eventId) => ({
        ...requirePreparedOutboxEvent(projection, eventId, "immutable migration"),
        deliveries: {},
      }));
      authorityEvents.sort(
        (a, b) =>
          a.committedAt.localeCompare(b.committedAt) ||
          a.envelope.ordering.sequence - b.envelope.ordering.sequence ||
          a.eventId.localeCompare(b.eventId),
      );
      return initializeImmutableSession({
        objectStore: ImmutableSessionImportStore,
        sessionDir,
        session,
        operationId: "migrate-session-immutable-v1",
        authorityEvents,
        outbox,
        scopedMetadata: await readLegacyScopedMetadata({ storageService, sessionDir }),
      });
    },
  );
}

async function* uniqueImmutableSessionDirectories(base, scopedSessionRoots) {
  const visited = new Set();
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root), {
      includeImmutable: true,
    })) {
      if (visited.has(sessionDir)) continue;
      visited.add(sessionDir);
      yield sessionDir;
    }
  }
}

export async function upgradeSessionImmutableStorage({
  base,
  scopedSessionRoots,
  storageService,
  onSessionProcessed = ignoreSessionProgress,
  readSessionOperationInput,
}) {
  if (readSessionOperationInput !== undefined && typeof readSessionOperationInput !== "function")
    throw new TypeError("Session migration input provider must be a function");
  return visitImmutableSessions({
    base,
    scopedSessionRoots,
    onSessionProcessed,
    processSession: (sessionDir) =>
      migrateSessionImmutableStorage({
        storageService,
        sessionDir,
        readOperationInput:
          readSessionOperationInput === undefined
            ? undefined
            : (operationId) => readSessionOperationInput({ sessionDir, operationId }),
      }),
  });
}

export async function repairSessionContextIndexes({ base, scopedSessionRoots, storageService }) {
  return visitImmutableSessions({
    base,
    scopedSessionRoots,
    onSessionProcessed: ignoreSessionProgress,
    processSession: async (sessionDir) => {
      if (!(await storageService.exists(path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE))))
        return null;
      return upgradeImmutableContextIndexes({ sessionDir });
    },
  });
}

async function visitImmutableSessions({
  base,
  scopedSessionRoots,
  onSessionProcessed,
  processSession,
}) {
  const sessions = [];
  const quarantined = [];
  const quarantinesByDirectory = new Map();
  for (const unit of await listQuarantinedUnits({ base })) {
    const directory = path.resolve(base, unit.path);
    if (!quarantinesByDirectory.has(directory)) quarantinesByDirectory.set(directory, []);
    quarantinesByDirectory.get(directory).push(unit);
  }
  for await (const sessionDir of uniqueImmutableSessionDirectories(base, scopedSessionRoots)) {
    const blockers = quarantinesByDirectory.get(path.resolve(sessionDir));
    if (blockers) {
      quarantined.push(...blockers);
      onSessionProcessed();
      continue;
    }
    const result = await processSession(sessionDir);
    if (result !== null) sessions.push({ sessionDir: path.relative(base, sessionDir), ...result });
    onSessionProcessed();
  }
  return { sessions, quarantined };
}
