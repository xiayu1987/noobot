/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  createEmptyTurnLifecycle,
} from "@noobot/session-protocol";
import { buildHarness } from "./session/scoped-session-repositories.fixtures.js";
import { v9Options } from "./helpers/session-identity-upgrade.fixtures.js";
import { turnRecord } from "./helpers/turn-record.js";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";

async function fileBytes(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const file = path.join(entry.parentPath, entry.name);
          return [path.relative(directory, file), (await readFile(file)).toString("base64")];
        }),
    ),
  );
}

test("v29 isolates a corrupt lifecycle without rewriting it and upgrades the next session", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const directories = {};
  for (const sessionId of ["a-broken", "z-valid"]) {
    const persistenceContext = sessionRepo.treePersistenceContext("alice", sessionId);
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId,
      parentSessionId: "",
      caller: "user",
      persistenceContext,
    });
    const scope = await sessionRepo.requireSessionScope("alice", sessionId, persistenceContext);
    directories[sessionId] = scope.sessionDir;
    const file = path.join(scope.sessionDir, "session.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.schemaVersion = 20;
    const turn = turnRecord();
    delete turn.origin;
    delete turn.summaryVersion;
    if (sessionId === "a-broken") turn.executionId = "";
    manifest.turnLifecycle = {
      ...createEmptyTurnLifecycle(),
      sequence: 1,
      activeTurnScopeId: "turn-1",
      turns: { "turn-1": turn },
    };
    await writeFile(file, JSON.stringify(manifest));
  }
  const before = await fileBytes(directories["a-broken"]);
  const result = await upgradeSessionMessageIdentity(v9Options(root));
  assert.equal(result.quarantined.length, 1);
  assert.match(result.quarantined[0].path, /a-broken$/);
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(await fileBytes(directories["a-broken"]), before);
  const repaired = await readSessionArtifact({
    storageService,
    sessionDir: directories["z-valid"],
  });
  assert.equal(repaired.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  assert.deepEqual(repaired.turnLifecycle.turns["turn-1"], turnRecord());
  const healthyBytes = await fileBytes(directories["z-valid"]);
  const repeated = await upgradeSessionMessageIdentity(v9Options(root));
  assert.equal(repeated.sessions.length, 0);
  assert.equal(repeated.quarantined.length, 1);
  assert.deepEqual(await fileBytes(directories["z-valid"]), healthyBytes);
  assert.deepEqual(await fileBytes(directories["a-broken"]), before);
});
