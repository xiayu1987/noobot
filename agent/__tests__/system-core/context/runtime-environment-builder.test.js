import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeContext,
  initializeRuntimeEnvironment,
} from "../../../src/system-core/context/builders/runtime-environment-builder.js";

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
    attachmentMetas: [{ attachmentId: "att_1" }],
  });

  assert.equal(runtime.userId, "u1");
  assert.equal(runtime.basePath, "/workspace/u1");
  assert.equal(runtime.sharedTools.customFetch, true);
  assert.equal(runtime.hookManager, hookManager);
  assert.equal(runtime.hooks?.manager, hookManager);
  assert.equal(runtime.runConfig.streaming, false);
  assert.equal(typeof runtime.currentTurnMessages.push, "function");
  assert.equal(typeof runtime.currentTurnTasks.push, "function");
  assert.deepEqual(runtime.inputAttachmentMetas, [{ attachmentId: "att_1" }]);
  assert.deepEqual(runtime.attachmentMetas, []);
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
  const runtime = buildRuntimeContext({
    userId: "admin",
    basePath: "/home/xiayu/projects/noobot/workspace/admin",
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
          size: 200001,
          path: `/home/xiayu/projects/noobot/workspace/admin/runtime/ops_workdir/${artifact.name}`,
          relativePath: `runtime/ops_workdir/${artifact.name}`,
          generatedByModel: true,
          generationSource: payload.generationSource,
        }));
      },
    },
    systemRuntime: {
      userId: "admin",
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
        content: "x".repeat(200001),
      },
    },
  });
  const file = transferred?.transferEnvelopes?.[0]?.files?.[0] || {};

  assert.equal(
    file.filePath,
    "/workspace/admin/runtime/ops_workdir/large_file_test.txt.tool-input.txt",
  );
  assert.notEqual(
    file.filePath,
    "/project/workspace/admin/runtime/ops_workdir/large_file_test.txt.tool-input.txt",
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
