/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  TOOL_INPUT_OVERFLOW_CHARS,
  assertTransferProtocolOnly,
  buildSandboxRuntime,
  compactToolResultTextForModel,
  directInput,
  directOutput,
  extractTransferEnvelopeFromPersisted,
  fileOutput,
  firstTransferFile,
  isTransferEnvelope,
  materializeOutput,
  normalizeTransfer,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
  normalizeTransferReason,
  normalizeTransferSource,
  resolveTransferFilePath,
  resolveTransferIntent,
  resolveTransferPathView,
  transferSemanticContent,
} from "./helpers/semantic-transfer-helper.js";

test("resolveTransferFilePath follows sandbox/non-sandbox path view", () => {
  assert.equal(
    resolveTransferFilePath({
      runtime: buildSandboxRuntime(true),
      attachmentMeta: {
        path: "/host/users/primary-user/attachments/a.md",
        relativePath: "attachments/a.md",
      },
    }),
    "/workspace/primary-user/attachments/a.md",
  );
  assert.equal(
    resolveTransferFilePath({
      runtime: buildSandboxRuntime(false),
      attachmentMeta: {
        path: "/host/users/primary-user/attachments/a.md",
        relativePath: "attachments/a.md",
      },
    }),
    "attachments/a.md",
  );
  assert.equal(
    resolveTransferFilePath({ attachmentMeta: { relativePath: "attachments/a.md", name: "a.md" } }),
    "attachments/a.md",
  );
});
test("resolveTransferPathView keeps sandboxPath semantic separate from relative display fallback", () => {
  assert.deepEqual(
    resolveTransferPathView({ attachmentMeta: { relativePath: "attachments/a.md", name: "a.md" } }),
    {
      displayPath: "attachments/a.md",
      relativePath: "attachments/a.md",
    },
  );
  assert.equal(
    resolveTransferPathView({
      runtime: buildSandboxRuntime(true),
      attachmentMeta: {
        path: "/host/users/primary-user/attachments/a.md",
        relativePath: "attachments/a.md",
        name: "a.md",
      },
    }).sandboxPath,
    "/workspace/primary-user/attachments/a.md",
  );
  const nonSandboxView = resolveTransferPathView({
    runtime: buildSandboxRuntime(false),
    attachmentMeta: {
      path: "/host/users/primary-user/attachments/a.md",
      relativePath: "attachments/a.md",
      name: "a.md",
    },
  });
  assert.equal(nonSandboxView.displayPath, "attachments/a.md");
  assert.equal(nonSandboxView.sandboxPath, undefined);
});
test("resolveTransferFilePath tolerates resolver errors and keeps fallback behavior", () => {
  assert.equal(
    resolveTransferFilePath({
      runtime: {
        ...buildSandboxRuntime(true),
        sharedTools: {
          resolveAttachmentDisplayPath() {
            throw new Error("display resolver failed");
          },
          resolveSandboxPath() {
            return "/workspace/a.md";
          },
        },
      },
      attachmentMeta: {
        path: "/host/users/primary-user/attachments/a.md",
        relativePath: "attachments/a.md",
      },
    }),
    "/workspace/primary-user/attachments/a.md",
  );
});
test("persisted semantic-transfer file uses sandbox view when sandbox is enabled", async () => {
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      return payload.artifacts.map((artifact) => ({
        attachmentId: "att-sandbox-view",
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: 3,
        path: `/host/users/primary-user/attachments/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
  const runtime = buildSandboxRuntime(true, {
    systemRuntime: { userId: "primary-user", sessionId: "s1" },
    attachmentService,
    sharedTools: {
      resolveAttachmentDisplayPath({ hostPath = "", path = "" } = {}) {
        return String(hostPath || path || "").trim();
      },
    },
  });

  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_output",
    runtime,
    content: "abc",
    name: "sandbox-output.txt",
    mimeType: "text/plain",
    forceAttachment: true,
    source: "tool",
    reason: "tool_result_overflow",
  });

  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};
  assert.equal(file.filePath, "/workspace/primary-user/attachments/sandbox-output.txt");
  assert.equal(file.pathView?.displayPath, "/workspace/primary-user/attachments/sandbox-output.txt");
  assert.equal(file.pathView?.sandboxPath, "/workspace/primary-user/attachments/sandbox-output.txt");
  assert.equal(file.pathView?.hostPath, "/host/users/primary-user/attachments/sandbox-output.txt");
});
test("transferSemanticContent tool_input overflow returns sandbox path view when sandbox is enabled", async () => {
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      return payload.artifacts.map((artifact) => ({
        attachmentId: "tool-input-sandbox-view",
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: TOOL_INPUT_OVERFLOW_CHARS + 1,
        path: `/host/users/primary-user/attachments/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "write_file",
      args: {
        filePath: "large.txt",
        content: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1),
      },
    },
    runtime: buildSandboxRuntime(true, {
      systemRuntime: { userId: "primary-user", sessionId: "s-tool-input-sandbox" },
      attachmentService,
    }),
  });

  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};
  assert.equal(file.filePath, "/workspace/primary-user/attachments/large.txt.tool-input.txt");
  assert.equal(file.pathView?.displayPath, "/workspace/primary-user/attachments/large.txt.tool-input.txt");
  assert.equal(file.pathView?.sandboxPath, "/workspace/primary-user/attachments/large.txt.tool-input.txt");
  assert.equal(file.pathView?.hostPath, "/host/users/primary-user/attachments/large.txt.tool-input.txt");
  assertTransferProtocolOnly(assert, transferred);
});
test("transferSemanticContent sandbox view prefers default workspace over /project mount", async () => {
  const projectRoot = "/home/xiayu/projects/noobot";
  const basePath = `${projectRoot}/workspace/primary-user`;
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      return payload.artifacts.map((artifact) => ({
        attachmentId: "tool-input-default-workspace-view",
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: TOOL_INPUT_OVERFLOW_CHARS + 1,
        path: `${basePath}/runtime/ops_workdir/${artifact.name}`,
        relativePath: `runtime/ops_workdir/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "write_file",
      args: {
        filePath: "large_file_test.txt",
        content: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1),
      },
    },
    runtime: buildSandboxRuntime(true, {
      userId: "primary-user",
      basePath,
      systemRuntime: { userId: "primary-user", sessionId: "s-tool-input-default-workspace" },
      attachmentService,
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: {
                dockerContainerScope: "global",
                dockerMounts: [{ source: projectRoot, target: "/project" }],
              },
            },
          },
        },
      },
    }),
  });

  const expectedPath = "/workspace/primary-user/runtime/ops_workdir/large_file_test.txt.tool-input.txt";
  const wrongProjectPath = "/project/workspace/primary-user/runtime/ops_workdir/large_file_test.txt.tool-input.txt";
  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};
  assert.equal(file.filePath, expectedPath);
  assert.equal(file.pathView?.displayPath, expectedPath);
  assert.equal(file.pathView?.sandboxPath, expectedPath);
  assert.notEqual(file.filePath, wrongProjectPath);
  assertTransferProtocolOnly(assert, transferred);
});
test("transferSemanticContent tool_input overflow returns non-sandbox path view when sandbox is disabled", async () => {
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      return payload.artifacts.map((artifact) => ({
        attachmentId: "tool-input-non-sandbox-view",
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: TOOL_INPUT_OVERFLOW_CHARS + 1,
        path: `/host/users/primary-user/attachments/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "write_file",
      args: {
        filePath: "large.txt",
        content: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1),
      },
    },
    runtime: buildSandboxRuntime(false, {
      systemRuntime: { userId: "primary-user", sessionId: "s-tool-input-non-sandbox" },
      attachmentService,
    }),
  });

  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};
  assert.equal(file.filePath, "attachments/large.txt.tool-input.txt");
  assert.equal(file.pathView?.displayPath, "attachments/large.txt.tool-input.txt");
  assert.equal(file.pathView?.sandboxPath, undefined);
  assert.equal(file.pathView?.hostPath, "/host/users/primary-user/attachments/large.txt.tool-input.txt");
  assertTransferProtocolOnly(assert, transferred);
});
