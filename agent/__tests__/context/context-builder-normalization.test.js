/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ContextBuilder } from "../../src/context/index.js";
import { buildContextMessageBlocks } from "../../src/context/assembly/message-builder.js";
import { createPersistedCurrentUserMessage } from "../runtime/core/message-builder-current-user-fixture.js";

function createBuilderForNormalizationTest() {
  return new ContextBuilder({
    config: {
      globalConfig: {},
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: { turnScopeId: "turn-1" },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

function createBuilderForAttachmentRuntimeTest({
  attachments = [],
  userMessageAttachments = null,
  includeContextKeys = [],
  eventListener = null,
} = {}) {
  return new ContextBuilder({
    config: {
      globalConfig: {
        workspaceRoot: "/tmp/noobot-test-workspace",
      },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: { async ingest() { return []; } },
      skillService: null,
      eventListener,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      ...(Array.isArray(userMessageAttachments) ? { userMessageAttachments } : {}),
      attachments,
      runConfig: {
        turnScopeId: "turn-1",
        contextPolicy: {
          includeContextKeys,
        },
      },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

test("buildInitialContext emits the default agent context debug structure", async () => {
  const events = [];
  const builder = createBuilderForAttachmentRuntimeTest({
    includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
    eventListener: {
      onEvent(event = {}) {
        events.push(event);
      },
    },
  });

  await builder.buildInitialContext({ dialogProcessId: "dp-debug" });

  const event = events.find((item = {}) => item.event === "agent.context.executionScopeCreated");
  assert.ok(event);
  assert.equal(event.data.debugType, "agent-context");
  assert.equal(event.data.sessionId, "s1");
  assert.equal(event.data.dialogProcessId, "dp-debug");
  assert.equal(event.data.turnScopeId, "turn-1");
  assert.equal(event.data.envelope.kind, "noobot.agent-context");
  assert.equal(event.data.envelope.protocolVersion, 1);
  assert.equal(event.data.bindings.runtimeBound, true);
  assert.equal(Array.isArray(event.data.bindings.toolNames), true);
  assert.deepEqual(event.data.separation, {
    envelopeJsonSerializable: true,
    runtimeOutsideEnvelope: true,
    toolsOutsideEnvelope: true,
  });
  assert.equal(JSON.stringify(event.data).includes("abortSignal"), false);
});

test("buildInitialContext prefers userMessageAttachments over legacy attachments", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    userMessageAttachments: [
      {
        attachmentId: "att_input",
        sessionId: "s1",
        name: "input.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/input.png",
      },
    ],
    attachments: [
      {
        attachmentId: "att_legacy",
        sessionId: "s1",
        name: "legacy.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/legacy.png",
      },
    ],
    includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  assert.equal(
    context?.bindings?.runtime?.userMessageAttachments?.[0]?.attachmentId,
    "att_input",
  );
  assert.deepEqual(context?.bindings?.runtime?.attachments, []);
});

test("buildInitialContext marks normalized superAdmin user as super user", async () => {
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
      sessionManager: null,
      memoryService: null,
      attachmentService: { async ingest() { return []; } },
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: configuredSuperUserId,
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: {
        turnScopeId: "turn-1",
        contextPolicy: {
          includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
        },
      },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  assert.equal(
    context?.bindings?.runtime?.systemRuntime?.isSuperUser,
    true,
  );
  assert.equal(context?.context?.environment?.permissions?.isSuperUser, true);
  assert.equal(
    context.context.modelContext.messageBlocks.system.join("\n").includes("\"isSuperUser\": true"),
    true,
  );
  assert.equal(
    context.context.modelContext.messageBlocks.system.join("\n").includes("\"allowedRoots\": [\n      \"<host-filesystem>\""),
    true,
  );
});

test("buildInitialContext keeps turn identity in runtime but excludes it from system text", async () => {
  const builder = new ContextBuilder({
    config: { globalConfig: {}, userConfig: {} },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      userMessageAttachments: [],
      runConfig: { turnScopeId: "turn-runtime-only" },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dialog-runtime-only" });
  const runtime = context.bindings.runtime.systemRuntime;
  const systemText = context.context.modelContext.messageBlocks.system.join("\n");

  assert.equal(runtime.dialogProcessId, "dialog-runtime-only");
  assert.equal(runtime.turnScopeId, "turn-runtime-only");
  assert.equal(systemText.includes("dialogProcessId"), false);
  assert.equal(systemText.includes("turnScopeId"), false);
  assert.equal(systemText.includes("dialog-runtime-only"), false);
  assert.equal(systemText.includes("turn-runtime-only"), false);
});

test("buildInitialContext keeps super user identity in system message when system_runtime is excluded", async () => {
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
      sessionManager: null,
      memoryService: null,
      attachmentService: { async ingest() { return []; } },
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: configuredSuperUserId,
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: {
        turnScopeId: "turn-1",
        contextPolicy: {
          includeContextKeys: ["base_prompt"],
        },
      },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  const systemText = context.context.modelContext.messageBlocks.system.join("\n");
  assert.equal(context?.context?.environment?.permissions?.isSuperUser, true);
  assert.equal(systemText.includes("\"identity\""), true);
  assert.equal(systemText.includes("\"isSuperUser\": true"), true);
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
          userMessageAttachments: [{ attachmentId: "att_input", name: "input.png" }],
          attachments: [{ attachmentId: "att_legacy", name: "legacy.png" }],
          systemRuntime: { sessionId: "s1", dialogProcessId: "dp1", turnScopeId: "turn-1" },
        },
      },
    },
    { currentUserMessage: createPersistedCurrentUserMessage("hello", {
      dialogProcessId: "dp1",
      turnScopeId: "turn-1",
      attachments: [{ attachmentId: "att_input", name: "input.png" }],
    }) },
  );
  const metaMessage = blocks.incremental.find(
    (item) => item?.additional_kwargs?.noobotInternalMessageType === "user_meta",
  );
  assert.ok(metaMessage);
  assert.equal(String(metaMessage.content || "").includes("att_input"), true);
  assert.equal(String(metaMessage.content || "").includes("att_legacy"), false);
});

test("buildInitialContext keeps user message attachments separate from runtime generated attachments when attachments section is excluded", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    userMessageAttachments: [
      {
        attachmentId: "att_1",
        sessionId: "s1",
        name: "image.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/att_1.png",
      },
    ],
    includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  const runtime = context?.bindings?.runtime || {};
  assert.equal(Array.isArray(runtime.userMessageAttachments), true);
  assert.equal(runtime.userMessageAttachments.length, 1);
  assert.equal(runtime.userMessageAttachments[0]?.attachmentId, "att_1");
  assert.deepEqual(runtime.attachments, []);
});

test("buildInitialContext resolves session history and passes edited turnScopeId", async () => {
  const calls = [];
  const builder = new ContextBuilder({
    config: {
      globalConfig: { workspaceRoot: "/tmp/noobot-test-workspace" },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: {
        async getContextRecords(payload = {}) {
          calls.push(payload);
          return [
            {
              role: "user",
              content: "history user",
              dialogProcessId: "history-dp",
              turnScopeId: "client-turn:old",
            },
            {
              role: "assistant",
              content: "history assistant",
              dialogProcessId: "history-dp",
              turnScopeId: "client-turn:old",
            },
          ];
        },
        async upsertSessionTree() {},
      },
      memoryService: null,
      attachmentService: { async ingest() { return []; } },
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: {
        turnScopeId: "client-turn:edited",
        contextPolicy: { includeContextKeys: ["base_prompt", "system_runtime"] },
      },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp-current" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.currentDialogProcessId, "dp-current");
  assert.equal(calls[0]?.currentTurnScopeId, "client-turn:edited");
  assert.deepEqual(
    context.context.modelContext.messageBlocks.history.map((item) => item.content),
    ["history user", "history assistant"],
  );
  assert.equal(context.context.modelContext.messageBlocks.system.length > 0, true);
});

function createBuilderForSuperUserRuntimeTest({ globalConfig = {}, userId = "u1", systemRuntimePatch = null } = {}) {
  return new ContextBuilder({
    config: {
      globalConfig,
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId,
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: { turnScopeId: "turn-1", ...(systemRuntimePatch ? { systemRuntimePatch } : {}) },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

function createBuilderForStartupDependencyRuntimeTest() {
  return new ContextBuilder({
    config: {
      globalConfig: {},
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: {
        startupContext: {
          runtime: {
            dependencies: {
              sourceSummary: {
                platform: "darwin",
                dependencies: [{
                  key: "ffmpeg",
                  name: "FFmpeg",
                  available: true,
                  installMode: "managed",
                  sourceType: "self-hosted",
                  hasCustomSource: true,
                  customSourceEnvKeys: ["NOOBOT_FFMPEG_MAC_URL"],
                  configKeys: ["darwinManaged.url"],
                }],
              },
            },
          },
        },
      },
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachments: [],
      runConfig: { turnScopeId: "turn-1" },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

test("_buildSystemRuntime derives isSuperUser from configured super user id", () => {
  const builder = createBuilderForSuperUserRuntimeTest({
    globalConfig: { super_admin: { user_id: "super-root-user" } },
    userId: "super-root-user",
  });

  const runtime = builder._buildSystemRuntime({ dialogProcessId: "dp-super" });

  assert.equal(runtime.isSuperUser, true);
});

test("_buildSystemRuntime injects redacted desktop dependency source summary", () => {
  const builder = createBuilderForStartupDependencyRuntimeTest();

  const runtime = builder._buildSystemRuntime({ dialogProcessId: "dp-deps" });

  assert.deepEqual(runtime.desktopDependencySources, {
    platform: "darwin",
    dependencies: [{
      key: "ffmpeg",
      name: "FFmpeg",
      available: true,
      installMode: "managed",
      sourceType: "self-hosted",
      hasCustomSource: true,
      customSourceEnvKeys: ["NOOBOT_FFMPEG_MAC_URL"],
      configKeys: ["darwinManaged.url"],
    }],
  });
  assert.equal(JSON.stringify(runtime.desktopDependencySources).includes("http"), false);
});

test("_buildSystemRuntime defaults isSuperUser to false when config is missing", () => {
  const builder = createBuilderForSuperUserRuntimeTest({
    globalConfig: {},
    userId: "super-root-user",
  });

  const runtime = builder._buildSystemRuntime({ dialogProcessId: "dp-regular" });

  assert.equal(runtime.isSuperUser, false);
});

test("_buildSystemRuntime does not allow systemRuntimePatch to grant super user", () => {
  const builder = createBuilderForSuperUserRuntimeTest({
    globalConfig: { super_admin: { user_id: "super-root-user" } },
    userId: "regular-user",
    systemRuntimePatch: { isSuperUser: true, userId: "super-root-user" },
  });

  const runtime = builder._buildSystemRuntime({ dialogProcessId: "dp-guard" });

  assert.equal(runtime.isSuperUser, false);
  assert.equal(runtime.userId, "super-root-user");
});
