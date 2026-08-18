/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationScript = path.join(repositoryRoot, "scripts/migrate-attachment-record-v1.mjs");

test("migrates historical attachment indexes only through the explicit V1 migration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-attachment-v1-"));
  const workspace = path.join(root, "workspace");
  const backup = path.join(root, "backup");
  const indexFile = path.join(
    workspace,
    "admin/runtime/attach/scoped/session-1/user/attachments.json",
  );
  const modelIndexFile = path.join(
    workspace,
    "admin/runtime/attach/scoped/session-1/model/attachments.json",
  );
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.writeFileSync(
    indexFile,
    JSON.stringify(
      {
        updatedAt: "2026-08-01T00:00:00.000Z",
        sessionId: "session-1",
        attachmentSource: "user",
        attachments: {
          "att-1": {
            attachmentId: "att-1",
            sessionId: "session-1",
            attachmentSource: "user",
            name: "report.pdf",
            mimeType: "application/pdf",
            size: 42,
            relativePath: "runtime/attach/scoped/session-1/user/att-1.pdf",
            createdAt: "2026-08-01T00:00:00.000Z",
            parsedResult: {
              attachmentId: "parsed-1",
              name: "report.md",
              mimeType: "text/markdown",
              relativePath: "runtime/attach/scoped/session-1/model/parsed-1.md",
              tool: "multimodal_parse",
              updatedAt: "2026-08-01T00:01:00.000Z",
            },
          },
        },
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.dirname(modelIndexFile), { recursive: true });
  fs.writeFileSync(
    modelIndexFile,
    JSON.stringify(
      {
        updatedAt: "2026-08-01T00:01:00.000Z",
        sessionId: "session-1",
        attachmentSource: "model",
        attachments: {
          "parsed-1": {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
            name: "report.md",
            mimeType: "text/markdown",
            relativePath: "runtime/attach/scoped/session-1/model/parsed-1.md",
            createdAt: "2026-08-01T00:01:00.000Z",
          },
        },
      },
      null,
      2,
    ),
  );

  const dryRun = JSON.parse(
    execFileSync(process.execPath, [migrationScript, `--workspace=${workspace}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  assert.equal(dryRun.filesChanged, 2);
  assert.equal(dryRun.written, false);

  execFileSync(
    process.execPath,
    [migrationScript, `--workspace=${workspace}`, "--write", `--backup=${backup}`],
    { cwd: repositoryRoot },
  );
  const migrated = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const record = migrated.attachments["att-1"];
  assert.equal(record.schema, "noobot.attachment-record");
  assert.equal(record.version, 1);
  assert.equal(record.relations[0].sourceIdentity.attachmentId, "att-1");
  assert.equal(record.relations[0].targetIdentity.attachmentId, "parsed-1");
  assert.equal(record.relations[0].targetIdentity.attachmentSource, "model");
  assert.equal(
    fs.existsSync(path.join(backup, "admin/runtime/attach/scoped/session-1/user/attachments.json")),
    true,
  );
  fs.rmSync(root, { recursive: true, force: true });
});
