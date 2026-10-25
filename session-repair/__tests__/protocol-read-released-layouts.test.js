/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readSessionForProtocolRepair } from "../src/index.js";

const m1 = { messageUid: "m1", role: "user", content: "one" };
const m2 = { messageUid: "m2", role: "assistant", content: "two" };
const m3 = { messageUid: "m3", role: "user", content: "three" };

async function withTurnFiles(turns, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-released-layout-"));
  try {
    await mkdir(path.join(root, "turns"), { recursive: true });
    for (const [turnId, messages] of Object.entries(turns)) {
      await writeFile(
        path.join(root, "turns", `${turnId}.json`),
        JSON.stringify({ turnId, messages }),
        "utf8",
      );
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const turnEntry = (turnId) => ({ turnId, file: `turns/${turnId}.json` });

test("v4.0.0-v4.1.0 unversioned documents return their inline messages", async () => {
  const session = { messages: [m1, m2] };
  assert.equal(await readSessionForProtocolRepair({ sessionDir: "/unused", session }), session);
});

test("unversioned documents without inline messages are rejected", async () => {
  await assert.rejects(
    readSessionForProtocolRepair({ sessionDir: "/unused", session: { turnOrder: [] } }),
    { code: "SESSION_ARTIFACT_FIELD_SCHEMA_MISMATCH" },
  );
});

test("v4.1.1-v4.1.3 schema 2 concatenates turn files in turnOrder", async () => {
  await withTurnFiles({ t1: [m1, m2], t2: [m3] }, async (root) => {
    const repaired = await readSessionForProtocolRepair({
      sessionDir: root,
      session: { schemaVersion: 2, turnOrder: [turnEntry("t1"), turnEntry("t2")] },
    });
    assert.deepEqual(repaired.messages, [m1, m2, m3]);
  });
});

test("v4.1.4 schema 4 orders messages by turnId and messageIndex", async () => {
  await withTurnFiles({ t1: [m1, m2], t2: [m3] }, async (root) => {
    const repaired = await readSessionForProtocolRepair({
      sessionDir: root,
      session: {
        schemaVersion: 4,
        turnOrder: [turnEntry("t1"), turnEntry("t2")],
        messageOrder: [
          { turnId: "t2", messageIndex: 0 },
          { turnId: "t1", messageIndex: 0 },
          { turnId: "t1", messageIndex: 1 },
        ],
      },
    });
    assert.deepEqual(repaired.messages, [m3, m1, m2]);
  });
});

test("schema 4 without messageOrder is rejected", async () => {
  await withTurnFiles({ t1: [m1] }, async (root) => {
    await assert.rejects(
      readSessionForProtocolRepair({
        sessionDir: root,
        session: { schemaVersion: 4, turnOrder: [turnEntry("t1")] },
      }),
      { code: "SESSION_ARTIFACT_FIELD_SCHEMA_MISMATCH" },
    );
  });
});

test("versioned manifests no longer short-circuit on inline messages", async () => {
  await assert.rejects(
    readSessionForProtocolRepair({
      sessionDir: "/unused",
      session: { schemaVersion: 2, messages: [m1] },
    }),
    { code: "SESSION_ARTIFACT_FIELD_SCHEMA_MISMATCH" },
  );
});

test("string turnOrder entries match no released writer and are rejected", async () => {
  await withTurnFiles({ t1: [m1] }, async (root) => {
    await assert.rejects(
      readSessionForProtocolRepair({
        sessionDir: root,
        session: { schemaVersion: 2, turnOrder: ["turns/t1.json"] },
      }),
      { code: "SESSION_REPAIR_ARTIFACT_PATH_INVALID" },
    );
  });
});

test("schema 2 turn files must be json, not journals", async () => {
  await withTurnFiles({}, async (root) => {
    await assert.rejects(
      readSessionForProtocolRepair({
        sessionDir: root,
        session: { schemaVersion: 2, turnOrder: [{ turnId: "t1", file: "turns/t1.jsonl" }] },
      }),
      { code: "SESSION_REPAIR_ARTIFACT_PATH_INVALID" },
    );
  });
});
