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
  assert.deepEqual(runtime.attachmentMetas, [{ attachmentId: "att_1" }]);
});

test("initializeRuntimeEnvironment wires shared tools and connector runtime", async () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
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
  assert.equal(typeof runtime.sharedTools.resolveSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.toSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.pathMapper?.toSandboxPath, "function");
  assert.equal(typeof runtime.sharedTools.sessionCrypto?.encryptBySessionId, "function");
  assert.equal(typeof runtime.sharedTools.sessionCrypto?.decryptBySessionId, "function");
  const encrypted = runtime.sharedTools.sessionCrypto.encryptBySessionId({ ok: true }, "s1");
  assert.deepEqual(runtime.sharedTools.sessionCrypto.decryptBySessionId(encrypted, "s1"), {
    ok: true,
  });

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
