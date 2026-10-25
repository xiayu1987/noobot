/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
  readSessionTurnView,
  writeSessionArtifact as writeSessionArtifactCanonical,
  writeSessionTurnArtifacts,
} from "../../src/session/session-artifact-store.js";
import { registerSessionMessageFacts } from "../../src/session/entities/session-message-facts.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

const now = () => "2026-10-19T00:00:00.000Z";

const baseMessages = [
  {
    sessionId: "s",
    messageUid: "sm_a_u",
    role: "user",
    content: "a",
    turnScopeId: "a",
    dialogProcessId: "dp1",
  },
  {
    messageUid: "sm_a_a",
    sessionId: "s",
    role: "assistant",
    presentationMessageId: "pm_fx1",
    content: "a1",
    turnScopeId: "a",
    dialogProcessId: "dp1",
  },
  {
    sessionId: "s",
    messageUid: "sm_b_u",
    role: "user",
    content: "b",
    turnScopeId: "b",
    dialogProcessId: "dp1",
  },
  {
    sessionId: "s",
    messageUid: "sm_c_u",
    role: "user",
    content: "c",
    turnScopeId: "c",
    dialogProcessId: "dp2",
  },
];

const appended = {
  messageUid: "sm_a_tool",
  sessionId: "s",
  role: "tool",
  presentationMessageId: "pm_fx2",
  content: "late",
  turnScopeId: "a",
  dialogProcessId: "dp1",
};

async function readManifest(root) {
  return JSON.parse(await readFile(buildSessionArtifactFileMap(root).session, "utf8"));
}

function layoutOf(manifest) {
  return {
    turnOrder: manifest.turnOrder.map(({ turnId, turnScopeId, messageOrder, messageHashes }) => ({
      turnId,
      turnScopeId,
      messageOrder,
      messageHashes,
    })),
    messageOrder: manifest.messageOrder,
    dialogOrder: manifest.dialogOrder,
  };
}

async function seed(root) {
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: {
      ...createTestSessionRequiredFields(),
      sessionId: "s",
      aggregateVersion: 0,
      messages: baseMessages,
    },
    now,
  });
}

test("turn view write matches the full write when an earlier turn of a dialog grows", async () =>
  withTemp(async (root) => {
    const fullDir = path.join(root, "full");
    const viewDir = path.join(root, "view");
    await seed(fullDir);
    await seed(viewDir);

    const full = await readSessionArtifact({ sessionDir: fullDir });
    full.messages.push(appended);
    await writeSessionArtifactCanonical({ sessionDir: fullDir, sessionPayload: full, now });

    const view = await readSessionTurnView({ sessionDir: viewDir, turnScopeIds: ["a"] });
    assert.deepEqual(view.turnScopeIds.sort(), ["a", "c"]);
    view.session.messages.push(appended);
    registerSessionMessageFacts(view.session, appended);
    const { listFacts } = await writeSessionTurnArtifacts({
      sessionDir: viewDir,
      sessionPayload: view.session,
      turnScopeIds: view.turnScopeIds,
      now,
    });

    assert.deepEqual(layoutOf(await readManifest(viewDir)), layoutOf(await readManifest(fullDir)));
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: viewDir })).messages,
      (await readSessionArtifact({ sessionDir: fullDir })).messages,
    );
    assert.equal(listFacts.messageCount, 5);
    assert.equal(listFacts.lastMessage.messageUid, "sm_a_tool");
  }));

test("consecutive turn view appends keep later views scoped and the session complete", async () =>
  withTemp(async (root) => {
    await seed(root);
    for (const turnScopeId of ["d", "e"]) {
      const view = await readSessionTurnView({ sessionDir: root, turnScopeIds: [turnScopeId] });
      const message = {
        messageUid: `sm_${turnScopeId}_u`,
        sessionId: "s",
        role: "user",
        content: turnScopeId,
        turnScopeId,
        dialogProcessId: `dp_${turnScopeId}`,
      };
      view.session.messages.push(message);
      registerSessionMessageFacts(view.session, message);
      await writeSessionTurnArtifacts({
        sessionDir: root,
        sessionPayload: view.session,
        turnScopeIds: view.turnScopeIds,
        now,
      });
    }
    const latest = await readSessionTurnView({ sessionDir: root, turnScopeIds: ["f"] });
    assert.deepEqual(latest.turnScopeIds, ["e"]);
    assert.deepEqual(
      (await readSessionArtifact({ sessionDir: root })).messages.map((item) => item.messageUid),
      ["sm_a_u", "sm_a_a", "sm_b_u", "sm_c_u", "sm_d_u", "sm_e_u"],
    );
  }));

test("turn view write rejects a messageUid owned by a turn outside the view", async () =>
  withTemp(async (root) => {
    await seed(root);
    const view = await readSessionTurnView({ sessionDir: root, turnScopeIds: ["c"] });
    view.session.messages.push({
      ...appended,
      messageUid: "sm_a_u",
      turnScopeId: "c",
      dialogProcessId: "dp2",
    });
    await assert.rejects(
      writeSessionTurnArtifacts({
        sessionDir: root,
        sessionPayload: view.session,
        turnScopeIds: view.turnScopeIds,
        now,
      }),
      { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
    );
  }));

test("turn view write rejects an outside turn without ordered messages", async () =>
  withTemp(async (root) => {
    await seed(root);
    const files = buildSessionArtifactFileMap(root);
    const manifest = await readManifest(root);
    const target = manifest.turnOrder.find((item) => item.turnScopeId === "b");
    manifest.messageOrder = manifest.messageOrder.filter(
      (reference) => !target.messageOrder.includes(reference.messageUid),
    );
    target.messageOrder = [];
    target.messageHashes = {};
    await writeFile(files.session, JSON.stringify(manifest));
    const view = await readSessionTurnView({ sessionDir: root, turnScopeIds: ["a"] });
    await assert.rejects(
      writeSessionTurnArtifacts({
        sessionDir: root,
        sessionPayload: view.session,
        turnScopeIds: view.turnScopeIds,
        now,
      }),
      { code: "SESSION_TURN_VIEW_INCOMPLETE" },
    );
  }));

test("turn view write rejects a scope list that omits a materialized turn", async () =>
  withTemp(async (root) => {
    await seed(root);
    const view = await readSessionTurnView({ sessionDir: root, turnScopeIds: ["a"] });
    await assert.rejects(
      writeSessionTurnArtifacts({
        sessionDir: root,
        sessionPayload: view.session,
        turnScopeIds: ["a"],
        now,
      }),
      { code: "SESSION_TURN_VIEW_INCOMPLETE" },
    );
  }));
