/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTurnReplaceRequest } from "@noobot/session-protocol";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import { repairUserWorkspace } from "../src/workspace-lifecycle/index.js";
import { initializeImmutableSession } from "../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import { openSessionArtifactReader } from "../src/session/session-artifact-session/immutable-session-reader.js";
import { commitSessionChanges } from "../src/session/session-artifact-session/commit-session-changes.js";
import { createTestSessionRequiredFields } from "./helpers/session-message-facts.js";
import { mutationMessage, mutationTime } from "./helpers/immutable-mutation-integration-fixture.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";

async function fixture(t, relativePath) {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-context-repair-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.mutation-locks`, { recursive: true, force: true });
  });
  const base = path.join(root, "u1");
  const assetPackagePath = path.join(root, "assets");
  await mkdir(assetPackagePath, { recursive: true });
  await mkdir(path.dirname(path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE)), {
    recursive: true,
  });
  await writeFile(
    path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE),
    JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION }),
  );
  const sessionDir = path.join(base, relativePath);
  const message = mutationMessage("source", "old-turn");
  await initializeImmutableSession({
    sessionDir,
    operationId: "seed",
    session: {
      ...createTestSessionRequiredFields(),
      sessionId: "s1",
      aggregateVersion: 0,
      messages: [message],
      dialogOrder: [
        {
          dialogProcessId: message.dialogProcessId,
          turnScopeId: message.turnScopeId,
          userMessageUid: message.messageUid,
          dialogOrdinal: 1,
        },
      ],
    },
  });
  const options = {
    workspaceRoot: root,
    userId: "u1",
    assetPackagePath,
    baseValues: {},
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    storageService: TEST_STORAGE_SERVICE,
  };
  return { sessionDir, options, store: await ImmutableSessionStore.open({ sessionDir }) };
}

for (const relativePath of [
  "runtime/session/s1",
  "runtime/plugin-data/workflow/session/run/node",
]) {
  test(`workspace repair restores current-version context indexes and permits resend: ${relativePath}`, async (t) => {
    const { sessionDir, options, store } = await fixture(t, relativePath);
    await using original = await openSessionArtifactReader({ sessionDir });
    const expected = await original.exportSession();
    const snapshot = await store.snapshot();
    await store.commit({
      expectedGeneration: snapshot.generation,
      operationId: "missing-derived-indexes",
      changes: [
        { collection: "contextSources", key: "old-turn", remove: true },
        { collection: "dialogTurns", key: "dialog-old-turn", remove: true },
        { collection: "dialogOrder", key: "0000000000000001", remove: true },
        { collection: "contextSources", key: "stale-turn", value: { count: 0, root: null } },
      ],
    });
    const broken = await store.snapshot();
    const { report } = await repairUserWorkspace(options);
    assert.deepEqual(report.layoutUpgrades, []);
    assert.equal(report.sessionContextIndexes.sessions.length, 1);
    await using repaired = await openSessionArtifactReader({ sessionDir });
    assert.deepEqual(await repaired.exportSession(), expected);
    assert.deepEqual(
      (await repaired.readContextSource({ scope: {}, historyLimit: 1 })).messages.map(
        (message) => message.messageUid,
      ),
      ["source"],
    );
    assert.equal(await store.get(await store.snapshot(), "contextSources", "stale-turn"), null);
    const healed = await store.snapshot();
    await repairUserWorkspace(options);
    assert.deepEqual(await store.snapshot(), healed);
    assert.notEqual(healed.generation, broken.generation);
    const result = await commitSessionChanges({
      sessionDir,
      sessionId: "s1",
      expectedGeneration: healed.generation,
      operationId: "resend-after-repair",
      committedAt: mutationTime,
      changes: {
        turnReplacement: {
          command: parseTurnReplaceRequest({
            commandId: "resend",
            anchor: { turnScopeId: "old-turn" },
            turnScopeId: "new-turn",
            newContent: "edited",
            attachments: [],
          }),
          identity: {
            dialogProcessId: "new-dialog",
            messageUid: "sm_new",
            userMessageId: "um_new",
          },
        },
      },
    });
    assert.equal(
      result.result.turnReplacement.receipt.result.turnReplacement.replacementUserMessageUid,
      "sm_new",
    );
    await using replaced = await openSessionArtifactReader({ sessionDir });
    assert.deepEqual(
      (await replaced.exportSession()).messages.map((message) => message.content),
      ["edited"],
    );
    assert.deepEqual(await original.exportSession(), expected);
  });
}
