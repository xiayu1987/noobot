/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

import {
  saveStoppedModelMessageSnapshot,
  loadStoppedModelMessageSnapshot,
} from "../../../src/runtime/resume/model-message-snapshot-store.js";
import { initializeSessionTree, persistSession } from "../../helpers/runtime-events-env.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  readContextMessageValue,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { SNAPSHOT_VERSION } from "@noobot/context-protocol/policy/snapshot";

const identity = {
  userId: "admin",
  sessionId: "session-a",
  parentSessionId: "parent-a",
  dialogProcessId: "dialog-a",
  turnScopeId: "turn-a",
};

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-stopped-snapshot-"));
  await initializeSessionTree(workspaceRoot, identity.userId);
  await persistSession(workspaceRoot, identity.userId, {
    sessionId: identity.parentSessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  await persistSession(workspaceRoot, identity.userId, {
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    caller: SESSION_CALLER.USER,
  });
  return workspaceRoot;
}

function snapshotFileOf(workspaceRoot) {
  return path.join(
    workspaceRoot,
    identity.userId,
    "runtime",
    "session",
    identity.parentSessionId,
    identity.sessionId,
    "model-message-snapshots",
    `${identity.dialogProcessId}__${identity.turnScopeId}.json`,
  );
}

test("stopped model message snapshot keeps message tool calls and tool results", async () => {
  const workspaceRoot = await createWorkspace();
  const toolCallingAi = new AIMessage({
    content: "",
    additional_kwargs: {
      tool_calls: [{ id: "call-1", type: "function", function: { name: "x", arguments: "{}" } }],
    },
  });
  const toolResult = new ToolMessage({ content: "tool output", tool_call_id: "call-1" });

  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: {
      system: [new SystemMessage("system prompt")],
      history: [new HumanMessage("old user"), toolCallingAi, toolResult],
      incremental: [new HumanMessage("current user")],
    },
    messages: [
      new SystemMessage("system prompt"),
      new HumanMessage("old user"),
      toolCallingAi,
      toolResult,
      new HumanMessage("current user"),
    ],
  });

  assert.equal(await fs.stat(snapshotFileOf(workspaceRoot)).then((stat) => stat.isFile()), true);
  await assert.rejects(
    () =>
      fs.access(
        path.join(
          workspaceRoot,
          identity.userId,
          "runtime",
          "session",
          identity.parentSessionId,
          "model-message-snapshots",
        ),
      ),
    /ENOENT/,
  );

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });

  assert.deepEqual(
    loaded.messageBlocks.system.map((item) => item.content),
    ["system prompt"],
  );
  assert.deepEqual(
    loaded.messageBlocks.history.map((item) => item.content),
    ["old user", "", "tool output"],
  );
  assert.deepEqual(
    loaded.messageBlocks.incremental.map((item) => item.content),
    ["current user"],
  );
  assert.deepEqual(
    loaded.messages.map((item) => item.content),
    ["system prompt", "old user", "", "tool output", "current user"],
  );
  assert.deepEqual(
    loaded.messageBlocks.history.map((item) => item.type),
    ["human", "ai", "tool"],
  );
  assert.deepEqual(
    loaded.messages.map((item) => item.type),
    ["system", "human", "ai", "tool", "human"],
  );
  assert.ok(loaded.messages.every((item) => Object.getPrototypeOf(item) === Object.prototype));
  const loadedToolCallingAi = loaded.messages.find((item) => item.type === "ai");
  assert.deepEqual(loadedToolCallingAi.tool_calls, [{ id: "call-1", name: "x", args: {} }]);
  assert.deepEqual(loadedToolCallingAi.additional_kwargs.tool_calls, [
    { id: "call-1", type: "function", function: { name: "x", arguments: "{}" } },
  ]);
  const loadedToolResult = loaded.messages.find((item) => item.type === "tool");
  assert.equal(loadedToolResult.content, "tool output");
  assert.equal(loadedToolResult.tool_call_id, "call-1");
});

test("stopped snapshot round trip preserves Anthropic thinking blocks and OpenAI Responses reasoning output", async () => {
  const workspaceRoot = await createWorkspace();
  const anthropicAi = new AIMessage({
    content: [
      { type: "thinking", thinking: "inspect", signature: "sig_1" },
      { type: "tool_use", id: "tool_1", name: "read_file", input: {} },
    ],
    tool_calls: [{ id: "tool_1", name: "read_file", args: {}, type: "tool_call" }],
  });
  const anthropicResult = new ToolMessage({ content: "ok", tool_call_id: "tool_1" });
  const openAiAi = new AIMessage({
    content: [{ type: "reasoning", reasoning: "summary" }],
    tool_calls: [{ id: "call_1", name: "read_file", args: {}, type: "tool_call" }],
    additional_kwargs: {
      reasoning: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
    },
    response_metadata: {
      output: [
        { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
        {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: "{}",
        },
      ],
    },
  });
  const openAiResult = new ToolMessage({ content: "ok", tool_call_id: "call_1" });
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: {
      system: [],
      history: [anthropicAi, anthropicResult, openAiAi, openAiResult],
      incremental: [],
    },
  });
  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });
  const loadedAnthropic = loaded.messageBlocks.history[0];
  assert.deepEqual(loadedAnthropic.content, anthropicAi.content);
  assert.equal(loaded.messageBlocks.history[1].tool_call_id, "tool_1");
  const loadedOpenAi = loaded.messageBlocks.history[2];
  assert.deepEqual(loadedOpenAi.response_metadata.output, openAiAi.response_metadata.output);
  assert.deepEqual(loadedOpenAi.additional_kwargs.reasoning, openAiAi.additional_kwargs.reasoning);
  assert.deepEqual(loadedOpenAi.tool_calls, openAiAi.tool_calls);
  assert.equal(loaded.messageBlocks.history[3].tool_call_id, "call_1");
});

test("stopped model message snapshot preserves additional_kwargs facts and rejects off-protocol top-level fields", async () => {
  const workspaceRoot = await createWorkspace();
  const message = new HumanMessage({
    content: "full context",
    additional_kwargs: { attachmentMetas: [{ attachmentId: "att-1" }] },
  });
  writeContextMessageMetadata(message, { messageUid: "sm_full", summarized: true });
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [], history: [message], incremental: [] },
    messages: [message],
  });
  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });
  assert.equal(loaded.version, SNAPSHOT_VERSION);
  assert.equal(readContextMessageValue(loaded.messages[0], "messageUid"), "sm_full");
  assert.equal(readContextMessageValue(loaded.messages[0], "summarized"), true);
  assert.equal("summarized" in loaded.messages[0], false);
  assert.equal("lc_kwargs" in loaded.messages[0], false);
  assert.deepEqual(readContextMessageValue(loaded.messages[0], "attachmentMetas"), [
    { attachmentId: "att-1" },
  ]);

  const offProtocol = new HumanMessage("off protocol");
  offProtocol.noobotBusinessMeta = { kept: true };
  await assert.rejects(
    () =>
      saveStoppedModelMessageSnapshot({
        globalConfig: { workspaceRoot },
        identity,
        messageBlocks: { system: [], history: [offProtocol], incremental: [] },
      }),
    /top-level field is not part of the protocol: noobotBusinessMeta/,
  );
});

test("stopped snapshot round trip preserves injected messages by block, order, source, type and round identity", async () => {
  const workspaceRoot = await createWorkspace();
  const injected = ({
    MessageClass,
    content,
    injectedBy,
    injectedMessageType,
    dialogProcessId,
    turnScopeId,
  }) => {
    const message = new MessageClass({
      content,
      additional_kwargs: { marker: `${content}-marker` },
    });
    return writeContextMessageMetadata(message, {
      injectedMessage: true,
      injectedBy,
      injectedMessageType,
      dialogProcessId,
      turnScopeId,
    });
  };
  const systemInjection = injected({
    MessageClass: SystemMessage,
    content: "system injection",
    injectedBy: "botPlugin",
    injectedMessageType: "workflow_system_context",
    dialogProcessId: "dialog-system",
    turnScopeId: "turn-system",
  });
  const historyInjection = injected({
    MessageClass: HumanMessage,
    content: "history injection",
    injectedBy: "harness-plugin",
    injectedMessageType: "guidance",
    dialogProcessId: "dialog-history",
    turnScopeId: "turn-history",
  });
  const incrementalInjection = injected({
    MessageClass: HumanMessage,
    content: "user interjection",
    injectedBy: "user",
    injectedMessageType: "noobot.user_interjection",
    dialogProcessId: "dialog-incremental",
    turnScopeId: "turn-incremental",
  });

  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: {
      system: [new SystemMessage("base system"), systemInjection],
      history: [new HumanMessage("history user"), historyInjection],
      incremental: [incrementalInjection, new AIMessage("after injection")],
    },
  });

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });
  assert.deepEqual(
    loaded.messageBlocks.system.map((message) => message.content),
    ["base system", "system injection"],
  );
  assert.deepEqual(
    loaded.messageBlocks.history.map((message) => message.content),
    ["history user", "history injection"],
  );
  assert.deepEqual(
    loaded.messageBlocks.incremental.map((message) => message.content),
    ["user interjection", "after injection"],
  );

  const loadedInjections = [
    loaded.messageBlocks.system[1],
    loaded.messageBlocks.history[1],
    loaded.messageBlocks.incremental[0],
  ];
  assert.deepEqual(
    loadedInjections.map((message) => ({
      injectedMessage: readContextMessageValue(message, "injectedMessage"),
      injectedBy: readContextMessageValue(message, "injectedBy"),
      injectedMessageType: readContextMessageValue(message, "injectedMessageType"),
      dialogProcessId: readContextMessageValue(message, "dialogProcessId"),
      turnScopeId: readContextMessageValue(message, "turnScopeId"),
      marker: readContextMessageValue(message, "marker"),
    })),
    [
      {
        injectedMessage: true,
        injectedBy: "botPlugin",
        injectedMessageType: "workflow_system_context",
        dialogProcessId: "dialog-system",
        turnScopeId: "turn-system",
        marker: "system injection-marker",
      },
      {
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "guidance",
        dialogProcessId: "dialog-history",
        turnScopeId: "turn-history",
        marker: "history injection-marker",
      },
      {
        injectedMessage: true,
        injectedBy: "user",
        injectedMessageType: "noobot.user_interjection",
        dialogProcessId: "dialog-incremental",
        turnScopeId: "turn-incremental",
        marker: "user interjection-marker",
      },
    ],
  );

  const recoveredInjections = [
    ...loaded.messageBlocks.history,
    ...loaded.messageBlocks.incremental,
  ].filter((message) => readContextMessageValue(message, "injectedMessage") === true);
  assert.deepEqual(
    recoveredInjections.map((message) => [
      message.content,
      readContextMessageValue(message, "injectedBy"),
      readContextMessageValue(message, "injectedMessageType"),
      readContextMessageValue(message, "dialogProcessId"),
      readContextMessageValue(message, "turnScopeId"),
    ]),
    [
      ["history injection", "harness-plugin", "guidance", "dialog-history", "turn-history"],
      [
        "user interjection",
        "user",
        "noobot.user_interjection",
        "dialog-incremental",
        "turn-incremental",
      ],
    ],
  );
});

test("stopped model message snapshot validates identity on load", async () => {
  const workspaceRoot = await createWorkspace();
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [new SystemMessage("system")], history: [], incremental: [] },
    messages: [new SystemMessage("system")],
  });

  const snapshotFile = snapshotFileOf(workspaceRoot);
  const raw = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
  raw.sessionId = "different-session";
  await fs.writeFile(snapshotFile, JSON.stringify(raw, null, 2), "utf8");

  await assert.rejects(
    () => loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity }),
    /identity mismatch: sessionId/,
  );
});

test("stopped model message snapshot does not recreate a deleted parent session chain", async () => {
  const workspaceRoot = await createWorkspace();
  const sessionRoot = path.join(workspaceRoot, identity.userId, "runtime", "session");
  await fs.writeFile(
    path.join(sessionRoot, ".deleted-sessions.json"),
    JSON.stringify({
      sessions: { [identity.parentSessionId]: Date.now() },
    }),
    "utf8",
  );

  const saved = await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [new SystemMessage("late")], history: [], incremental: [] },
  });

  assert.deepEqual(saved, { saved: false, reason: "session_deleted" });
  await assert.rejects(() => fs.access(path.dirname(snapshotFileOf(workspaceRoot))), /ENOENT/);
  assert.equal(
    await loadStoppedModelMessageSnapshot({
      globalConfig: { workspaceRoot },
      identity,
      allowMissing: true,
    }),
    null,
  );
});

test("stopped model message snapshot skips a session that is not registered in the tree", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-stopped-snapshot-"));
  await initializeSessionTree(workspaceRoot, identity.userId);
  const saved = await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [new SystemMessage("draft")], history: [], incremental: [] },
  });

  assert.deepEqual(saved, { saved: false, reason: "session_missing" });
  await assert.rejects(() => fs.access(path.dirname(snapshotFileOf(workspaceRoot))), /ENOENT/);
  await assert.rejects(
    () => loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity }),
    /snapshot unavailable: session_missing/,
  );
});

test("stopped model message snapshot preserves existing harness policy messages", async () => {
  const workspaceRoot = await createWorkspace();
  const protocolPatch = new HumanMessage({
    content: "ID: dialog-a\nPATCH: keep allowed protocol content",
    additional_kwargs: { dialogProcessId: "dialog-a", turnScopeId: "turn-a" },
  });
  const userMeta = new HumanMessage({
    content: '[用户元信息]\n{"dialogProcessId":"dialog-a","turnScopeId":"turn-a"}\n[/用户元信息]',
    additional_kwargs: {
      noobotInternalMessageType: "user_meta",
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
    },
  });
  const harnessPolicy = new SystemMessage(
    "[HARNESS_POLICY_SELECTION]\nscenario = programming\n[/HARNESS_POLICY_SELECTION]",
  );
  const harnessScenario = new SystemMessage(
    "[HARNESS_SCENARIO_POLICY]\nshould not enter resume init\n[/HARNESS_SCENARIO_POLICY]",
  );
  const harnessDynamic = new HumanMessage(
    "[HARNESS_DYNAMIC_POLICY_PROMPT]\nexternal policy\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
  );

  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: {
      system: [new SystemMessage("snapshot-system"), harnessPolicy, harnessScenario],
      history: [new AIMessage("snapshot-history")],
      incremental: [protocolPatch, userMeta, harnessDynamic],
    },
    messages: [
      new SystemMessage("snapshot-system"),
      harnessPolicy,
      harnessScenario,
      new AIMessage("snapshot-history"),
      protocolPatch,
      userMeta,
      harnessDynamic,
    ],
  });

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });
  const allContent = [
    ...loaded.messageBlocks.system,
    ...loaded.messageBlocks.history,
    ...loaded.messageBlocks.incremental,
    ...loaded.messages,
  ].map((item) => String(item.content || ""));

  assert.equal(
    allContent.some((content) => content.includes("HARNESS_POLICY_SELECTION")),
    true,
  );
  assert.equal(
    allContent.some((content) => content.includes("HARNESS_SCENARIO_POLICY")),
    true,
  );
  assert.equal(
    allContent.some((content) => content.includes("HARNESS_DYNAMIC_POLICY_PROMPT")),
    true,
  );
  assert.deepEqual(
    loaded.messageBlocks.system.map((item) => item.content),
    [
      "snapshot-system",
      "[HARNESS_POLICY_SELECTION]\nscenario = programming\n[/HARNESS_POLICY_SELECTION]",
      "[HARNESS_SCENARIO_POLICY]\nshould not enter resume init\n[/HARNESS_SCENARIO_POLICY]",
    ],
  );
  assert.deepEqual(
    loaded.messageBlocks.history.map((item) => item.content),
    ["snapshot-history"],
  );
  assert.deepEqual(
    loaded.messageBlocks.incremental.map((item) => item.content),
    [
      "ID: dialog-a\nPATCH: keep allowed protocol content",
      '[用户元信息]\n{"dialogProcessId":"dialog-a","turnScopeId":"turn-a"}\n[/用户元信息]',
      "[HARNESS_DYNAMIC_POLICY_PROMPT]\nexternal policy\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
    ],
  );
});

test("stopped model message snapshot preserves protocol content on load", async () => {
  const workspaceRoot = await createWorkspace();
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: {
      system: [new SystemMessage("system")],
      history: [],
      incremental: [new HumanMessage("ID: keep\nPATCH: keep")],
    },
    messages: [new SystemMessage("system"), new HumanMessage("ID: keep\nPATCH: keep")],
  });
  const snapshotFile = snapshotFileOf(workspaceRoot);
  const raw = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
  raw.messageBlocks.system.push({
    type: "system",
    content: "[HARNESS_POLICY_SELECTION]\nprotocol content\n[/HARNESS_POLICY_SELECTION]",
    additional_kwargs: {},
  });
  raw.messageBlocks.incremental.push({
    type: "human",
    content: "[HARNESS_DYNAMIC_POLICY_PROMPT]\nprotocol content\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
    additional_kwargs: {},
  });
  raw.messages.push({
    type: "system",
    content: "[HARNESS_SCENARIO_POLICY]\nprotocol content\n[/HARNESS_SCENARIO_POLICY]",
    additional_kwargs: {},
  });
  await fs.writeFile(snapshotFile, JSON.stringify(raw, null, 2), "utf8");

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });
  assert.deepEqual(
    loaded.messageBlocks.system.map((item) => item.content),
    ["system", "[HARNESS_POLICY_SELECTION]\nprotocol content\n[/HARNESS_POLICY_SELECTION]"],
  );
  assert.deepEqual(
    loaded.messageBlocks.incremental.map((item) => item.content),
    [
      "ID: keep\nPATCH: keep",
      "[HARNESS_DYNAMIC_POLICY_PROMPT]\nprotocol content\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
    ],
  );
  assert.deepEqual(
    loaded.messages.map((item) => item.content),
    [
      "system",
      "ID: keep\nPATCH: keep",
      "[HARNESS_SCENARIO_POLICY]\nprotocol content\n[/HARNESS_SCENARIO_POLICY]",
    ],
  );
});
