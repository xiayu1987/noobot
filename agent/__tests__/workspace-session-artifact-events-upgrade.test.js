/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol";
import { buildHarness } from "./session/scoped-session-repositories.fixtures.js";
import {
  saveCanonicalSession,
  v9Options,
  SESSION_ID,
} from "./helpers/session-identity-upgrade.fixtures.js";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { normalizeSessionEntity } from "../src/session/entities/session-entity.js";
import {
  readSessionArtifact,
  writeSessionArtifact,
  SESSION_ARTIFACT_PREDECESSOR,
} from "../src/session/session-artifact-store.js";

const INVALID = { code: SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID };

test("session creation initializes events and runtime reads/writes reject corrupt collections", async (t) => {
  const harness = buildHarness();
  const { sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const initial = sessionRepo.createInitialSession({
    sessionId: SESSION_ID,
    parentSessionId: "",
    caller: "user",
  });
  assert.deepEqual(initial.sessionArtifactEvents, []);
  const sessionDir = await saveCanonicalSession(sessionRepo);
  const file = path.join(sessionDir, "session.json");
  const bytes = await readFile(file, "utf8");
  const session = await readSessionArtifact({ storageService, sessionDir });
  for (const events of [
    undefined,
    null,
    {},
    [null],
    [{ identity: { eventId: "e-1", sessionId: "foreign" } }],
  ]) {
    await writeFile(file, bytes, "utf8");
    const invalidSession = { ...session, sessionArtifactEvents: events };
    assert.throws(() => normalizeSessionEntity(invalidSession), INVALID);
    await assert.rejects(
      writeSessionArtifact({
        storageService,
        sessionDir,
        sessionPayload: invalidSession,
        predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
        atomic: true,
      }),
      INVALID,
    );
    assert.equal(await readFile(file, "utf8"), bytes);
    await writeFile(file, JSON.stringify(invalidSession), "utf8");
    await assert.rejects(readSessionArtifact({ storageService, sessionDir }), INVALID);
  }
});

test("v28 migrates schema19 absence, preserves artifact facts and converges on rerun", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const sessionDir = await saveCanonicalSession(sessionRepo);
  const file = path.join(sessionDir, "session.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.schemaVersion = 19;
  delete manifest.sessionArtifactEvents;
  await writeFile(file, JSON.stringify(manifest), "utf8");
  const first = await upgradeSessionMessageIdentity(v9Options(root));
  assert.deepEqual(first.quarantined, []);
  assert.equal(first.sessions.length, 1);
  const session = await readSessionArtifact({ storageService, sessionDir });
  assert.equal(session.schemaVersion, 21);
  assert.deepEqual(session.sessionArtifactEvents, []);
  const artifact = createPluginArtifactEnvelope({
    sessionId: SESSION_ID,
    turnScopeId: "t1",
    pluginId: "sample",
    artifactType: "report",
    artifactId: "report-1",
    data: { text: "keep" },
    operation: "created",
    baseRevision: null,
    revision: 1,
    sequence: 1,
    occurredAt: "2026-10-31T18:00:00.000Z",
  });
  session.sessionArtifactEvents.push(artifact);
  await writeSessionArtifact({
    storageService,
    sessionDir,
    sessionPayload: session,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    atomic: true,
  });
  assert.deepEqual(
    (await readSessionArtifact({ storageService, sessionDir })).sessionArtifactEvents,
    [artifact],
  );
  const repeated = await upgradeSessionMessageIdentity(v9Options(root));
  assert.deepEqual(repeated.sessions, []);
  assert.deepEqual(repeated.quarantined, []);
});

test("v28 quarantines corrupt schema19 facts without rewriting the original manifest", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo } = await harness.setup();
  t.after(() => harness.cleanup());
  const sessionDir = await saveCanonicalSession(sessionRepo);
  const file = path.join(sessionDir, "session.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.schemaVersion = 19;
  manifest.sessionArtifactEvents = [null];
  const bytes = JSON.stringify(manifest);
  await writeFile(file, bytes, "utf8");
  const result = await upgradeSessionMessageIdentity(v9Options(root));
  assert.equal(result.quarantined.length, 1);
  assert.deepEqual(result.sessions, []);
  assert.equal(await readFile(file, "utf8"), bytes);
});
