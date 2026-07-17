/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeContext,
  initializeRuntimeEnvironment,
} from "../../../src/system-core/context/builders/runtime-environment-builder.js";
import {
  buildSandboxViewStaticInfo,
  buildStaticInfo,
} from "../../../src/system-core/context/providers/environment-provider.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

test("buildRuntimeContext keeps sharedTools passthrough and creates turn stores", () => {
  const hookManager = { emit() {} };
  const runtime = buildRuntimeContext({
    userId: "u1",
    basePath: " /workspace/u1 ",
    runConfig: {
      streaming: false,
      sharedTools: {
        customFetch: true,
      },
      hookManager,
      hooks: {
        manager: hookManager,
      },
    },
    userMessageAttachments: [{ attachmentId: "att_1" }],
  });

  assert.equal(runtime.userId, "u1");
  assert.equal(runtime.basePath, "/workspace/u1");
  assert.equal(runtime.sharedTools.customFetch, true);
  assert.equal(runtime.hookManager, hookManager);
  assert.equal(runtime.hooks?.manager, hookManager);
  assert.equal(runtime.runConfig.streaming, false);
  assert.equal(typeof runtime.currentTurnMessages.push, "function");
  assert.equal(typeof runtime.currentTurnTasks.push, "function");
  assert.deepEqual(runtime.userMessageAttachments, [{ attachmentId: "att_1" }]);
  assert.deepEqual(runtime.attachments, []);
});

test("buildStaticInfo exposes host default directories", () => {
  const staticInfo = buildStaticInfo({
    runtimeBasePath: "/host/workspaces/u1",
    userId: "u1",
    globalConfig: { workspaceRoot: "/host/workspaces" },
  });

  assert.equal(staticInfo.directories?.view, "host");
  assert.equal(staticInfo.directories?.rootDirectory, "/host/workspaces/u1");
  assert.equal(staticInfo.directories?.opsWorkdir, "/host/workspaces/u1/runtime/ops_workdir");
  assert.equal(staticInfo.directories?.currentDirectory, process.cwd());
  assert.deepEqual(staticInfo.directories?.allowedRoots, ["/host/workspaces/u1"]);
});

test("buildSandboxViewStaticInfo exposes configured sandbox mount targets", () => {
  const staticInfo = buildSandboxViewStaticInfo({
    runtimeBasePath: "/host/workspaces/u1",
    userId: "u1",
    effectiveConfig: {
      tools: {
        sandboxPathMappings: [
          { source: "/host/project", target: "/repo" },
        ],
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: {
              dockerContainerScope: "user",
              dockerMounts: [
                { source: "/host/data", target: "/data" },
              ],
            },
          },
        },
      },
    },
  });

  assert.equal(staticInfo.sandbox?.enabled, true);
  assert.equal(staticInfo.directories?.view, "sandbox");
  assert.equal(staticInfo.directories?.rootDirectory, "/workspace");
  assert.equal(staticInfo.directories?.opsWorkdir, "/workspace/runtime/ops_workdir");
  assert.equal(staticInfo.directories?.currentDirectory, "/workspace/runtime/ops_workdir");
  assert.deepEqual(staticInfo.sandbox?.allowedRoots?.sort(), ["/data", "/repo", "/workspace"]);
  assert.deepEqual(staticInfo.sandbox?.extraMountTargets?.sort(), ["/data", "/repo"]);
});

test("buildSandboxViewStaticInfo separates sandbox root from user root for docker global scope", () => {
  const staticInfo = buildSandboxViewStaticInfo({
    runtimeBasePath: "/host/workspaces/primary-user",
    userId: "primary-user",
    effectiveConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: {
              dockerContainerScope: "global",
            },
          },
        },
      },
    },
  });

  assert.equal(staticInfo.sandbox?.sandboxRoot, "/workspace");
  assert.equal(staticInfo.directories?.rootDirectory, "/workspace/primary-user");
  assert.equal(staticInfo.directories?.opsWorkdir, "/workspace/primary-user/runtime/ops_workdir");
  assert.deepEqual(staticInfo.directories?.allowedRoots, ["/workspace"]);
});

test("initializeRuntimeEnvironment wires shared tools and connector runtime", async () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
    basePath: "/host/users/u1",
    globalConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: { dockerContainerScope: "global" },
          },
        },
      },
    },
    runConfig: {},
    systemRuntime: {
      sessionId: "s1",
      rootSessionId: "r1",
      dialogProcessId: "dp1",
      config: { allowUserInteraction: true },
    },
  });

  await initializeRuntimeEnvironment(runtime);

  assert.equal(typeof runtime.sharedTools.fetch, "function");
  assert.equal(typeof runtime.sharedTools.textCleaner?.cleanText, "function");
  assert.equal(typeof runtime.sharedTools.textCleaner?.cleanHtml, "function");
  assert.equal(typeof runtime.sharedTools.resolveAttachmentDisplayPath, "function");
  assert.equal(typeof runtime.sharedTools.resolveSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.resolveHostPath, "function");
  assert.equal(typeof runtime.sharedTools.toSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.toHostPath, "function");
  assert.equal(typeof runtime.sharedTools.pathMapper?.toSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.pathMapper?.toHostPath, "function");
  assert.equal(typeof runtime.sharedTools.semanticTransfer?.transferSemanticContent, "function");
  assert.equal(runtime.sharedTools.semanticTransfer?.transferSemanticContentSync, undefined);
  assert.equal(typeof runtime.sharedTools.sessionCrypto?.encryptBySessionId, "function");
  assert.equal(typeof runtime.sharedTools.sessionCrypto?.decryptBySessionId, "function");
  assert.equal(
    runtime.sharedTools.semanticTransfer?.compactToolResultTextForModel,
    undefined,
    "model-facing tool-result compaction must not be exposed as plugin/shared semantic-transfer API",
  );
  const encrypted = runtime.sharedTools.sessionCrypto.encryptBySessionId({ ok: true }, "s1");
  assert.deepEqual(runtime.sharedTools.sessionCrypto.decryptBySessionId(encrypted, "s1"), {
    ok: true,
  });
  assert.equal(
    runtime.sharedTools.resolveAttachmentDisplayPath({
      meta: {
        path: "/host/users/u1/runtime/a.md",
        relativePath: "runtime/a.md",
      },
    }),
    "/workspace/u1/runtime/a.md",
  );
  assert.equal(
    runtime.sharedTools.toHostPath({
      path: "/workspace/u1/runtime/a.md",
      sandboxPath: "/workspace/u1/runtime/a.md",
    }),
    "/host/users/u1/runtime/a.md",
  );

  assert.equal(typeof runtime.sharedTools.connectorEventListener?.onConnectorAccessed, "function");
  assert.ok(runtime.sharedTools.connectorChannelStore);
  assert.ok(runtime.sharedTools.connectorHistoryStore);
  assert.deepEqual(Object.keys(runtime.connectorChannels || {}).sort(), ["databases", "emails", "terminals"]);

  const hasBrowserOrInitError =
    runtime.sharedTools.browser ||
    (typeof runtime.sharedTools.browserInitError === "string" && runtime.sharedTools.browserInitError.length > 0);
  assert.equal(Boolean(hasBrowserOrInitError), true);

  if (runtime.sharedTools.browser && typeof runtime.sharedTools.browser.close === "function") {
    await runtime.sharedTools.browser.close().catch(() => {});
  }
});

test("initializeRuntimeEnvironment shared semantic-transfer keeps runtime basePath when caller passes partial runtime", async () => {
  const overflowContent = "x".repeat(
    LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars + 1,
  );
  const runtime = buildRuntimeContext({
    userId: "primary-user",
    basePath: "/home/xiayu/projects/noobot/workspace/primary-user",
    globalConfig: {
      tools: {
        execute_script: {
          sandboxMode: true,
          sandboxProvider: {
            default: "docker",
            docker: {
              dockerContainerScope: "global",
              dockerMounts: [
                { source: "/home/xiayu/projects/noobot", target: "/project" },
              ],
            },
          },
        },
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(payload) {
        return payload.artifacts.map((artifact) => ({
          attachmentId: "att-runtime-context-basepath",
          sessionId: payload.sessionId,
          attachmentSource: payload.attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: overflowContent.length,
          path: `/home/xiayu/projects/noobot/workspace/primary-user/runtime/ops_workdir/${artifact.name}`,
          relativePath: `runtime/ops_workdir/${artifact.name}`,
          generatedByModel: true,
          generationSource: payload.generationSource,
        }));
      },
    },
    systemRuntime: {
      userId: "primary-user",
      sessionId: "s1",
      rootSessionId: "r1",
      config: { allowUserInteraction: true },
    },
  });
  await initializeRuntimeEnvironment(runtime);

  const transferred = await runtime.sharedTools.semanticTransfer.transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    runtime: {},
    call: {
      name: "write_file",
      args: {
        filePath: "large_file_test.txt",
        content: overflowContent,
      },
    },
  });
  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};

  assert.equal(
    file.filePath,
    "/workspace/primary-user/runtime/ops_workdir/large_file_test.txt.tool-input.txt",
  );
  assert.notEqual(
    file.filePath,
    "/project/workspace/primary-user/runtime/ops_workdir/large_file_test.txt.tool-input.txt",
  );
});

test("initializeRuntimeEnvironment passes semantic-transfer strict envelope validation config", async () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
    globalConfig: {
      semanticTransfer: {
        strictEnvelopeValidation: true,
      },
    },
    systemRuntime: {
      sessionId: "s1",
      rootSessionId: "r1",
      config: { allowUserInteraction: false },
    },
  });
  await initializeRuntimeEnvironment(runtime);
  const semanticTransfer = runtime.sharedTools.semanticTransfer || {};
  assert.equal(typeof semanticTransfer.transferSemanticContent, "function");
  assert.equal(semanticTransfer.resolveStrictEnvelopeValidation, undefined);
  assert.equal(semanticTransfer.validateTransferEnvelope, undefined);
  assert.equal(semanticTransfer.normalizeTransferEnvelopesWithPolicy, undefined);
});

test("initializeRuntimeEnvironment wraps userInteractionBridge and decrypts encrypted response", async () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
    userInteractionBridge: {
      async requestUserInteraction() {
        return {
          encrypted: true,
          payload: "CBMcWlELB0MGVA4=",
        };
      },
    },
    systemRuntime: {
      sessionId: "s1",
      rootSessionId: "r1",
      config: { allowUserInteraction: true },
    },
  });

  await initializeRuntimeEnvironment(runtime);

  const response = await runtime.userInteractionBridge.requestUserInteraction({
    requireEncryption: true,
    sessionId: "s1",
  });
  assert.deepEqual(response, { ok: true });
});

test("initializeRuntimeEnvironment encrypted response invalid should throw", async () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
    userInteractionBridge: {
      async requestUserInteraction() {
        return {
          encrypted: false,
          payload: "",
        };
      },
    },
    systemRuntime: {
      sessionId: "s1",
      rootSessionId: "r1",
      config: { allowUserInteraction: true },
    },
  });

  await initializeRuntimeEnvironment(runtime);

  await assert.rejects(
    () =>
      runtime.userInteractionBridge.requestUserInteraction({
        requireEncryption: true,
        sessionId: "s1",
      }),
    (error) =>
      error &&
      typeof error.message === "string" &&
      error.message.includes("encrypted interaction response required"),
  );
});
