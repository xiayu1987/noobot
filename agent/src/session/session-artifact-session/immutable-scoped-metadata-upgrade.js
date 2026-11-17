/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createScopedSessionMetadataRecord,
  readScopedSessionMetadataRecord,
} from "@noobot/session-protocol";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage } from "./artifact-json-io.js";

export async function readLegacyScopedMetadata({ storageService, sessionDir }) {
  const value = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: buildSessionArtifactFileMap(sessionDir).meta,
  });
  return createScopedSessionMetadataRecord(value).value;
}

export async function upgradeImmutableScopedMetadata({ storageService, sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-scoped-metadata:${snapshot.generation}`,
    input: {},
    prepare: async ({ get }) => {
      const previous = await get("metadata", "scoped");
      if (previous !== null) {
        readScopedSessionMetadataRecord(previous);
        return { abort: true, changes: [], result: { upgraded: false } };
      }
      const value = await readLegacyScopedMetadata({ storageService, sessionDir });
      return {
        changes: [
          {
            collection: "metadata",
            key: "scoped",
            value: createScopedSessionMetadataRecord(value),
          },
        ],
        result: { upgraded: true },
      };
    },
  });
}
