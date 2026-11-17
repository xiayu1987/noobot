/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import {
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_CURRENT_SESSION_FORMAT,
  encodeImmutableSessionHead,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../src/session/session-artifact-session/immutable-record-store.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { setFsAdapter, resetFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { JsonLocatedFixture } from "./helpers/json-located-store.js";
import { wrapLegacyCommitIndex } from "./helpers/wrapped-commit-index.js";

for (const installedVersion of [36, 37, 38]) {
  for (const failPublication of [false, true]) {
    test(`v${installedVersion} upgrades detached sessions before normal reads (publication fault=${failPublication})`, async (t) => {
      const base = await mkdtemp(path.join(tmpdir(), "append-layout-upgrade-"));
      t.after(() => rm(base, { recursive: true, force: true }));
      const sessionDir = path.join(base, WORKSPACE_LAYOUT.AGENT_SESSION_DIR, "detached");
      const store = new ImmutableSessionStore({
        sessionDir,
        sessionId: "detached",
        allowCreate: true,
        objectStore: installedVersion === 38 ? JsonLocatedFixture : ImmutableRecordStore,
      });
      const request = {
        expectedGeneration: 0,
        operationId: "seed",
        changes: Object.entries({
          session: { sessionId: "detached", parentSessionId: "missing-parent" },
          facts: {
            contextIndexVersion: 1,
            messageCount: 0,
            messageSequence: 0,
            turnSequence: 0,
            dialogSequence: 0,
            lastDialogOrdinal: 0,
            lastMessageOrdinal: 0,
            lastMessageUid: "",
          },
          events: { sequence: 0, outboxIndexVersion: 1 },
          commandIndex: { version: 1 },
          checkpointIndex: { version: 1 },
          titleIndex: { version: 1, root: null },
          proof: { text: "preserve detached history" },
        }).map(([key, value]) => ({ collection: "metadata", key, value })),
      };
      await store.commit(request);
      await wrapLegacyCommitIndex(store);
      const { segmentTail, ...head } = await store.snapshot();
      assert.ok(segmentTail);
      const sealed =
        installedVersion === 36
          ? { ...head, format: IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT }
          : { ...head, segmentTail };
      const before = Buffer.from(encodeImmutableSessionHead(sealed, sealed.format));
      await writeFile(store.headPath, before);
      const layoutFile = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
      await writeFile(layoutFile, JSON.stringify({ version: installedVersion }));
      const upgradeId =
        installedVersion === 36
          ? "session-immutable-append-segments-v37"
          : installedVersion === 37
            ? "session-immutable-record-locations-v38"
            : "session-immutable-compact-locations-v39";
      const options = {
        base,
        backupBase: path.join(base, "backup"),
        created: false,
        scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
        storageService,
      };
      if (failPublication) {
        setFsAdapter({
          rename: async (from, to) => {
            if (to === store.headPath)
              throw Object.assign(new Error("append upgrade publication fault"), { code: "EIO" });
            return rename(from, to);
          },
        });
        try {
          const failed = await upgradeWorkspaceLayout(options);
          assert.equal(failed[0].id, upgradeId);
          assert.equal(failed[0].failed.code, "EIO");
          assert.deepEqual(await readFile(store.headPath), before);
          assert.equal(JSON.parse(await readFile(layoutFile)).version, installedVersion);
        } finally {
          resetFsAdapter();
        }
      }
      const result = await upgradeWorkspaceLayout(options);
      assert.equal(result[0].id, upgradeId);
      assert.equal(result[0].failed, undefined, JSON.stringify(result));
      const upgraded = await ImmutableSessionStore.open({ sessionDir });
      const snapshot = await upgraded.snapshot();
      assert.equal(snapshot.format, IMMUTABLE_CURRENT_SESSION_FORMAT);
      assert.deepEqual(await upgraded.get(snapshot, "metadata", "proof"), {
        text: "preserve detached history",
      });
      assert.equal((await upgraded.commit(request)).replayed, true);
      assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
      assert.deepEqual(await upgradeWorkspaceLayout(options), []);
      assert.deepEqual(await upgraded.snapshot(), snapshot);
    });
  }
}
