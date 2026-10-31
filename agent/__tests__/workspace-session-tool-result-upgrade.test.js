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
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  TOOL_RESULT_MESSAGE_TYPE,
} from "@noobot/session-protocol";
import { FILE_MUTATION_PROTOCOL, FILE_MUTATION_VERSION } from "@noobot/file-mutation-protocol";
import { upgradeSessionToolResults } from "../src/workspace-lifecycle/session-tool-result-upgrade.js";
import {
  messageHash,
  summarySnapshotContentHash,
} from "../src/session/session-artifact-session/turn-journal-store.js";

const SESSION_ID = "s-patch";
const SESSION_REL = path.join("runtime", "session", SESSION_ID);

function legacyResult(overrides = {}) {
  return {
    toolName: "patch_file",
    ok: true,
    format: "unified_diff",
    strip: 1,
    dryRun: true,
    root: "runtime/ops_workdir",
    requestedRoot: "runtime/ops_workdir",
    changedFiles: ["/host/workspace/runtime/ops_workdir/a.txt"],
    deletedFiles: [],
    resolvedFiles: [
      {
        path: "runtime/ops_workdir/a.txt",
        resolvedPath: "/host/workspace/runtime/ops_workdir/a.txt",
        action: "write",
      },
    ],
    ...overrides,
  };
}

function toolMessage(uid, result, toolName = "patch_file") {
  return {
    role: "tool",
    type: TOOL_RESULT_MESSAGE_TYPE,
    content: JSON.stringify(result),
    sessionId: SESSION_ID,
    messageUid: uid,
    tool_call_id: `call_${uid}`,
    toolName,
  };
}

function assistantMessage(uid) {
  return { role: "assistant", content: uid, sessionId: SESSION_ID, messageUid: uid };
}

function upsert(msg) {
  return { op: "upsert", messageUid: msg.messageUid, message: msg, hash: messageHash(msg) };
}

async function writeSession(base, messages) {
  const sessionDir = path.join(base, SESSION_REL);
  const groups = [messages.slice(0, 1), messages.slice(1)];
  const summarySnapshots = [];
  let previousCheckpointHash = "";
  for (const [index, group] of groups.entries()) {
    const file = `turn-snapshots/turn-000001/checkpoint-00000${index + 1}.json`;
    const payload = {
      schemaVersion: SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
      checkpointId: `cp${index + 1}`,
      checkpointRevision: index + 1,
      previousCheckpointHash,
      records: group.map(upsert),
    };
    const contentHash = summarySnapshotContentHash(payload);
    await mkdir(path.dirname(path.join(sessionDir, file)), { recursive: true });
    await writeFile(path.join(sessionDir, file), `${JSON.stringify(payload, null, 2)}\n`);
    summarySnapshots.push({
      checkpointId: payload.checkpointId,
      checkpointRevision: payload.checkpointRevision,
      file,
      contentHash,
    });
    previousCheckpointHash = contentHash;
  }
  const manifest = {
    sessionId: SESSION_ID,
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    turnOrder: [
      {
        turnId: "turn-000001",
        committedBytes: 0,
        messageHashes: Object.fromEntries(messages.map((m) => [m.messageUid, messageHash(m)])),
        summarySnapshots,
      },
    ],
  };
  await writeFile(path.join(sessionDir, "session.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return sessionDir;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function withBase(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v22-patch-"));
  try {
    await run({
      base: path.join(root, "alice"),
      backupBase: path.join(root, "backup"),
      scopedSessionRoots: ["runtime/agents"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("v22 rewrites legacy dry-run patch results and relinks every hash layer", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, [
      assistantMessage("u1"),
      toolMessage("u2", legacyResult()),
      toolMessage(
        "u3",
        { ok: true, content: "x", path: { view: "workspace", path: "a.txt" } },
        "read_file",
      ),
    ]);
    const result = await upgradeSessionToolResults(options);
    assert.equal(result.quarantined.length, 0);
    assert.equal(result.sessions[0].migratedMessages, 1);

    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const [turn] = manifest.turnOrder;
    let previous = "";
    for (const index of turn.summarySnapshots) {
      const payload = await readJson(path.join(sessionDir, index.file));
      assert.equal(payload.previousCheckpointHash, previous);
      assert.equal(summarySnapshotContentHash(payload), index.contentHash);
      for (const record of payload.records) {
        assert.equal(record.hash, messageHash(record.message));
        assert.equal(turn.messageHashes[record.messageUid], record.hash);
      }
      previous = index.contentHash;
    }
    const last = await readJson(path.join(sessionDir, turn.summarySnapshots[1].file));
    assert.deepEqual(JSON.parse(last.records[0].message.content), {
      toolName: "patch_file",
      ok: true,
      protocol: FILE_MUTATION_PROTOCOL,
      version: FILE_MUTATION_VERSION,
      format: "unified_diff",
      strip: 1,
      dryRun: true,
      root: { view: "workspace", path: "runtime/ops_workdir" },
      changes: [
        { path: { view: "workspace", path: "runtime/ops_workdir/a.txt" }, action: "write" },
      ],
      mutations: [],
      outputResources: [],
    });
    assert.deepEqual(JSON.parse(last.records[1].message.content), {
      ok: true,
      content: "x",
      path: { view: "workspace", path: "a.txt" },
    });

    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
  });
});

test("v22 leaves current patch results untouched", async () => {
  await withBase(async (options) => {
    const current = {
      toolName: "patch_file",
      ok: true,
      dryRun: false,
      root: { view: "workspace", path: "." },
      changes: [{ path: { view: "workspace", path: "a.txt" }, action: "write" }],
      mutations: [],
      outputResources: [],
    };
    const sessionDir = await writeSession(options.base, [
      assistantMessage("u1"),
      toolMessage("u2", current),
    ]);
    const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
  });
});

for (const [name, result, reason] of [
  ["unknown top-level field", legacyResult({ extra: 1 }), "legacy_patch_result_unrecognized"],
  [
    "unknown change field",
    legacyResult({ resolvedFiles: [{ path: "a.txt", action: "write", size: 1 }] }),
    "legacy_patch_change_invalid",
  ],
  ["not dry-run", legacyResult({ dryRun: false }), "legacy_patch_result_not_dry_run"],
  [
    "missing resolved files",
    legacyResult({ resolvedFiles: [] }),
    "legacy_patch_resolved_files_missing",
  ],
  ["missing root", legacyResult({ root: "" }), "legacy_patch_path_missing"],
]) {
  test(`v22 quarantines a legacy patch result with ${name} without writing it`, async () => {
    await withBase(async (options) => {
      const sessionDir = await writeSession(options.base, [
        assistantMessage("u1"),
        toolMessage("u2", result),
      ]);
      const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
      const upgraded = await upgradeSessionToolResults(options);
      assert.equal(upgraded.sessions.length, 0);
      assert.equal(upgraded.quarantined.length, 1);
      assert.match(JSON.stringify(upgraded.quarantined[0].error), new RegExp(reason));
      assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
    });
  });
}

function assistantWithTimeline(uid, toolTimeline) {
  return { ...assistantMessage(uid), toolTimeline };
}

test("v22 rewrites legacy patch results stored in assistant toolTimeline entries", async () => {
  await withBase(async (options) => {
    const pending = { key: "call:c0", toolCallId: "c0", tool: "patch_file", status: "running" };
    const sessionDir = await writeSession(options.base, [
      assistantMessage("u1"),
      assistantWithTimeline("u2", [
        pending,
        {
          key: "call:c1",
          toolCallId: "c1",
          tool: "patch_file",
          status: "completed",
          success: true,
          result: JSON.stringify(legacyResult()),
        },
      ]),
    ]);
    const result = await upgradeSessionToolResults(options);
    assert.equal(result.quarantined.length, 0);
    assert.equal(result.sessions[0].migratedMessages, 1);

    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const [turn] = manifest.turnOrder;
    const last = await readJson(path.join(sessionDir, turn.summarySnapshots[1].file));
    const [record] = last.records;
    assert.equal(record.hash, messageHash(record.message));
    assert.equal(turn.messageHashes.u2, record.hash);
    assert.deepEqual(record.message.toolTimeline[0], pending);
    const migrated = JSON.parse(record.message.toolTimeline[1].result);
    assert.equal(migrated.protocol, FILE_MUTATION_PROTOCOL);
    assert.deepEqual(migrated.changes, [
      { path: { view: "workspace", path: "runtime/ops_workdir/a.txt" }, action: "write" },
    ]);

    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
  });
});

test("v22 quarantines a non-object toolTimeline entry without writing it", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, [
      assistantMessage("u1"),
      assistantWithTimeline("u2", ["bad"]),
    ]);
    const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
    const result = await upgradeSessionToolResults(options);
    assert.equal(result.sessions.length, 0);
    assert.match(JSON.stringify(result.quarantined[0].error), /tool_timeline_item_invalid/);
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
  });
});

const FULL_SCRIPT_RESULT = JSON.stringify({ ok: true, stdout: "x".repeat(400) });

function scriptToolMessage(uid, callId, content) {
  return {
    role: "tool",
    type: TOOL_RESULT_MESSAGE_TYPE,
    content,
    sessionId: SESSION_ID,
    messageUid: uid,
    tool_call_id: callId,
    toolName: "execute_script",
  };
}

function truncatedTimeline(uid, callId, result = FULL_SCRIPT_RESULT.slice(0, 200)) {
  return assistantWithTimeline(uid, [
    {
      key: `call:${callId}`,
      toolCallId: callId,
      tool: "execute_script",
      status: "completed",
      success: true,
      result,
    },
  ]);
}

test("v22 restores truncated toolTimeline results from the paired tool message across checkpoints", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, [
      scriptToolMessage("u1", "c1", FULL_SCRIPT_RESULT),
      truncatedTimeline("u2", "c1"),
    ]);
    const result = await upgradeSessionToolResults(options);
    assert.equal(result.quarantined.length, 0);
    assert.equal(result.sessions[0].migratedMessages, 1);
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const [turn] = manifest.turnOrder;
    const last = await readJson(path.join(sessionDir, turn.summarySnapshots[1].file));
    const [record] = last.records;
    assert.equal(record.message.toolTimeline[0].result, FULL_SCRIPT_RESULT);
    assert.equal(record.hash, messageHash(record.message));
    assert.equal(turn.messageHashes.u2, record.hash);
    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
  });
});

for (const [name, messages, reason] of [
  [
    "no paired tool message",
    [assistantMessage("u1"), truncatedTimeline("u2", "c1")],
    "truncated_timeline_result_unpaired",
  ],
  [
    "ambiguous paired tool messages",
    [
      scriptToolMessage("u1", "c1", FULL_SCRIPT_RESULT),
      scriptToolMessage("u2", "c1", JSON.stringify({ ok: true, stdout: "y" })),
      truncatedTimeline("u3", "c1"),
    ],
    "truncated_timeline_result_ambiguous",
  ],
  [
    "a paired tool message with a different prefix",
    [
      scriptToolMessage("u1", "c1", FULL_SCRIPT_RESULT),
      truncatedTimeline("u2", "c1", `{"ok":false,${"z".repeat(100)}`),
    ],
    "truncated_timeline_result_mismatch",
  ],
]) {
  test(`v22 quarantines a truncated toolTimeline result with ${name} without writing it`, async () => {
    await withBase(async (options) => {
      const sessionDir = await writeSession(options.base, messages);
      const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
      const result = await upgradeSessionToolResults(options);
      assert.equal(result.sessions.length, 0);
      assert.equal(result.quarantined.length, 1);
      assert.match(JSON.stringify(result.quarantined[0].error), new RegExp(reason));
      assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
    });
  });
}

test("v22 keeps a complete non-JSON toolTimeline result equal to its paired tool message", async () => {
  await withBase(async (options) => {
    const legacy = "{'count': 1}";
    const sessionDir = await writeSession(options.base, [
      scriptToolMessage("u1", "c1", legacy),
      truncatedTimeline("u2", "c1", legacy),
    ]);
    const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
  });
});

test("v22 preserves failed and overflow results without requiring successful file fields", async () => {
  await withBase(async (options) => {
    const overflow = { ok: true, overflowed: true, message: "result retained at source" };
    const failed = { ok: false, code: "RECOVERABLE_INVALID_INPUT", error: "context mismatch" };
    const messages = [
      toolMessage("u1", overflow, "read_file"),
      toolMessage("u2", failed),
      assistantWithTimeline("u3", [
        { tool: "read_file", toolCallId: "call_u1", result: JSON.stringify(overflow) },
        { tool: "patch_file", toolCallId: "call_u2", result: JSON.stringify(failed) },
        { tool: "patch_file", toolCallId: "c3", result: JSON.stringify(overflow) },
      ]),
    ];
    const sessionDir = await writeSession(options.base, messages);
    const before = await readFile(path.join(sessionDir, "session.json"), "utf8");
    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), before);
  });
});

test("v22 preserves the sandbox mount view without inferring its host source", async () => {
  await withBase(async (options) => {
    const sessionDir = await writeSession(options.base, [
      assistantMessage("u1"),
      toolMessage(
        "u2",
        {
          ok: true,
          resolvedPath: "/workspace/xiayu/config.json",
          isSandbox: true,
          content: "text",
        },
        "read_file",
      ),
    ]);
    const result = await upgradeSessionToolResults(options);
    assert.equal(result.quarantined.length, 0);
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    const payload = await readJson(
      path.join(sessionDir, manifest.turnOrder[0].summarySnapshots[1].file),
    );
    assert.deepEqual(JSON.parse(payload.records[0].message.content), {
      ok: true,
      content: "text",
      path: { view: "mount", mount: "/workspace", path: "xiayu/config.json" },
    });
    assert.deepEqual(await upgradeSessionToolResults(options), { sessions: [], quarantined: [] });
  });
});

for (const isSandbox of [false, true]) {
  test(`v22 requires a proven host execution view for legacy read_file isSandbox=${isSandbox}`, async () => {
    await withBase(async (options) => {
      const sessionDir = await writeSession(options.base, [
        assistantMessage("u1"),
        toolMessage(
          "u2",
          { ok: true, resolvedPath: "/host/a.txt", isSandbox, content: "text" },
          "read_file",
        ),
      ]);
      const result = await upgradeSessionToolResults(options);
      if (isSandbox) {
        assert.equal(result.sessions.length, 0);
        assert.match(
          JSON.stringify(result.quarantined[0].error),
          /legacy_read_execution_view_unproven/,
        );
      } else {
        assert.equal(result.quarantined.length, 0);
        const manifest = await readJson(path.join(sessionDir, "session.json"));
        const payload = await readJson(
          path.join(sessionDir, manifest.turnOrder[0].summarySnapshots[1].file),
        );
        assert.deepEqual(JSON.parse(payload.records[0].message.content), {
          ok: true,
          content: "text",
          path: { view: "host", path: "/host/a.txt" },
        });
      }
    });
  });
}
