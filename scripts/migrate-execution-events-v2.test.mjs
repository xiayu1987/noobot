/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import {
  readExecutionLogs,
  readSessionArtifactSnapshot,
} from "../agent/src/session/session-artifact-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationScript = path.join(repositoryRoot, "scripts/migrate-execution-events-v2.mjs");

function runMigration(workspaceRoot, ...args) {
  return JSON.parse(
    execFileSync(process.execPath, [migrationScript, `--workspace=${workspaceRoot}`, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function writeLegacySession(sessionDir, segments) {
  const eventsDir = path.join(sessionDir, "execution-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const entries = segments.map((records, index) => {
    const file = `segment-${String(index + 1).padStart(6, "0")}.jsonl`;
    const body = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    fs.writeFileSync(path.join(eventsDir, file), body);
    return {
      sequence: index + 1,
      file,
      bytes: Buffer.byteLength(body),
      records: records.length,
      sealed: index < segments.length - 1,
    };
  });
  fs.writeFileSync(
    path.join(eventsDir, "index.json"),
    JSON.stringify({
      schemaVersion: 1,
      maxSegmentBytes: 5242880,
      activeSequence: entries.length,
      segments: entries,
    }),
  );
}

function writeLegacyReport(sessionDir, dialogProcessId, fields = {}) {
  const reportsDir = path.join(sessionDir, "execution-reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, `${dialogProcessId}.json`),
    JSON.stringify({
      protocol: "noobot.execution-report",
      version: 1,
      status: "completed",
      sessionId: "session-1",
      parentSessionId: "",
      dialogProcessId,
      turnScopeId: `turn-${dialogProcessId}`,
      caller: "user",
      startedAt: "2026-10-10T00:00:00.000Z",
      finishedAt: "2026-10-10T00:00:05.000Z",
      durationMs: 5000,
      summary: { visibleTotal: 0, toolCallCount: 0, toolResultCount: 0, errorCount: 0 },
      error: null,
      ...fields,
    }),
  );
}

function withWorkspace(run) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-execution-events-v2-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const sessionDir = path.join(workspaceRoot, "user", "runtime", "session", "session-1");
  return Promise.resolve(
    run({ workspaceRoot, sessionDir, backupRoot: path.join(temporaryRoot, "backup") }),
  ).finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
}

test("splits legacy segments per turn, rebuilds v4 reports and removes execution.json", () =>
  withWorkspace(async ({ workspaceRoot, sessionDir, backupRoot }) => {
    writeLegacySession(sessionDir, [
      [
        {
          id: 1,
          dialogProcessId: "d1",
          event: "tool_call_start",
          category: "tool",
          type: "tool_call",
          data: { tool: "read_file", toolCallId: "call-1" },
        },
        {
          id: 2,
          dialogProcessId: "d1",
          event: "tool_call_end",
          category: "tool",
          type: "tool_result",
          data: { tool: "read_file", toolCallId: "call-1" },
        },
        { id: 3, dialogProcessId: "d2", event: "session_loaded", data: {} },
      ],
      [{ id: 4, dialogProcessId: "d2", event: "session_loaded", data: {} }],
    ]);
    writeLegacyReport(sessionDir, "d1");
    writeLegacyReport(sessionDir, "d3", {
      status: "failed",
      error: { name: "Error", code: "X", message: "boom" },
    });
    fs.writeFileSync(
      path.join(sessionDir, "execution.json"),
      JSON.stringify({ sessionId: "session-1", dialogProcessId: "d2" }),
    );

    assert.throws(() => runMigration(workspaceRoot, "--write"), /requires --backup/);

    const dryRun = runMigration(workspaceRoot);
    assert.equal(dryRun.legacySessions, 1);
    assert.equal(dryRun.records, 4);
    assert.equal(dryRun.reports, 2);
    assert.equal(dryRun.executionFiles, 1);
    assert.equal(dryRun.sessions[0].turns, 2);
    assert.equal(dryRun.written, false);
    assert.equal(fs.existsSync(path.join(sessionDir, "execution.json")), true);

    const written = runMigration(workspaceRoot, `--backup=${backupRoot}`, "--write");
    assert.equal(written.written, true);
    assert.equal(written.reportsWithoutLogs, 1);

    const ids = async (options) => (await readExecutionLogs(sessionDir, options)).map((l) => l.id);
    assert.deepEqual(await ids({ dialogProcessId: "d1" }), [1, 2]);
    assert.deepEqual(await ids({ dialogProcessId: "d2" }), [3, 4]);
    assert.deepEqual(await ids(), [1, 2, 3, 4]);
    assert.equal(fs.existsSync(path.join(sessionDir, ".execution-events-v2-staging")), false);
    assert.equal(fs.existsSync(path.join(sessionDir, "execution.json")), false);

    const report = (id) =>
      decodeExecutionReport(
        JSON.parse(fs.readFileSync(path.join(sessionDir, "execution-reports", `${id}.json`))),
      );
    assert.equal(report("d1").summary.toolCallCount, 1);
    assert.equal(report("d1").summaryError, null);
    assert.equal(report("d1").durationMs, 5000);
    assert.equal(report("d3").summary, null);
    assert.equal(report("d3").summaryError.code, "EXECUTION_LOGS_UNAVAILABLE");
    assert.equal(report("d3").error.message, "boom");

    const backupDir = path.join(backupRoot, "user/runtime/session/session-1");
    const backupIndex = path.join(backupDir, "execution-events/index.json");
    assert.equal(JSON.parse(fs.readFileSync(backupIndex, "utf8")).schemaVersion, 1);
    assert.equal(fs.existsSync(path.join(backupDir, "execution.json")), true);
    const backupReport = path.join(backupDir, "execution-reports/d1.json");
    assert.equal(JSON.parse(fs.readFileSync(backupReport, "utf8")).version, 1);

    const converged = runMigration(workspaceRoot, `--backup=${backupRoot}`, "--write");
    assert.equal(converged.legacySessions, 0);
  }));

for (const [label, record] of [
  ["missing", { id: 1 }],
  ["data-only", { id: 1, data: { dialogProcessId: "d1" } }],
]) {
  test(`rejects legacy records with ${label} top-level dialogProcessId`, () =>
    withWorkspace(({ workspaceRoot, sessionDir, backupRoot }) => {
      writeLegacySession(sessionDir, [[record]]);
      assert.throws(
        () => runMigration(workspaceRoot, `--backup=${backupRoot}`, "--write"),
        /invalid dialogProcessId/,
      );
      assert.equal(fs.existsSync(backupRoot), false);
    }));
}

test("commits legacy plugin-data snapshots using session.json sessionId", () =>
  withWorkspace(async ({ workspaceRoot, backupRoot }) => {
    const snapshotDir = path.join(
      workspaceRoot,
      "user/runtime/plugin-data/workflow/session/parent/node-1",
    );
    writeLegacySession(snapshotDir, [[{ id: 1, dialogProcessId: "d1", event: "x", data: {} }]]);
    fs.writeFileSync(
      path.join(snapshotDir, "session.json"),
      JSON.stringify({ sessionId: "child-1", messages: [] }),
    );
    const nonSnapshotDir = path.join(workspaceRoot, "user/runtime/session/session-2");
    fs.mkdirSync(nonSnapshotDir, { recursive: true });
    fs.writeFileSync(
      path.join(nonSnapshotDir, "session.json"),
      JSON.stringify({ sessionId: "session-2", messages: [] }),
    );
    await assert.rejects(readSessionArtifactSnapshot({ outputDir: snapshotDir }), {
      code: "SNAPSHOT_MANIFEST_MISSING",
    });

    const dryRun = runMigration(workspaceRoot);
    assert.equal(dryRun.snapshotCommits, 1);
    assert.equal(dryRun.legacySessions, 1);
    assert.equal(fs.existsSync(path.join(snapshotDir, "snapshot-manifest.json")), false);

    runMigration(workspaceRoot, `--backup=${backupRoot}`, "--write");
    const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, "snapshot-manifest.json")));
    assert.equal(manifest.sessionId, "child-1");
    assert.equal(manifest.schemaVersion, 1);
    const snapshot = await readSessionArtifactSnapshot({ outputDir: snapshotDir });
    assert.deepEqual(
      snapshot.executionLogs.map((log) => log.id),
      [1],
    );
    assert.equal(fs.existsSync(path.join(nonSnapshotDir, "snapshot-manifest.json")), false);
    assert.equal(
      runMigration(workspaceRoot, `--backup=${backupRoot}`, "--write").legacySessions,
      0,
    );
  }));
