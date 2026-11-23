/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionReaderAccess,
  planSessionOutboxMutation,
} from "@noobot/session-protocol/session-reader";
import {
  readImmutableAuthority,
  withImmutableAuthorityMutation,
} from "../session-storage-authority.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { assertImmutableMigrationRetentionsReleased } from "./immutable-reader-retention.js";
import {
  createImmutableSession,
  publishImmutableSessionFormat,
} from "./immutable-session-bootstrap.js";
import {
  openImmutableSessionReader,
  openSessionArtifactReader,
  withImmutableSessionCommit,
  withImmutableSessionReader,
} from "./immutable-session-reader.js";

function assertImmutablePlacementAvailable({ immutable, document }) {
  if (!immutable && document)
    throw Object.assign(new Error("Session storage requires an offline workspace upgrade"), {
      code: "SESSION_IMMUTABLE_STORAGE_UPGRADE_REQUIRED",
    });
  return immutable;
}

export const immutableSessionReaderAccess = createSessionReaderAccess({
  withRemoval({ sessionDir }, remove) {
    return withImmutableAuthorityMutation(sessionDir, async (authority) => {
      if (!authority.immutable)
        throw immutableStorageError("Deletion target has no Immutable authority");
      const store = await ImmutableSessionStore.open({ sessionDir });
      await assertImmutableMigrationRetentionsReleased(store, await store.snapshot());
      return remove();
    });
  },
  async create(scope, initialization) {
    await readImmutableAuthority(scope.sessionDir);
    return createImmutableSession({ scope, ...initialization });
  },
  async recover(scope) {
    const { immutable, format, document } = await readImmutableAuthority(scope.sessionDir);
    if (!assertImmutablePlacementAvailable({ immutable, document })) return null;
    const reader = await openImmutableSessionReader(scope);
    try {
      if (!format) await publishImmutableSessionFormat(scope.sessionDir);
      return reader;
    } catch (error) {
      await reader.close();
      throw error;
    }
  },
  async readPlacement({ sessionDir, sessionId }) {
    if (!assertImmutablePlacementAvailable(await readImmutableAuthority(sessionDir))) return null;
    const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
    const snapshot = await store.snapshot();
    return store.objects.withSnapshot(snapshot, async () => {
      const metadata = await store.get(snapshot, "metadata", "session");
      if (metadata?.sessionId !== store.sessionId)
        throw immutableStorageError("Immutable session metadata conflicts with its head");
      return metadata;
    });
  },
  async open(scope) {
    await readImmutableAuthority(scope.sessionDir);
    return openImmutableSessionReader(scope);
  },
  openArtifact: openSessionArtifactReader,
  withCommit: withImmutableSessionCommit,
  async withOutboxMutation(scope, plan) {
    await readImmutableAuthority(scope.sessionDir);
    return withImmutableSessionReader(scope, async (reader, commit) => {
      const {
        generation,
        readMetadata,
        readEventSequence,
        readPluginArtifact,
        readOutboxPage,
        readOutboxEvent,
        prepareRequest,
      } = reader;
      const complete = await planSessionOutboxMutation(
        {
          generation,
          methods: {
            readMetadata,
            readEventSequence,
            readPluginArtifact,
            readOutboxPage,
            readOutboxEvent,
            prepareRequest,
          },
        },
        plan,
      );
      return complete(commit);
    });
  },
  async withMutation(scope, run) {
    await readImmutableAuthority(scope.sessionDir);
    return withImmutableSessionReader(scope, run);
  },
});
