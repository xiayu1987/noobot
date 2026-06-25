import test from "node:test";
import assert from "node:assert/strict";

import { ModelMessageRuntimeHelpers } from "../../../src/system-core/bot-manage/session/model-message-runtime-helpers.js";

test("ModelMessageRuntimeHelpers deep-merges selected plugin option objects", () => {
  const helpers = new ModelMessageRuntimeHelpers();

  const merged = helpers.mergePluginOptions(
    {
      stepModels: { plan: "m1" },
      capabilityModelByPurpose: { review: "m2" },
      acceptance: { enabled: true },
      nestedReplace: { a: 1 },
      scalar: "a",
    },
    {
      stepModels: { execute: "m3" },
      capabilityModelByPurpose: { plan: "m4" },
      acceptance: { threshold: 2 },
      nestedReplace: { b: 2 },
      scalar: "b",
    },
  );

  assert.deepEqual(merged.stepModels, { plan: "m1", execute: "m3" });
  assert.deepEqual(merged.capabilityModelByPurpose, { review: "m2", plan: "m4" });
  assert.deepEqual(merged.acceptance, { enabled: true, threshold: 2 });
  assert.deepEqual(merged.nestedReplace, { b: 2 });
  assert.equal(merged.scalar, "b");
});

test("ModelMessageRuntimeHelpers resolveModelMessages uses main-flow blocks", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    ctx: {
      messageBlocks: {
        system: [{ role: "system", content: "sys" }],
        history: [
          { role: "user", content: "old-u", dialogProcessId: "d1" },
          { role: "assistant", content: "old-a", dialogProcessId: "d1" },
          { role: "user", content: "new-u", dialogProcessId: "d2" },
          { role: "assistant", content: "new-a", dialogProcessId: "d2" },
        ],
        incremental: [
          { role: "user", content: "inc-u", dialogProcessId: "d3" },
          { role: "assistant", content: "drop", summarized: true, dialogProcessId: "d3" },
          { role: "assistant", content: "inc-a", dialogProcessId: "d3" },
        ],
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "old-u", "old-a", "new-u", "new-a", "inc-u", "inc-a"],
  );
});

test("ModelMessageRuntimeHelpers does not clip non-main model context by default", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 20 },
  });

  const resolved = resolver({
    messages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
      dialogProcessId: "dlg-1",
    })),
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "dlg-1",
        },
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    Array.from({ length: 22 }, (_, index) => `m${index + 1}`),
  );
});

test("ModelMessageRuntimeHelpers clips non-main model context only when explicitly enabled", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages({
    agentPluginOptions: {
      clipNonMainModelContextMessages: true,
      contextWindowRecentMessageLimit: 20,
    },
  });

  const resolved = resolver({
    messages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
      dialogProcessId: "dlg-1",
    })),
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "dlg-1",
        },
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    Array.from({ length: 20 }, (_, index) => `m${index + 3}`),
  );
});

test("ModelMessageRuntimeHelpers resolveModelMessages filters stale injected dialog messages", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();

  const resolved = resolver({
    messages: [
      {
        role: "user",
        content: "old-injected",
        injectedMessage: true,
        injectedBy: "agentPlugin",
        dialogProcessId: "old",
      },
      {
        role: "user",
        content: "new-injected",
        injectedMessage: true,
        injectedBy: "agentPlugin",
        dialogProcessId: "new",
      },
      { role: "assistant", content: "normal", dialogProcessId: "new" },
    ],
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "new",
        },
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["new-injected", "normal"],
  );
});

test("ModelMessageRuntimeHelpers resolveMessageBlock supports system/incremental/history scopes", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveMessageBlock();
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "old-injected", injectedMessage: true, injectedBy: "agentPlugin", dialogProcessId: "old" },
    { role: "user", content: "new-injected", injectedMessage: true, injectedBy: "agentPlugin", dialogProcessId: "new" },
    { role: "assistant", content: "new-normal", dialogProcessId: "new" },
    { role: "assistant", content: "summarized", summarized: true, dialogProcessId: "new" },
  ];

  const system = resolver({ scope: "system", messages: [{ role: "system", content: "sys" }] });
  const incremental = resolver({
    scope: "incremental",
    messages,
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "new",
        },
      },
    },
  });
  const history = resolver({ scope: "history", messages });

  assert.deepEqual(system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(
    incremental.map((item = {}) => item.content),
    ["sys", "new-injected", "new-normal"],
  );
  assert.deepEqual(
    history.map((item = {}) => item.content),
    ["new-injected", "new-normal"],
  );
});

test("ModelMessageRuntimeHelpers markMessagesSummarized supports scoped in-memory marking", async () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const markMessagesSummarized = helpers.createMarkMessagesSummarized();
  const messages = [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
    { role: "assistant", content: "", tool_calls: [{ id: "c2", function: { name: "execute_script" } }] },
    { role: "tool", content: '{"toolName":"execute_script","ok":true}' },
  ];

  const marked = await markMessagesSummarized({
    messages,
    summaryScope: {
      maxMessages: 2,
      limitToProvidedMessagesOnly: true,
    },
  });

  assert.equal(marked, 2);
  assert.equal(messages[0].summarized, true);
  assert.equal(messages[1].summarized, true);
  assert.equal(messages[2].summarized, undefined);
  assert.equal(messages[3].summarized, undefined);
});

test("ModelMessageRuntimeHelpers markMessagesSummarized can persist session marking", async () => {
  let capturedPayload = null;
  const helpers = new ModelMessageRuntimeHelpers({
    session: {
      async markSessionMessagesSummarized(payload = {}) {
        capturedPayload = payload;
        return 7;
      },
    },
  });
  const markMessagesSummarized = helpers.createMarkMessagesSummarized();

  const marked = await markMessagesSummarized({
    messages: [],
    ctx: {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "p1",
    },
  });

  assert.equal(marked, 7);
  assert.equal(capturedPayload.userId, "u1");
  assert.equal(capturedPayload.sessionId, "s1");
  assert.equal(capturedPayload.parentSessionId, "p1");
  assert.equal(typeof capturedPayload.shouldMark, "function");
});
