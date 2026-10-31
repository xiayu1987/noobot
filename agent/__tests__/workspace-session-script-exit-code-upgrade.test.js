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
import { SCRIPT_FAILURE_CODE } from "@noobot/execution-isolation-protocol/script-outcome";
import { upgradeSessionScriptExitCodes } from "../src/workspace-lifecycle/session-script-exit-code-upgrade.js";
import { messageHash } from "../src/session/session-artifact-session/turn-journal-store.js";

async function withSession(result, run, toolName = "execute_script") {
  const root = await mkdtemp(path.join(os.tmpdir(), "v23-script-"));
  try {
    const options = {
      base: path.join(root, "alice"),
      backupBase: path.join(root, "backup"),
      scopedSessionRoots: ["runtime/agents"],
    };
    const sessionDir = path.join(options.base, "runtime/session/s1");
    await mkdir(path.join(sessionDir, "turns"), { recursive: true });
    const content = JSON.stringify(result);
    const messages = [
      {
        messageUid: "u1",
        role: "tool",
        type: TOOL_RESULT_MESSAGE_TYPE,
        sessionId: "s1",
        toolName,
        tool_call_id: "c1",
        content,
      },
      {
        messageUid: "u2",
        role: "assistant",
        sessionId: "s1",
        content: "",
        toolTimeline: [{ tool: toolName, toolCallId: "c1", result: content }],
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
    await run({ options, journalPath, manifestPath, journal });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const toolName of ["execute_script", "execute_native_script"]) {
  for (const ok of [true, false]) {
    test(`v23 migrates ${toolName} ok=${ok} without inferring termination and is idempotent`, async () => {
      const legacy = {
        ok,
        code: ok ? 0 : 124,
        stdout: "output",
        ...(ok ? {} : { error: "tool execution failed" }),
      };
      await withSession(
        legacy,
        async ({ options, journalPath, manifestPath }) => {
          const report = await upgradeSessionScriptExitCodes(options);
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
          const expected = {
            ok,
            stdout: "output",
            exitCode: legacy.code,
            ...(ok
              ? {}
              : { error: legacy.error, code: SCRIPT_FAILURE_CODE.LEGACY_TERMINATION_UNKNOWN }),
          };
          assert.deepEqual(JSON.parse(records[0].message.content), expected);
          assert.deepEqual(JSON.parse(records[1].message.toolTimeline[0].result), expected);
          assert.deepEqual(await upgradeSessionScriptExitCodes(options), {
            sessions: [],
            quarantined: [],
          });
        },
        toolName,
      );
    });
  }
}

for (const [name, result] of [
  ["missing ok", { code: 1, error: "failure" }],
  ["missing failure error", { ok: false, code: 1 }],
  ["conflicting exit code", { ok: true, code: 0, exitCode: 1 }],
  ["conflicting termination", { ok: true, code: 0, termination: "exited" }],
  ["fractional exit code", { ok: true, code: 0.5 }],
]) {
  test(`v23 quarantines ${name} without partial writes`, async () => {
    await withSession(result, async ({ options, journalPath, journal }) => {
      const report = await upgradeSessionScriptExitCodes(options);
      assert.equal(report.sessions.length, 0);
      assert.equal(report.quarantined.length, 1);
      assert.equal(await readFile(journalPath, "utf8"), journal);
    });
  });
}

test("v23 leaves current results untouched", async () => {
  await withSession(
    { ok: true, termination: "exited", exitCode: 0 },
    async ({ options, journalPath, journal }) => {
      assert.deepEqual(await upgradeSessionScriptExitCodes(options), {
        sessions: [],
        quarantined: [],
      });
      assert.equal(await readFile(journalPath, "utf8"), journal);
    },
  );
});

test("v23 migrates outbox-only script results while preserving delivery facts and is idempotent", async () => {
  await withSession(
    { ok: true, exitCode: 0, termination: "exited" },
    async ({ options, manifestPath, journalPath, journal }) => {
      const dir = path.join(path.dirname(manifestPath), "authority-outbox");
      await mkdir(dir);
      const file = path.join(dir, "outbox.jsonl");
      const record = {
        op: "enqueue",
        envelope: {
          identity: { eventId: "evt1" },
          payload: {
            eventType: "tool_call_end",
            tool: "execute_script",
            result: JSON.stringify({ ok: false, code: 124, error: "original failure" }),
          },
        },
      };
      const delivered = {
        op: "ack",
        eventId: "evt1",
        consumerId: "service.websocket",
        sequence: 7,
      };
      await writeFile(file, [record, delivered].map((row) => `${JSON.stringify(row)}\n`).join(""));
      const report = await upgradeSessionScriptExitCodes(options);
      assert.equal(report.quarantined.length, 0);
      assert.equal(report.sessions[0].migratedMessages, 0);
      assert.equal(report.sessions[0].migratedRecords, 1);
      const rows = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
      assert.deepEqual(rows[1], delivered);
      const { result, ...payload } = rows[0].envelope.payload;
      assert.deepEqual(payload, { eventType: "tool_call_end", tool: "execute_script" });
      assert.deepEqual(JSON.parse(result), {
        ok: false,
        error: "original failure",
        exitCode: 124,
        code: SCRIPT_FAILURE_CODE.LEGACY_TERMINATION_UNKNOWN,
      });
      assert.equal(await readFile(journalPath, "utf8"), journal);
      assert.deepEqual(await upgradeSessionScriptExitCodes(options), {
        sessions: [],
        quarantined: [],
      });
    },
  );
});
