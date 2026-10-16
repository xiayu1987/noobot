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

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationScript = path.join(repositoryRoot, "scripts/migrate-session-protocol-v1.mjs");

function runMigration(workspaceRoot, backupRoot, ...args) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [migrationScript, `--workspace=${workspaceRoot}`, `--backup=${backupRoot}`, ...args],
      { encoding: "utf8" },
    ),
  );
}

test("migrates entity message identity without creating an identity for presentation projections", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "noobot-session-protocol-migration-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const backupRoot = path.join(temporaryRoot, "backup");
  const sessionDirectory = path.join(workspaceRoot, "user", "runtime", "session", "session-1");
  const sessionFile = path.join(sessionDirectory, "session.json");
  const turnRecordFile = path.join(sessionDirectory, "turns", "turn-1.jsonl");
  const summaryProjectionFile = path.join(sessionDirectory, "session-summary.json");
  fs.mkdirSync(path.dirname(turnRecordFile), { recursive: true });
  const turnRecord = `${JSON.stringify({ op: "upsert", messageUid: "sm_turn_1", message: { role: "user" } })}\n`;
  const summaryProjection = `${JSON.stringify({ schemaVersion: 28, sessionId: "session-1" })}\n`;
  fs.writeFileSync(turnRecordFile, turnRecord);
  fs.writeFileSync(summaryProjectionFile, summaryProjection);
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify(
      {
        sessionId: "session-1",
        aggregateVersion: 3,
        messages: [
          {
            role: "user",
            messageId: "message-1",
            turnScopeId: "turn-1",
            dialogProcessId: "dialog-1",
            content: "source",
          },
          {
            role: "assistant",
            chatPresentation: true,
            presentationMessageId: "presentation-1",
            messageId: "presentation-1",
            sourceMessageId: "message-2",
            sourceMessageUid: "sm_source_2",
            content: "projection",
          },
          {
            role: "assistant",
            chatPresentation: true,
            presentationMessageId: "presentation-2",
            messageId: "presentation-2",
            messageUid: "sm_invalid_projection_identity",
            sourceMessageId: "message-3",
            sourceMessageUid: "sm_source_3",
            content: "projection with an invalid second identity",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  try {
    const dryRun = runMigration(workspaceRoot, backupRoot);
    assert.equal(dryRun.filesScanned, 1);
    assert.equal(dryRun.filesChanged, 1);
    assert.equal(dryRun.written, false);

    const written = runMigration(workspaceRoot, backupRoot, "--write");
    assert.equal(written.filesChanged, 1);
    assert.equal(written.written, true);

    const migrated = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    assert.match(migrated.messages[0].messageUid, /^sm_migrated_[a-f0-9]{32}$/);
    assert.equal("messageUid" in migrated.messages[1], false);
    assert.equal(migrated.messages[1].sourceMessageUid, "sm_source_2");
    assert.equal("messageUid" in migrated.messages[2], false);
    assert.equal(migrated.messages[2].sourceMessageUid, "sm_source_3");
    assert.equal(migrated.aggregateVersion, 3);
    assert.equal(fs.readFileSync(turnRecordFile, "utf8"), turnRecord);
    assert.equal(fs.readFileSync(summaryProjectionFile, "utf8"), summaryProjection);

    const converged = runMigration(workspaceRoot, path.join(temporaryRoot, "unused-backup"));
    assert.equal(converged.filesChanged, 0);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
