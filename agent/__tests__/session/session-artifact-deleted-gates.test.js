/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { createSessionDeletedError } from "@noobot/session-protocol";
import {
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  prepareSessionArtifactCleanup,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-store.js";
import { TEST_TURN, turnDirOf, withTemp } from "./session-artifact-store-v2.test-helpers.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

test("artifact mutation utilities honor deleted-session lifecycle gates", async () =>
  withTemp(async (root) => {
    const sessionDir = path.join(root, "deleted-session");
    const files = buildSessionArtifactFileMap(sessionDir);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      files.session,
      JSON.stringify({
        ...createTestSessionRequiredFields(),
        sessionId: "deleted-session",
        aggregateVersion: 0,
        messages: [
          { role: "user", messageOrigin: "natural", content: "legacy", turnScopeId: "one" },
        ],
      }),
      "utf8",
    );
    const assertDeleted = async () => {
      throw createSessionDeletedError({ sessionId: "deleted-session", operation: "test" });
    };
    await appendRollingJsonlArtifactLog({
      storageService,
      sessionDir,
      log: { id: 2, dialogProcessId: TEST_TURN },
      maxSegmentBytes: LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
      alreadyLocked: false,
    });
    const indexPath = path.join(turnDirOf(sessionDir, TEST_TURN), "index.json");
    const indexBefore = await readFile(indexPath, "utf8");
    await assert.rejects(
      repairSessionArtifacts({
        storageService,
        sessionDir,
        sessionId: "deleted-session",
        alreadyLocked: false,
        assertSessionWritable: assertDeleted,
      }),
      { code: "SESSION_DELETED" },
    );
    assert.equal(await readFile(indexPath, "utf8"), indexBefore);
    const temp = path.join(sessionDir, "zombie.tmp-1");
    await writeFile(temp, "z", "utf8");
    await assert.rejects(
      prepareSessionArtifactCleanup({
        storageService,
        sessionDir,
        sessionId: "deleted-session",
        dryRun: false,
        assertSessionWritable: assertDeleted,
      }),
      { code: "SESSION_DELETED" },
    );
    await access(temp);
  }));
