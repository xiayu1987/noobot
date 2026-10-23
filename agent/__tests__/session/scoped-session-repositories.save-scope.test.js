/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { buildHarness, readJson } from "./scoped-session-repositories.fixtures.js";

const treeContext = (sessionRepo, sessionId) => ({
  persistenceContext: sessionRepo.treePersistenceContext("alice", sessionId),
});

test("concurrent repository saves allocate monotonic Turn journals without cross-Turn records", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    const sessionId = "concurrent-turn-journals";
    const keep = {
      messageUid: "keep-message",
      role: "user",
      content: "keep",
      dialogProcessId: "dialog-keep",
      turnScopeId: "turn-keep",
    };
    const replaced = {
      messageUid: "replaced-message",
      role: "assistant",
      presentationMessageId: "pm_replaced",
      modelMessageId: "mm_replaced",
      content: "replaced",
      dialogProcessId: "dialog-replaced",
      turnScopeId: "turn-replaced",
    };
    await sessionRepo.save(
      "alice",
      applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        parentSessionId: "",
        sessionId,
        aggregateVersion: 0,
        messages: [keep, replaced],
      }),
      { createOnly: true, ...treeContext(sessionRepo, sessionId) },
    );

    const replacement = (suffix) => ({
      messageUid: `replacement-${suffix}`,
      role: "assistant",
      presentationMessageId: `pm_${suffix}`,
      modelMessageId: `mm_${suffix}`,
      content: `replacement-${suffix}`,
      dialogProcessId: `dialog-${suffix}`,
      turnScopeId: `turn-${suffix}`,
    });
    await Promise.all([
      sessionRepo.save(
        "alice",
        applySessionMessageFacts({
          ...createTestSessionRequiredFields(),
          parentSessionId: "",
          sessionId,
          aggregateVersion: 0,
          messages: [keep, replacement("a")],
        }),
        treeContext(sessionRepo, sessionId),
      ),
      sessionRepo.save(
        "alice",
        applySessionMessageFacts({
          ...createTestSessionRequiredFields(),
          parentSessionId: "",
          sessionId,
          aggregateVersion: 0,
          messages: [keep, replacement("b")],
        }),
        treeContext(sessionRepo, sessionId),
      ),
    ]);

    const scope = await sessionRepo.requireSessionScope(
      "alice",
      sessionId,
      treeContext(sessionRepo, sessionId).persistenceContext,
    );
    const files = buildSessionArtifactFileMap(scope.sessionDir);
    const manifest = await readJson(files.session);
    assert.deepEqual(
      manifest.turnOrder.map((turn) => turn.turnId),
      ["turn-000001", "turn-000004"],
    );
    assert.equal(manifest.turnArtifactSequence, 4);
    assert.equal(
      new Set(manifest.turnOrder.map((turn) => turn.turnId)).size,
      manifest.turnOrder.length,
    );

    const restored = await readSessionArtifact({ sessionDir: scope.sessionDir });
    assert.equal(restored.messages[0].turnScopeId, "turn-keep");
    assert.equal(restored.messages.length, 2);
    assert.equal(["turn-a", "turn-b"].includes(restored.messages[1].turnScopeId), true);

    for (const turn of manifest.turnOrder) {
      const records = (await readFile(path.join(scope.sessionDir, turn.file), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const recordTurnScopes = new Set(
        records.map((record) => record?.message?.turnScopeId).filter(Boolean),
      );
      assert.deepEqual([...recordTurnScopes], [turn.turnScopeId]);
    }
  } finally {
    await harness.cleanup();
  }
});

test("session save rejects entity parentSessionId that conflicts with the located scope", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  const childEntity = (parentSessionId) => ({
    ...createTestSessionRequiredFields(),
    sessionId: "child",
    parentSessionId,
    aggregateVersion: 0,
  });
  try {
    await sessionRepo.save(
      "alice",
      {
        ...createTestSessionRequiredFields(),
        sessionId: "p1",
        parentSessionId: "",
        aggregateVersion: 0,
      },
      { createOnly: true, ...treeContext(sessionRepo, "p1") },
    );
    await sessionRepo.save("alice", childEntity("p1"), {
      createOnly: true,
      ...treeContext(sessionRepo, "child"),
    });
    for (const conflictingParent of ["p2", ""]) {
      await assert.rejects(
        sessionRepo.save(
          "alice",
          childEntity(conflictingParent),
          treeContext(sessionRepo, "child"),
        ),
        { code: "SESSION_SCOPE_IDENTITY_CONFLICT", statusCode: 409 },
      );
    }
    const childScope = await sessionRepo.requireSessionScope(
      "alice",
      "child",
      treeContext(sessionRepo, "child").persistenceContext,
    );
    assert.equal(childScope.resolvedParentSessionId, "p1");
    assert.equal((await readJson(childScope.sessionFile)).parentSessionId, "p1");
  } finally {
    await harness.cleanup();
  }
});
