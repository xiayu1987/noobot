import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

import {
  saveStoppedModelMessageSnapshot,
  saveStoppedModelMessageSnapshotCandidate,
  syncStoppedModelMessageSnapshotCandidate,
  loadStoppedModelMessageSnapshot,
  clearStoppedModelMessageSnapshot,
} from "../../../../src/system-core/agent/core/resume/model-message-snapshot-store.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-stopped-snapshot-"));
}

const identity = {
  userId: "admin",
  sessionId: "session-a",
  parentSessionId: "parent-a",
  dialogProcessId: "dialog-a",
  turnScopeId: "turn-a",
};

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

  const loaded = await loadStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
  });

  assert.deepEqual(loaded.messageBlocks.system.map((item) => item.content), ["system prompt"]);
  assert.deepEqual(loaded.messageBlocks.history.map((item) => item.content), ["old user", "", "tool output"]);
  assert.deepEqual(loaded.messageBlocks.incremental.map((item) => item.content), ["current user"]);
  assert.deepEqual(loaded.messages.map((item) => item.content), ["system prompt", "old user", "", "tool output", "current user"]);
  assert.deepEqual(loaded.messageBlocks.history.map((item) => item._getType()), ["human", "ai", "tool"]);
  assert.deepEqual(loaded.messages.map((item) => item._getType()), ["system", "human", "ai", "tool", "human"]);
  const loadedToolCallingAi = loaded.messages.find((item) => item instanceof AIMessage);
  assert.deepEqual(loadedToolCallingAi.tool_calls, [{ id: "call-1", name: "x", args: {} }]);
  assert.deepEqual(loadedToolCallingAi.additional_kwargs.tool_calls, [
    { id: "call-1", type: "function", function: { name: "x", arguments: "{}" } },
  ]);
  const loadedToolResult = loaded.messages.find((item) => item instanceof ToolMessage);
  assert.equal(loadedToolResult.content, "tool output");
  assert.equal(loadedToolResult.tool_call_id, "call-1");

  await clearStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity });
  await assert.rejects(
    () => loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity }),
    /ENOENT/,
  );
});

test("stopped snapshot candidate sync never persists projected model input as history", async () => {
  const workspaceRoot = await createWorkspace();
  const toolCallingAi = new AIMessage({
    content: "",
    additional_kwargs: {
      tool_calls: [{ id: "call-1", type: "function", function: { name: "execute_script", arguments: "{}" } }],
    },
  });
  const toolResult = new ToolMessage({ content: "tool output", tool_call_id: "call-1" });
  const runtime = {
    stoppedModelMessageSnapshotCandidate: {
      ...identity,
      messages: [new SystemMessage("system prompt"), new HumanMessage("real user"), toolCallingAi, toolResult],
      messageBlocks: {
        system: [new SystemMessage("system prompt")],
        history: [new HumanMessage("real user"), toolCallingAi, toolResult],
        incremental: [],
      },
    },
  };

  syncStoppedModelMessageSnapshotCandidate(runtime, [
    new SystemMessage("system prompt"),
    new HumanMessage("real user"),
    new HumanMessage("[用户元信息]\n{}\n[/用户元信息]"),
    new HumanMessage(""),
    new HumanMessage("tool output"),
  ]);

  await saveStoppedModelMessageSnapshotCandidate({
    globalConfig: { workspaceRoot },
    candidate: runtime.stoppedModelMessageSnapshotCandidate,
  });
  const loaded = await loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity });

  assert.deepEqual(loaded.messageBlocks.history.map((item) => item._getType()), ["human", "ai", "tool"]);
  assert.equal(loaded.messageBlocks.history.filter((item) => String(item.content || "").includes("[用户元信息]")).length, 0);
  assert.equal(loaded.messageBlocks.history[1] instanceof AIMessage, true);
  assert.deepEqual(loaded.messageBlocks.history[1].tool_calls, [{ id: "call-1", name: "execute_script", args: {} }]);
  assert.equal(loaded.messageBlocks.history[2] instanceof ToolMessage, true);
  assert.equal(loaded.messageBlocks.history[2].tool_call_id, "call-1");
  assert.deepEqual(loaded.messages.map((item) => item._getType()), ["system", "human", "ai", "tool"]);
});

test("stopped model message snapshot v2 preserves ids, summary state, lc metadata and arbitrary fields", async () => {
  const workspaceRoot = await createWorkspace();
  const message = new HumanMessage({
    content: "full context",
    additional_kwargs: { noobotMessageId: "am_full", attachmentMetas: [{ attachmentId: "att-1" }] },
  });
  message.summarized = true;
  message.lc_kwargs = { content: "full context", summarized: true, custom: { kept: true } };
  message.noobotBusinessMeta = { kept: true };
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot }, identity,
    messageBlocks: { system: [], history: [message], incremental: [] },
    messages: [message],
  });
  const loaded = await loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity });
  assert.equal(loaded.version, 2);
  assert.equal(loaded.messages[0].additional_kwargs.noobotMessageId, "am_full");
  assert.equal(loaded.messages[0].summarized, true);
  assert.deepEqual(loaded.messages[0].lc_kwargs.custom, { kept: true });
  assert.deepEqual(loaded.messages[0].noobotBusinessMeta, { kept: true });
  assert.deepEqual(loaded.messages[0].additional_kwargs.attachmentMetas, [{ attachmentId: "att-1" }]);
});

test("stopped model message snapshot validates identity on load", async () => {
  const workspaceRoot = await createWorkspace();
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [new SystemMessage("system")], history: [], incremental: [] },
    messages: [new SystemMessage("system")],
  });

  const snapshotFile = path.join(
    workspaceRoot,
    identity.userId,
    "runtime",
    "session",
    identity.sessionId,
    "model-message-snapshots",
    `${identity.dialogProcessId}__${identity.turnScopeId}.json`,
  );
  const raw = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
  raw.sessionId = "different-session";
  await fs.writeFile(snapshotFile, JSON.stringify(raw, null, 2), "utf8");

  await assert.rejects(
    () => loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity }),
    /identity mismatch: sessionId/,
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
  const harnessPolicy = new SystemMessage("[HARNESS_POLICY_SELECTION]\nscenario = programming\n[/HARNESS_POLICY_SELECTION]");
  const harnessScenario = new SystemMessage("[HARNESS_SCENARIO_POLICY]\nshould not enter resume init\n[/HARNESS_SCENARIO_POLICY]");
  const harnessDynamic = new HumanMessage("[HARNESS_DYNAMIC_POLICY_PROMPT]\nexternal policy\n[/HARNESS_DYNAMIC_POLICY_PROMPT]");

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

  assert.equal(allContent.some((content) => content.includes("HARNESS_POLICY_SELECTION")), true);
  assert.equal(allContent.some((content) => content.includes("HARNESS_SCENARIO_POLICY")), true);
  assert.equal(allContent.some((content) => content.includes("HARNESS_DYNAMIC_POLICY_PROMPT")), true);
  assert.deepEqual(loaded.messageBlocks.system.map((item) => item.content), [
    "snapshot-system",
    "[HARNESS_POLICY_SELECTION]\nscenario = programming\n[/HARNESS_POLICY_SELECTION]",
    "[HARNESS_SCENARIO_POLICY]\nshould not enter resume init\n[/HARNESS_SCENARIO_POLICY]",
  ]);
  assert.deepEqual(loaded.messageBlocks.history.map((item) => item.content), ["snapshot-history"]);
  assert.deepEqual(loaded.messageBlocks.incremental.map((item) => item.content), [
    "ID: dialog-a\nPATCH: keep allowed protocol content",
    '[用户元信息]\n{"dialogProcessId":"dialog-a","turnScopeId":"turn-a"}\n[/用户元信息]',
    "[HARNESS_DYNAMIC_POLICY_PROMPT]\nexternal policy\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
  ]);
});

test("stopped model message snapshot preserves legacy snapshot content on load", async () => {
  const workspaceRoot = await createWorkspace();
  await saveStoppedModelMessageSnapshot({
    globalConfig: { workspaceRoot },
    identity,
    messageBlocks: { system: [new SystemMessage("system")], history: [], incremental: [new HumanMessage("ID: keep\nPATCH: keep")] },
    messages: [new SystemMessage("system"), new HumanMessage("ID: keep\nPATCH: keep")],
  });
  const snapshotFile = path.join(
    workspaceRoot,
    identity.userId,
    "runtime",
    "session",
    identity.sessionId,
    "model-message-snapshots",
    `${identity.dialogProcessId}__${identity.turnScopeId}.json`,
  );
  const raw = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
  raw.messageBlocks.system.push({ type: "system", content: "[HARNESS_POLICY_SELECTION]\nlegacy polluted\n[/HARNESS_POLICY_SELECTION]", additional_kwargs: {} });
  raw.messageBlocks.incremental.push({ type: "human", content: "[HARNESS_DYNAMIC_POLICY_PROMPT]\nlegacy polluted\n[/HARNESS_DYNAMIC_POLICY_PROMPT]", additional_kwargs: {} });
  raw.messages.push({ type: "system", content: "[HARNESS_SCENARIO_POLICY]\nlegacy polluted\n[/HARNESS_SCENARIO_POLICY]", additional_kwargs: {} });
  await fs.writeFile(snapshotFile, JSON.stringify(raw, null, 2), "utf8");

  const loaded = await loadStoppedModelMessageSnapshot({ globalConfig: { workspaceRoot }, identity });
  assert.deepEqual(loaded.messageBlocks.system.map((item) => item.content), [
    "system",
    "[HARNESS_POLICY_SELECTION]\nlegacy polluted\n[/HARNESS_POLICY_SELECTION]",
  ]);
  assert.deepEqual(loaded.messageBlocks.incremental.map((item) => item.content), [
    "ID: keep\nPATCH: keep",
    "[HARNESS_DYNAMIC_POLICY_PROMPT]\nlegacy polluted\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
  ]);
  assert.deepEqual(loaded.messages.map((item) => item.content), [
    "system",
    "ID: keep\nPATCH: keep",
    "[HARNESS_SCENARIO_POLICY]\nlegacy polluted\n[/HARNESS_SCENARIO_POLICY]",
  ]);
});
