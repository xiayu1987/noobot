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
  SESSION_ARTIFACT_PREDECESSOR,
} from "../../src/session/session-artifact-store.js";
import { registerSessionMessageFacts } from "../../src/session/entities/session-message-facts.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const now = () => "2026-10-19T00:00:00.000Z";

const baseMessages = [
  {
    sessionId: "s",
    attachments: [],
    messageUid: "sm_a_u",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
    content: "a",
    turnScopeId: "a",
    dialogProcessId: "dp1",
  },
  {
    attachments: [],
    messageUid: "sm_a_a",
    ts: TEST_MESSAGE_TS,
    sessionId: "s",
    role: "assistant",
    presentationMessageId: "pm_fx1",
    content: "a1",
    turnScopeId: "a",
    dialogProcessId: "dp1",
  },
  {
    sessionId: "s",
    attachments: [],
    messageUid: "sm_b_u",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
    content: "b",
    turnScopeId: "b",
    dialogProcessId: "dp1",
  },
  {
    sessionId: "s",
    attachments: [],
    messageUid: "sm_c_u",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
    content: "c",
    turnScopeId: "c",
    dialogProcessId: "dp2",
  },
];

const appended = {
  attachments: [],
  messageUid: "sm_a_tool",
  ts: TEST_MESSAGE_TS,
  sessionId: "s",
  role: "tool",
  presentationMessageId: "pm_fx1",
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

function writeTurnView(sessionDir, view, turnScopeIds) {
  return writeSessionTurnArtifacts({
    storageService,
    sessionDir,
    sessionPayload: view.session,
    turnScopeIds,
    atomic: true,
    now,
  });
}

function readView(sessionDir, turnScopeIds) {
  return readSessionTurnView({ storageService, sessionDir, turnScopeIds });
}

function readFull(sessionDir) {
  return readSessionArtifact({ storageService, sessionDir });
}

test("turn view write matches the full write when an earlier turn of a dialog grows", async () =>
  withTemp(async (root) => {
    const fullDir = path.join(root, "full");
    const viewDir = path.join(root, "view");
    await seed(fullDir);
    await seed(viewDir);

    const full = await readFull(fullDir);
    full.messages.push(appended);
    await writeSessionArtifactCanonical({
      storageService,
      sessionDir: fullDir,
      sessionPayload: full,
      atomic: true,
      predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
      now,
    });

    const view = await readView(viewDir, ["a"]);
    assert.deepEqual(view.turnScopeIds.sort(), ["a", "c"]);
    view.session.messages.push(appended);
    registerSessionMessageFacts(view.session, appended);
    const { listFacts } = await writeTurnView(viewDir, view, view.turnScopeIds);

    assert.deepEqual(layoutOf(await readManifest(viewDir)), layoutOf(await readManifest(fullDir)));
    assert.deepEqual((await readFull(viewDir)).messages, (await readFull(fullDir)).messages);
    assert.equal(listFacts.messageCount, 5);
    assert.equal(listFacts.lastMessage.messageUid, "sm_a_tool");
  }));

test("consecutive turn view appends keep later views scoped and the session complete", async () =>
  withTemp(async (root) => {
    await seed(root);
    for (const turnScopeId of ["d", "e"]) {
      const view = await readView(root, [turnScopeId]);
      const message = {
        attachments: [],
        messageUid: `sm_${turnScopeId}_u`,
        ts: TEST_MESSAGE_TS,
        sessionId: "s",
        role: "user",
        messageOrigin: "natural",
        content: turnScopeId,
        turnScopeId,
        dialogProcessId: `dp_${turnScopeId}`,
      };
      view.session.messages.push(message);
      registerSessionMessageFacts(view.session, message);
      await writeTurnView(root, view, view.turnScopeIds);
    }
    const latest = await readView(root, ["f"]);
    assert.deepEqual(latest.turnScopeIds, ["e"]);
    assert.deepEqual(
      (await readFull(root)).messages.map((item) => item.messageUid),
      ["sm_a_u", "sm_a_a", "sm_b_u", "sm_c_u", "sm_d_u", "sm_e_u"],
    );
  }));

test("turn view write rejects a messageUid owned by a turn outside the view", async () =>
  withTemp(async (root) => {
    await seed(root);
    const view = await readView(root, ["c"]);
    view.session.messages.push({
      ...appended,
      attachments: [],
      messageUid: "sm_a_u",
      turnScopeId: "c",
      dialogProcessId: "dp2",
    });
    await assert.rejects(writeTurnView(root, view, view.turnScopeIds), {
      code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
    });
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
    const view = await readView(root, ["a"]);
    await assert.rejects(writeTurnView(root, view, view.turnScopeIds), {
      code: "SESSION_TURN_VIEW_INCOMPLETE",
    });
  }));

test("turn view write rejects a scope list that omits a materialized turn", async () =>
  withTemp(async (root) => {
    await seed(root);
    const view = await readView(root, ["a"]);
    await assert.rejects(writeTurnView(root, view, ["a"]), {
      code: "SESSION_TURN_VIEW_INCOMPLETE",
    });
  }));
