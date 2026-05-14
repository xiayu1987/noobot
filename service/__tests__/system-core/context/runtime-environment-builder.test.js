import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeContext,
  initializeRuntimeEnvironment,
} from "../../../system-core/context/builders/runtime-environment-builder.js";

test("buildRuntimeContext keeps sharedTools passthrough and creates turn stores", () => {
  const runtime = buildRuntimeContext({
    userId: "u1",
    basePath: " /workspace/u1 ",
    runConfig: {
      sharedTools: {
        customFetch: true,
      },
    },
    attachmentMetas: [{ attachmentId: "att_1" }],
  });

  assert.equal(runtime.userId, "u1");
  assert.equal(runtime.basePath, "/workspace/u1");
  assert.equal(runtime.sharedTools.customFetch, true);
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
