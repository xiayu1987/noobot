// Tests split by responsibility from session-repository-boundary.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../../src/system-core/session/index.js";
import { writeSessionArtifact } from "../../../src/system-core/session/session-artifact-store.js";
import { buildSessionDisplaySummary } from "../../../src/system-core/session/session-summary-builders.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "noobot-session-boundary-"),
  );
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("session display summary should keep canonical attachment fields", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-attachments",
    messages: [
      {
        role: "assistant",
        content: "canonical attachment",
        attachments: [{ attachmentId: "att-canonical", name: "canonical.txt", mimeType: "text/plain" }],
      },
      {
        role: "assistant",
        content: "legacy attachment ignored",
        attachments: [{ id: "att-legacy", name: "legacy.txt", type: "text/plain" }],
      },
    ],
  });

  assert.equal(summary.schemaVersion, 5);
  assert.equal(summary.messages[0].attachments[0].attachmentId, "att-canonical");
  assert.equal(summary.messages[0].attachments[0].name, "canonical.txt");
  assert.equal(summary.messages[1].attachments[0].attachmentId, "att-legacy");
  assert.equal(summary.stats.attachmentCount, 2);
});

test("session display summary keeps rich attachment fields for preview and parsed result", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-rich-attachments",
    messages: [
      {
        role: "user",
        content: "rich attachment",
        attachments: [
          {
            attachmentId: "att-rich",
            name: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 123,
            sessionId: "s-rich-attachments",
            attachmentSource: "user",
            path: "/workspace/report.docx",
            relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
            sandboxPath: "/sandbox/report.docx",
            previewUrl: "/api/attachments/att-rich/preview",
            downloadUrl: "/api/attachments/att-rich/download",
            parsedResult: {
              attachmentId: "att-parsed",
              name: "report.md",
              mimeType: "text/markdown",
              path: "/workspace/report.md",
              relativePath: "runtime/attach/s-rich-attachments/model/report.md",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(summary.messages[0].attachments[0], {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    attachmentSource: "user",
    sessionId: "s-rich-attachments",
    relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
    sandboxPath: "/sandbox/report.docx",
    path: "/workspace/report.docx",
    parsedResult: {
      attachmentId: "att-parsed",
      name: "report.md",
      path: "/workspace/report.md",
      relativePath: "runtime/attach/s-rich-attachments/model/report.md",
      mimeType: "text/markdown",
    },
    url: "/api/attachments/att-rich/download",
    previewUrl: "/api/attachments/att-rich/preview",
  });
});

test("session display summary derives attachments from transfer envelopes", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-transfer-attachments",
    messages: [
      {
        role: "assistant",
        content: "transfer only attachment",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: 1,
            direction: "output",
            transport: "file",
            files: [
              {
                role: "primary",
                filePath: "/workspace/result.md",
                attachmentMeta: {
                  attachmentId: "att-transfer-1",
                  sessionId: "s-transfer-attachments",
                  attachmentSource: "model",
                  name: "result.md",
                  mimeType: "text/markdown",
                  size: 44,
                  relativePath: "runtime/result.md",
                  owner: { type: "plugin", id: "harness-plugin" },
                },
                pathView: { sandboxPath: "/sandbox/result.md" },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(summary.stats.attachmentCount, 1);
  assert.deepEqual(summary.messages[0].attachments, [
    {
      attachmentId: "att-transfer-1",
      name: "result.md",
      mimeType: "text/markdown",
      size: 44,
      attachmentSource: "model",
      sessionId: "s-transfer-attachments",
      relativePath: "runtime/result.md",
      sandboxPath: "/sandbox/result.md",
      path: "/workspace/result.md",
      owner: { type: "plugin", id: "harness-plugin" },
      role: "primary",
    },
  ]);
  assert.equal("id" in summary.messages[0].attachments[0], false);
  assert.equal("type" in summary.messages[0].attachments[0], false);
  assert.equal("source" in summary.messages[0].attachments[0], false);
  assert.equal(summary.messages[0].transferEnvelopes[0].files[0].attachmentId, "att-transfer-1");
  assert.equal(summary.messages[0].transferEnvelopes[0].files[0].owner.type, "plugin");
  assert.equal("attachmentMeta" in summary.messages[0].transferEnvelopes[0].files[0], false);
  assert.equal("pathView" in summary.messages[0].transferEnvelopes[0].files[0], false);
});

test("session artifact persistence should normalize attachment fields before writing", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sessionDir = path.join(workspaceRoot, "u1", "runtime", "session", "s-attachments");
    const result = await writeSessionArtifact({
      sessionDir,
      depth: 1,
      now: () => "2026-05-14T00:00:00.000Z",
      sessionPayload: {
        sessionId: "s-attachments",
        caller: "user",
        messages: [
          {
            role: "user",
            content: "canonical survives",
            attachments: [
              {
                attachmentId: "att-canonical",
                name: "canonical.txt",
                mimeType: "text/plain",
              },
            ],
            attachmentMetas: [{ attachmentId: "att-legacy-meta" }],
            attachment_metas: [{ attachmentId: "att-legacy-snake" }],
          },
          {
            role: "assistant",
            content: "legacy only is ignored",
            attachmentMetas: [{ attachmentId: "att-legacy-only" }],
            attachment_metas: [{ attachmentId: "att-legacy-only-snake" }],
          },
        ],
      },
    });

    const persistedSession = JSON.parse(await readFile(result.files.session, "utf8"));
    const persistedSummary = JSON.parse(await readFile(result.files.sessionSummary, "utf8"));
    const sessionJson = JSON.stringify(persistedSession);
    const summaryJson = JSON.stringify(persistedSummary);

    assert.equal(persistedSession.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSession.messages[1], false);
    assert.equal(sessionJson.includes("attachmentMetas"), false);
    assert.equal(sessionJson.includes("attachment_metas"), false);
    assert.equal(persistedSummary.depth, 1);
    assert.equal(persistedSummary.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSummary.messages[1], false);
    assert.equal(summaryJson.includes("attachmentMetas"), false);
    assert.equal(summaryJson.includes("attachment_metas"), false);
  });
});



















