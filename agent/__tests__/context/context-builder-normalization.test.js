/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ContextBuilder } from "../../src/context/index.js";
import { buildSystemRuntime } from "../../src/context/application/build-system-context.js";
import { buildContextMessageBlocks } from "../../src/context/assembly/message-builder.js";
import { createPersistedCurrentUserMessage } from "../runtime/core/message-builder-current-user-fixture.js";
import { createTestBotManager, testHeadlessStartupContext } from "../helpers/test-bot-manager.js";
import { TEST_RUNTIME_IDENTITY } from "../helpers/test-runtime-context.js";
import { TEST_RUN_PREFERENCES } from "../helpers/run-preferences.js";

function systemRuntimeIdentity(overrides) {
  return { ...TEST_RUNTIME_IDENTITY, ...overrides };
}

function attachmentRuntimeIdentity(dialogProcessId, overrides) {
  return systemRuntimeIdentity({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId,
    turnScopeId: "turn-1",
    ...overrides,
  });
}

function createContextSessionManager() {
  return {
    async getRootSessionId({ sessionId }) {
      return sessionId;
    },
    async getContextProjection() {
      return { scope: {}, messages: [] };
    },
  };
}

function executionRunConfig(turnScopeId, extra = {}) {
  return {
    ...TEST_RUN_PREFERENCES,
    hookManager: null,
    executionId: `run:${turnScopeId}`,
    presentationMessageId: `message:${turnScopeId}`,
    ...extra,
  };
}

function createBuilderForAttachmentRuntimeTest({
  userMessageAttachments,
  promptSections,
  runtimeAttachments,
  eventListener,
  botManager,
  selectedConnectorIds,
  userInteractionBridge,
  persistenceScope,
  runtimeIdentity,
}) {
  return new ContextBuilder({
    config: {
      globalConfig: {
        workspaceRoot: "/tmp/noobot-test-workspace",
      },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: createContextSessionManager(),
      memoryService: null,
      attachmentService: {
        async ingest() {
          return [];
        },
      },
      skillService: null,
      eventListener,
      botManager,
      userInteractionBridge,
      errorLogger: null,
    },
    sessionContext: {
      abortSignal: new AbortController().signal,
      runtimeIdentity,
      userMessageAttachments,
      runConfig: executionRunConfig("turn-1", {
        contextPolicy: {
          promptSections,
          runtimeCapabilities: { attachments: runtimeAttachments },
        },
        selectedConnectorIds,
      }),
      persistenceScope,
      systemMessages: [],
    },
  });
}

test("ContextBuilder binds Session persistence authority before constructing tools", async () => {
  const requests = [];
  const persistenceScope = {
    scopeId: "agent:turn-child",
    parentSessionId: "root-session",
    relativeDir: "runtime/agent/session/s1",
    allowedRoot: "runtime/agent/session",
  };
  const builder = createBuilderForAttachmentRuntimeTest({
    runtimeIdentity: attachmentRuntimeIdentity("dp-child", { parentSessionId: "root-session" }),
    persistenceScope,
    userInteractionBridge: {
      async requestUserInteraction(payload) {
        requests.push(payload);
        return { confirmed: true, verificationCode: "ok" };
      },
    },
    userMessageAttachments: [],
    promptSections: [],
    runtimeAttachments: true,
    eventListener: null,
    botManager: createTestBotManager(),
    selectedConnectorIds: [],
  });

  const executionScope = await builder.buildNewSessionContext();
  const tool = executionScope.bindings.tools.find((item) => item.name === "user_interaction");
  assert.ok(tool);
  await tool.invoke({
    content: "child interaction",
    fields: { fields: [] },
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].authority.persistenceScope, {
    scopeId: "agent:turn-child",
    parentSessionId: "root-session",
    relativeDir: "runtime/agent/session/s1",
    allowedRoot: "runtime/agent/session",
  });
});

test("buildNewSessionContext always projects explicitly selected connectors", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    runtimeIdentity: attachmentRuntimeIdentity("dp-connectors", { parentSessionId: "" }),
    promptSections: ["base_prompt", "system_runtime"],
    selectedConnectorIds: ["con_db"],
    botManager: createTestBotManager({
      connectorAccessPort: {
        async access() {
          return { ok: true };
        },
        async listUserConnectors() {
          return [
            {
              connectorId: "con_db",
              ownerUserId: "u1",
              name: "primary",
              instanceType: "builtin.database.mysql",
              status: "connected",
            },
          ];
        },
      },
    }),
    userMessageAttachments: [],
    runtimeAttachments: true,
    eventListener: null,
    userInteractionBridge: null,
    persistenceScope: null,
  });

  const context = await builder.buildNewSessionContext();
  const systemText = context.context.modelContext.messageBlocks.system.join("\n");
  assert.equal(systemText.includes('"connector_id": "con_db"'), true);
  assert.equal(systemText.includes('"connector_name": "primary"'), true);
});

test("buildNewSessionContext emits the default agent context debug structure", async () => {
  const events = [];
  const builder = createBuilderForAttachmentRuntimeTest({
    runtimeIdentity: attachmentRuntimeIdentity("dp-debug", { parentSessionId: "" }),
    promptSections: ["base_prompt", "system_runtime", "scenario"],
    eventListener: {
      onEvent(event = {}) {
        events.push(event);
      },
    },
    userMessageAttachments: [],
    runtimeAttachments: true,
    botManager: createTestBotManager(),
    selectedConnectorIds: [],
    userInteractionBridge: null,
    persistenceScope: null,
  });

  await builder.buildNewSessionContext();

  const event = events.find((item = {}) => item.event === "agent.context.executionScopeCreated");
  assert.ok(event);
  assert.equal(Object.hasOwn(event.data, "debugType"), false);
  assert.equal(event.data.sessionId, "s1");
  assert.equal(event.data.dialogProcessId, "dp-debug");
  assert.equal(event.data.turnScopeId, "turn-1");
  assert.equal(event.data.envelope.kind, "noobot.agent-context");
  assert.equal(event.data.envelope.protocolVersion, 1);
  assert.equal(Array.isArray(event.data.bindings.toolNames), true);
  assert.equal(JSON.stringify(event.data).includes("abortSignal"), false);
});

test("buildNewSessionContext binds userMessageAttachments into runtime", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    runtimeIdentity: attachmentRuntimeIdentity("dp_1", { parentSessionId: "" }),
    userMessageAttachments: [
      {
        attachmentId: "att_input",
        sessionId: "s1",
        attachmentSource: "user",
        name: "input.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/input.png",
      },
    ],
    promptSections: ["base_prompt", "system_runtime", "scenario"],
    runtimeAttachments: true,
    eventListener: null,
    botManager: createTestBotManager(),
    selectedConnectorIds: [],
    userInteractionBridge: null,
    persistenceScope: null,
  });

  const context = await builder.buildNewSessionContext();
  assert.equal(context?.bindings?.runtime?.userMessageAttachments?.[0]?.attachmentId, "att_input");
  assert.deepEqual(context?.bindings?.runtime?.attachments, []);
});

test("buildNewSessionContext marks normalized superAdmin user as super user", async () => {
  const configuredSuperUserId = "xiayu-owner";
  const builder = new ContextBuilder({
    config: {
      globalConfig: {
        workspaceRoot: "/tmp/noobot-test-workspace",
        superAdmin: { userId: configuredSuperUserId },
      },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: createContextSessionManager(),
      memoryService: null,
      attachmentService: {
        async ingest() {
          return [];
        },
      },
      skillService: null,
      eventListener: null,
      botManager: createTestBotManager(),
      userInteractionBridge: null,
      errorLogger: null,
    },
    sessionContext: {
      abortSignal: new AbortController().signal,
      runtimeIdentity: systemRuntimeIdentity({
        userId: configuredSuperUserId,
        sessionId: "s1",
        dialogProcessId: "dp_1",
        turnScopeId: "turn-1",
      }),
      runConfig: executionRunConfig("turn-1", {
        contextPolicy: {
          promptSections: ["base_prompt", "system_runtime", "scenario"],
        },
      }),
      persistenceScope: null,
      userMessageAttachments: [],
      systemMessages: [],
    },
  });

  const context = await builder.buildNewSessionContext();
  assert.equal(context?.bindings?.runtime?.systemRuntime?.isSuperUser, true);
  assert.equal(context?.context?.environment?.permissions?.isSuperUser, true);
  assert.equal(
    context.context.modelContext.messageBlocks.system.join("\n").includes('"isSuperUser": true'),
    true,
  );
  assert.equal(
    context.context.modelContext.messageBlocks.system
      .join("\n")
      .includes('"allowedRoots": [\n      "<host-filesystem>"'),
    true,
  );
});

test("buildNewSessionContext keeps turn identity in runtime but excludes it from system text", async () => {
  const builder = new ContextBuilder({
    config: { globalConfig: { workspaceRoot: "/tmp/noobot-test-workspace" }, userConfig: {} },
    serviceContainer: {
      sessionManager: createContextSessionManager(),
      memoryService: null,
      attachmentService: {
        async ingest() {
          throw new Error("fixture has no raw attachments");
        },
      },
      skillService: null,
      eventListener: null,
      botManager: createTestBotManager(),
      userInteractionBridge: null,
      errorLogger: null,
    },
    sessionContext: {
      abortSignal: new AbortController().signal,
      runtimeIdentity: systemRuntimeIdentity({
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dialog-runtime-only",
        turnScopeId: "turn-runtime-only",
      }),
      userMessageAttachments: [],
      runConfig: executionRunConfig("turn-runtime-only"),
      persistenceScope: null,
      systemMessages: [],
    },
  });

  const context = await builder.buildNewSessionContext();
  const runtime = context.bindings.runtime.systemRuntime;
  const systemText = context.context.modelContext.messageBlocks.system.join("\n");

  assert.equal(runtime.dialogProcessId, "dialog-runtime-only");
  assert.equal(runtime.turnScopeId, "turn-runtime-only");
  assert.equal(systemText.includes("dialogProcessId"), false);
  assert.equal(systemText.includes("turnScopeId"), false);
  assert.equal(systemText.includes("dialog-runtime-only"), false);
  assert.equal(systemText.includes("turn-runtime-only"), false);
});

test("buildNewSessionContext keeps super user identity in system message when system_runtime is excluded", async () => {
  const configuredSuperUserId = "system-owner";
  const builder = new ContextBuilder({
    config: {
      globalConfig: {
        workspaceRoot: "/tmp/noobot-test-workspace",
        superAdmin: { userId: configuredSuperUserId },
      },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: createContextSessionManager(),
      memoryService: null,
      attachmentService: {
        async ingest() {
          return [];
        },
      },
      skillService: null,
      eventListener: null,
      botManager: createTestBotManager(),
      userInteractionBridge: null,
      errorLogger: null,
    },
    sessionContext: {
      abortSignal: new AbortController().signal,
      runtimeIdentity: systemRuntimeIdentity({
        userId: configuredSuperUserId,
        sessionId: "s1",
        dialogProcessId: "dp_1",
        turnScopeId: "turn-1",
      }),
      runConfig: executionRunConfig("turn-1", {
        contextPolicy: {
          promptSections: ["base_prompt"],
        },
      }),
      persistenceScope: null,
      userMessageAttachments: [],
      systemMessages: [],
    },
  });

  const context = await builder.buildNewSessionContext();
  const systemText = context.context.modelContext.messageBlocks.system.join("\n");
  assert.equal(context?.context?.environment?.permissions?.isSuperUser, true);
  assert.equal(systemText.includes('"identity"'), true);
  assert.equal(systemText.includes('"isSuperUser": true'), true);
});

test("buildContextMessageBlocks prefers runtime userMessageAttachments for user meta", () => {
  const blocks = buildContextMessageBlocks(
    {
      context: {
        identity: { dialogProcessId: "dp1", turnScopeId: "turn-1" },
        modelContext: {
          messageBlocks: { system: [], history: [], incremental: [] },
        },
      },
      bindings: {
        tools: [],
        runtime: {
          userId: "u1",
          userMessageAttachments: [
            {
              attachmentId: "att_input",
              sessionId: "s1",
              attachmentSource: "user",
              name: "input.png",
            },
          ],
          attachments: [
            {
              attachmentId: "att_legacy",
              sessionId: "s1",
              attachmentSource: "model",
              name: "legacy.png",
            },
          ],
          systemRuntime: { sessionId: "s1", dialogProcessId: "dp1", turnScopeId: "turn-1" },
        },
      },
    },
    {
      currentUserMessage: createPersistedCurrentUserMessage("hello", {
        dialogProcessId: "dp1",
        turnScopeId: "turn-1",
        attachments: [
          {
            attachmentId: "att_input",
            sessionId: "s1",
            attachmentSource: "user",
            name: "input.png",
          },
        ],
      }),
    },
  );
  const metaMessage = blocks.incremental.find(
    (item) => item?.additional_kwargs?.noobotInternalMessageType === "user_meta",
  );
  assert.ok(metaMessage);
  assert.equal(String(metaMessage.content || "").includes("att_input"), true);
  assert.equal(String(metaMessage.content || "").includes("att_legacy"), false);
});

test("buildNewSessionContext keeps user message attachments separate from runtime generated attachments when attachments section is excluded", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    runtimeIdentity: attachmentRuntimeIdentity("dp_1", { parentSessionId: "" }),
    userMessageAttachments: [
      {
        attachmentId: "att_1",
        sessionId: "s1",
        attachmentSource: "user",
        name: "image.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/att_1.png",
      },
    ],
    promptSections: ["base_prompt", "system_runtime", "scenario"],
    runtimeAttachments: true,
    eventListener: null,
    botManager: createTestBotManager(),
    selectedConnectorIds: [],
    userInteractionBridge: null,
    persistenceScope: null,
  });

  const context = await builder.buildNewSessionContext();
  const runtime = context?.bindings?.runtime || {};
  assert.equal(Array.isArray(runtime.userMessageAttachments), true);
  assert.equal(runtime.userMessageAttachments.length, 1);
  assert.equal(runtime.userMessageAttachments[0]?.attachmentId, "att_1");
  assert.deepEqual(runtime.attachments, []);
});

test("buildNewSessionContext resolves session history and passes edited turnScopeId", async () => {
  const calls = [];
  const builder = new ContextBuilder({
    config: {
      globalConfig: { workspaceRoot: "/tmp/noobot-test-workspace" },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: {
        async getRootSessionId({ sessionId }) {
          return sessionId;
        },
        async getContextProjection(payload = {}) {
          calls.push(payload);
          return {
            messages: [
              {
                messageUid: "history-user",
                role: "user",
                content: "history user",
                dialogProcessId: "history-dp",
                turnScopeId: "client-turn:old",
              },
              {
                messageUid: "history-assistant",
                role: "assistant",
                content: "history assistant",
                dialogProcessId: "history-dp",
                turnScopeId: "client-turn:old",
              },
            ],
          };
        },
      },
      memoryService: null,
      attachmentService: {
        async ingest() {
          return [];
        },
      },
      skillService: null,
      eventListener: null,
      botManager: createTestBotManager(),
      userInteractionBridge: null,
      errorLogger: null,
    },
    sessionContext: {
      abortSignal: new AbortController().signal,
      runtimeIdentity: systemRuntimeIdentity({
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dp-current",
        turnScopeId: "client-turn:edited",
      }),
      runConfig: executionRunConfig("client-turn:edited", {
        contextPolicy: { promptSections: ["base_prompt", "system_runtime"] },
      }),
      persistenceScope: null,
      userMessageAttachments: [],
      systemMessages: [],
    },
  });

  const context = await builder.buildNewSessionContext();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.currentDialogProcessId, "dp-current");
  assert.equal(calls[0]?.currentTurnScopeId, "client-turn:edited");
  assert.deepEqual(
    context.context.modelContext.messageBlocks.history.map((item) => item.content),
    ["history user", "history assistant"],
  );
  assert.equal(context.context.modelContext.messageBlocks.system.length > 0, true);
});

test("buildSystemRuntime projects the explicit isSuperUser identity fact", () => {
  const runtime = buildSystemRuntime({
    identity: systemRuntimeIdentity({ userId: "super-root-user", dialogProcessId: "dp-super" }),
    botManager: createTestBotManager(),
    isSuperUser: true,
    runConfig: { ...TEST_RUN_PREFERENCES },
  });

  assert.equal(runtime.isSuperUser, true);
});

test("buildSystemRuntime injects redacted desktop dependency source summary", () => {
  const sourceSummary = {
    platform: "darwin",
    dependencies: [
      {
        key: "ffmpeg",
        name: "FFmpeg",
        available: true,
        installMode: "managed",
        sourceType: "self-hosted",
        hasCustomSource: true,
        customSourceEnvKeys: ["NOOBOT_FFMPEG_MAC_URL"],
        configKeys: ["darwinManaged.url"],
      },
    ],
  };
  const runtime = buildSystemRuntime({
    identity: systemRuntimeIdentity({ userId: "u1", sessionId: "s1", dialogProcessId: "dp-deps" }),
    isSuperUser: false,
    runConfig: { ...TEST_RUN_PREFERENCES },
    botManager: {
      startupContext: {
        ...testHeadlessStartupContext,
        runtime: {
          ...testHeadlessStartupContext.runtime,
          dependencies: {
            hasPlaywrightChromium: false,
            hasFfmpeg: true,
            hasFfprobe: false,
            hasLibreOffice: false,
            ffmpegPath: "/managed/bin/ffmpeg",
            ffprobePath: "",
            libreOfficePath: "",
            playwrightChromiumPath: "",
            pathPrefix: "",
            sourceSummary,
          },
        },
      },
    },
  });

  assert.deepEqual(runtime.desktopDependencySources, sourceSummary);
  assert.equal(JSON.stringify(runtime.desktopDependencySources).includes("http"), false);
});

test("buildSystemRuntime requires an explicit boolean isSuperUser", () => {
  assert.throws(
    () =>
      buildSystemRuntime({
        identity: systemRuntimeIdentity({
          userId: "super-root-user",
          dialogProcessId: "dp-regular",
        }),
        botManager: createTestBotManager(),
      }),
    /requires boolean isSuperUser/,
  );
});

test("buildSystemRuntime ignores runConfig identity overrides", () => {
  const runtime = buildSystemRuntime({
    identity: systemRuntimeIdentity({ userId: "regular-user", dialogProcessId: "dp-guard" }),
    botManager: createTestBotManager(),
    isSuperUser: false,
    runConfig: {
      ...TEST_RUN_PREFERENCES,
      systemRuntimePatch: { isSuperUser: true, userId: "super-root-user" },
    },
  });

  assert.equal(runtime.isSuperUser, false);
  assert.equal(runtime.userId, "regular-user");
});

function createBuilderForLongMemoryTest(
  readLongMemoryCalls,
  {
    readLongMemory = async () => "remembered-long-memory",
    errorLogs = [],
    events = [],
    abortSignal = new AbortController().signal,
  } = {},
) {
  return new ContextBuilder({
    config: {
      globalConfig: { workspaceRoot: "/tmp/noobot-test-workspace" },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: createContextSessionManager(),
      memoryService: {
        async readLongMemory(payload = {}) {
          readLongMemoryCalls.push(payload);
          return readLongMemory(payload);
        },
      },
      errorLogger: {
        async log(entry) {
          errorLogs.push(entry);
        },
      },
      attachmentService: {
        async ingest() {
          return [];
        },
      },
      skillService: null,
      eventListener: { onEvent: (event) => events.push(event) },
      botManager: createTestBotManager(),
      userInteractionBridge: null,
    },
    sessionContext: {
      runtimeIdentity: systemRuntimeIdentity({
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dp-long-memory",
        turnScopeId: "client-turn:long-memory",
      }),
      runConfig: executionRunConfig("client-turn:long-memory", {
        contextPolicy: { promptSections: ["base_prompt", "long_memory"] },
      }),
      abortSignal,
      persistenceScope: null,
      userMessageAttachments: [],
      systemMessages: [],
    },
  });
}

test("buildNewSessionContext resolves user level long memory on the first turn", async () => {
  const readLongMemoryCalls = [];
  const builder = createBuilderForLongMemoryTest(readLongMemoryCalls);

  const context = await builder.buildNewSessionContext();

  assert.deepEqual(readLongMemoryCalls, [{ userId: "u1" }]);
  assert.equal(
    context.context.modelContext.messageBlocks.system.some((item) =>
      String(item || "").includes("remembered-long-memory"),
    ),
    true,
  );
});

test("buildExistingSessionContext resolves the same long memory as a new session", async () => {
  const newSessionCalls = [];
  const existingSessionCalls = [];
  const newSessionContext =
    await createBuilderForLongMemoryTest(newSessionCalls).buildNewSessionContext();
  const existingSessionContext =
    await createBuilderForLongMemoryTest(existingSessionCalls).buildExistingSessionContext();

  assert.deepEqual(existingSessionCalls, newSessionCalls);
  assert.deepEqual(
    existingSessionContext.context.modelContext.messageBlocks.system,
    newSessionContext.context.modelContext.messageBlocks.system,
  );
});

test("a long memory read failure is recorded and the turn continues without long memory", async () => {
  const errorLogs = [];
  const events = [];
  const failure = Object.assign(new Error("memory document must start with NOOBOT_LONG_MEMORY/1"), {
    code: "MEMORY_DOCUMENT_HEADER_INVALID",
  });
  const context = await createBuilderForLongMemoryTest([], {
    readLongMemory: async () => {
      throw failure;
    },
    errorLogs,
    events,
  }).buildNewSessionContext();

  assert.deepEqual(
    errorLogs.map((entry) => [entry.event, entry.error, entry.extra.stage]),
    [["memory_injection_failed", failure, "long_memory"]],
  );
  assert.equal(
    context.context.modelContext.messageBlocks.system.some((item) =>
      String(item || "").includes("remembered-long-memory"),
    ),
    false,
  );
});

test("an aborted long memory read is rethrown and not recorded", async () => {
  const controller = new AbortController();
  controller.abort();
  const errorLogs = [];
  await assert.rejects(
    createBuilderForLongMemoryTest([], {
      readLongMemory: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      errorLogs,
      abortSignal: controller.signal,
    }).buildNewSessionContext(),
    { name: "AbortError" },
  );
  assert.deepEqual(errorLogs, []);
});

test("a builder with memoryService requires an error logger", () => {
  assert.throws(
    () =>
      new ContextBuilder({
        config: { globalConfig: {}, userConfig: {} },
        serviceContainer: {
          eventListener: null,
          sessionManager: createContextSessionManager(),
          memoryService: { readLongMemory: async () => "" },
          attachmentService: null,
          skillService: null,
          botManager: createTestBotManager(),
          errorLogger: null,
          userInteractionBridge: null,
        },
        sessionContext: {
          runtimeIdentity: systemRuntimeIdentity({
            userId: "u1",
            sessionId: "s1",
            dialogProcessId: "dp-no-logger",
            turnScopeId: "client-turn:no-logger",
          }),
          userMessageAttachments: [],
          systemMessages: [],
          runConfig: executionRunConfig("client-turn:no-logger"),
          abortSignal: new AbortController().signal,
          persistenceScope: null,
        },
      }),
    /ContextBuilder with memoryService requires errorLogger\.log/,
  );
});
