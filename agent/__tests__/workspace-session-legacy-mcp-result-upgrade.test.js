/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  TOOL_RESULT_MESSAGE_TYPE,
} from "@noobot/session-protocol";
import { upgradeSessionLegacyMcpResults } from "../src/workspace-lifecycle/session-legacy-mcp-result-upgrade.js";
import { messageHash } from "../src/session/session-artifact-session/turn-journal-store.js";

const TURN_SCOPE_ID = "internal-turn:t1";
const PYTHON_LITERAL = "{'count': 1, 'details': [{'expressCode': 'YTO'}]}";
const RAW_THIRD_PARTY_JSON = JSON.stringify({ ret_code: 0, remark: "ok" });

async function withSession(content, run, { stage = "call_mcp_task" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v24-mcp-"));
  try {
    const options = {
      base: path.join(root, "alice"),
      backupBase: path.join(root, "backup"),
      scopedSessionRoots: ["runtime/agent/session"],
    };
    const sessionDir = path.join(options.base, "runtime/agent/session/s1");
    await mkdir(path.join(sessionDir, "turns"), { recursive: true });
    const messages = [
      {
        messageUid: "u1",
        role: "tool",
        type: TOOL_RESULT_MESSAGE_TYPE,
        sessionId: "s1",
        turnScopeId: TURN_SCOPE_ID,
        toolName: "discern_express",
        tool_call_id: "c1",
        content,
      },
      {
        messageUid: "u2",
        role: "assistant",
        sessionId: "s1",
        turnScopeId: TURN_SCOPE_ID,
        content: "",
        toolTimeline: [{ tool: "discern_express", toolCallId: "c1", result: content }],
      },
    ];
    const records = messages.map((message) => ({
      op: "upsert",
      messageUid: message.messageUid,
      message,
      hash: messageHash(message),
    }));
    const journal = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    const journalPath = path.join(sessionDir, "turns/turn-000001.jsonl");
    await writeFile(journalPath, journal);
    const manifestPath = path.join(sessionDir, "session.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        sessionId: "s1",
        schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
        turnLifecycle: { turns: { [TURN_SCOPE_ID]: { turnScopeId: TURN_SCOPE_ID, stage } } },
        turnOrder: [
          {
            turnId: "turn-000001",
            committedBytes: Buffer.byteLength(journal),
            summarySnapshots: [],
            messageHashes: Object.fromEntries(records.map((r) => [r.messageUid, r.hash])),
          },
        ],
      }),
    );
    await run({ options, sessionDir, journalPath, manifestPath, journal });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function canonical(text) {
  return { ok: true, content: [{ type: "text", text }] };
}

for (const [name, legacy] of [
  ["python literal text", PYTHON_LITERAL],
  ["third-party JSON without ok", RAW_THIRD_PARTY_JSON],
]) {
  test(`v24 wraps legacy MCP ${name} in the tool result protocol and is idempotent`, async () => {
    await withSession(legacy, async ({ options, journalPath, manifestPath }) => {
      const report = await upgradeSessionLegacyMcpResults(options);
      assert.equal(report.quarantined.length, 0);
      assert.equal(report.sessions[0].migratedMessages, 2);
      const text = await readFile(journalPath, "utf8");
      const records = text.trim().split("\n").map(JSON.parse);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(manifest.turnOrder[0].committedBytes, Buffer.byteLength(text));
      for (const record of records) {
        assert.equal(record.hash, messageHash(record.message));
        assert.equal(manifest.turnOrder[0].messageHashes[record.messageUid], record.hash);
      }
      assert.deepEqual(JSON.parse(records[0].message.content), canonical(legacy));
      assert.deepEqual(JSON.parse(records[1].message.toolTimeline[0].result), canonical(legacy));
      assert.deepEqual(await upgradeSessionLegacyMcpResults(options), {
        sessions: [],
        quarantined: [],
      });
    });
  });
}

test("v24 quarantines a legacy result whose MCP source is unproven without writing it", async () => {
  await withSession(
    PYTHON_LITERAL,
    async ({ options, journalPath, journal }) => {
      const report = await upgradeSessionLegacyMcpResults(options);
      assert.equal(report.sessions.length, 0);
      assert.equal(report.quarantined.length, 1);
      assert.equal(report.quarantined[0].error.details.reason, "legacy_result_source_unproven");
      assert.equal(await readFile(journalPath, "utf8"), journal);
    },
    { stage: "chat" },
  );
});

test("v24 leaves protocol results untouched", async () => {
  await withSession(
    JSON.stringify(canonical("done")),
    async ({ options, journalPath, journal }) => {
      assert.deepEqual(await upgradeSessionLegacyMcpResults(options), {
        sessions: [],
        quarantined: [],
      });
      assert.equal(await readFile(journalPath, "utf8"), journal);
    },
  );
});

test("v24 wraps outbox-only legacy MCP results while preserving delivery facts", async () => {
  await withSession(
    JSON.stringify(canonical("done")),
    async ({ options, sessionDir, journalPath, journal }) => {
      const dir = path.join(sessionDir, "authority-outbox");
      await mkdir(dir);
      const file = path.join(dir, "outbox.jsonl");
      const record = {
        op: "enqueue",
        envelope: {
          identity: { eventId: "evt1", turnScopeId: TURN_SCOPE_ID },
          payload: { eventType: "tool_call_end", tool: "discern_express", result: PYTHON_LITERAL },
        },
      };
      const delivered = {
        op: "ack",
        eventId: "evt1",
        consumerId: "service.websocket",
        sequence: 7,
      };
      await writeFile(file, [record, delivered].map((row) => `${JSON.stringify(row)}\n`).join(""));
      const report = await upgradeSessionLegacyMcpResults(options);
      assert.equal(report.quarantined.length, 0);
      assert.equal(report.sessions[0].migratedMessages, 0);
      assert.equal(report.sessions[0].migratedRecords, 1);
      const rows = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
      assert.deepEqual(rows[1], delivered);
      assert.deepEqual(JSON.parse(rows[0].envelope.payload.result), canonical(PYTHON_LITERAL));
      assert.equal(await readFile(journalPath, "utf8"), journal);
      assert.deepEqual(await upgradeSessionLegacyMcpResults(options), {
        sessions: [],
        quarantined: [],
      });
    },
  );
});
