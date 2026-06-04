/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterWorkflowHooks } from "../src/core/hooks.js";
import { WORKFLOW_BOT_HOOK_POINTS } from "../src/core/constants.js";

function createMockBotHookManager() {
  const listeners = new Map();
  const emits = [];
  return {
    listeners,
    emits,
    on(point, handler, options = {}) {
      listeners.set(String(point || "").trim(), { handler, options });
      return () => listeners.delete(String(point || "").trim());
    },
    async emit(point, payload) {
      emits.push({ point: String(point || "").trim(), payload });
      if (String(point || "").trim() === WORKFLOW_BOT_HOOK_POINTS.NODE_AGENT_EXECUTE) {
        return {
          results: [
            {
              ok: true,
              result: { action: { type: "submit", stepIndex: 0 } },
            },
          ],
        };
      }
      const record = listeners.get(String(point || "").trim());
      if (!record || typeof record.handler !== "function") {
        return { results: [], errors: [] };
      }
      const result = await record.handler(payload || {});
      return { results: [{ ok: true, result }], errors: [] };
    },
  };
}

test("workflow hook uses injected sub-session strategy and marks workflow message", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const generatedArtifactCalls = [];
  const planningPersistCalls = [];
  const eventLogCalls = [];

  const disposers = registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      semanticPrompt: "emit workflow dsl",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="请输出：节点A执行完成"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
        traces: [{ id: "semantic_trace_1" }],
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        return {
          sessionId: "wf-node-session-1",
          dialogProcessId: "wf_node_dialog_1",
          persisted: { outputDir: "/tmp/noobot/workflow/s1/node1" },
          result: {
            answer: "answer-node-done\n\n[Harness-Review]\n{\"status\":\"pass\"}",
            messages: [
              { role: "assistant", content: "message-node-done", type: "message" },
            ],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        generatedArtifactCalls.push(payload);
        return [
          {
            attachmentId: "wf-node-result-1",
            name: String(payload?.artifacts?.[0]?.name || "workflow-node-1-result.md"),
            mimeType: "text/markdown",
            path: "/attachments/s1/workflow-node-1-result.md",
          },
        ];
      },
      workflowDialogPersister: async (payload = {}) => {
        planningPersistCalls.push(payload);
        return {
          outputDir: "/tmp/noobot/workflow/s1/d1",
          outputFile: "/tmp/noobot/workflow/s1/d1/planning.json",
        };
      },
      workflowEventLogger: async (payload = {}) => {
        eventLogCalls.push(payload);
        return {
          outputDir: String(payload?.relativeDir || ""),
          outputFile: "events.jsonl",
        };
      },
    },
  });
  assert.equal(Array.isArray(disposers), true);
  assert.equal(disposers.length > 0, true);

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);

  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    userMessage: "请给我一个审批工作流",
    runConfig: {
      locale: "zh-CN",
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              resolveSandboxPath({ hostPath = "" } = {}) {
                const normalized = String(hostPath || "").trim();
                if (!normalized) return "";
                return `/workspace${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
              },
            },
          },
        },
      },
    },
    eventListener: {
      onEvent() {},
    },
  };
  await beforeDispatch.handler(beforeContext);
  const agentResult = beforeContext.overrideAgentResult;
  assert.equal(beforeContext.skipAgentDispatch, true);
  assert.ok(agentResult);

  assert.equal(subSessionCalls.length, 1);
  assert.equal(generatedArtifactCalls.length, 1);
  assert.equal(generatedArtifactCalls[0]?.sessionId, "s1");
  assert.equal(generatedArtifactCalls[0]?.generationSource, "workflow_node_agent_result");
  const savedArtifactText = Buffer.from(
    String(generatedArtifactCalls[0]?.artifacts?.[0]?.contentBase64 || ""),
    "base64",
  ).toString("utf8");
  assert.match(savedArtifactText, /message-node-done/);
  assert.equal(savedArtifactText.includes("answer-node-done"), false);
  assert.equal(savedArtifactText.includes("[Harness-Review]"), false);
  assert.equal(planningPersistCalls.length, 1);
  assert.equal(eventLogCalls.length > 0, true);
  assert.equal(planningPersistCalls[0]?.relativeDir, "runtime/workflow/planning/s1/d1");
  assert.equal(planningPersistCalls[0]?.fileName, "planning.json");

  const subCall = subSessionCalls[0] || {};
  assert.equal(Array.isArray(subCall?.strategy?.disabledPlugins), true);
  assert.equal(subCall.strategy.disabledPlugins.includes("workflow"), true);
  assert.equal(subCall.strategy.disabledPlugins.includes("harness"), false);
  assert.match(String(subCall?.strategy?.dialogProcessId || ""), /^wf_node_/);
  assert.equal(
    Array.isArray(subCall?.runConfigPatch?.selectedPlugins) &&
      subCall.runConfigPatch.selectedPlugins.includes("harness"),
    false,
  );
  assert.equal(String(subCall?.message || "").trim(), "请输出：节点A执行完成");
  assert.equal(typeof subCall?.eventListener?.onEvent, "function");
  assert.match(
    String(subCall?.strategy?.relativeDir || ""),
    /^runtime\/workflow\/session\/s1\/wf_node_/,
  );

  assert.ok(agentResult.workflow);
  assert.equal(agentResult.workflow?.planningDialog?.dialogId, "d1");
  assert.equal(
    String(agentResult.workflow?.planningDialog?.storageFile || "").endsWith("planning.json"),
    true,
  );
  assert.equal(Array.isArray(agentResult.workflow?.nodeSessions), true);
  assert.equal(agentResult.workflow.nodeSessions.length, 1);
  assert.equal(agentResult.workflow.nodeSessions[0]?.rootSessionId, "s1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.sessionId, "wf-node-session-1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");
  assert.equal(agentResult.workflow.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");

  const workflowTurn = (agentResult.turnMessages || []).find(
    (item) => item?.workflowMessage === true,
  );
  assert.ok(workflowTurn);
  assert.equal(workflowTurn?.type, "workflow");
  assert.equal(workflowTurn?.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");
  assert.match(
    String(workflowTurn?.content || ""),
    /\/workspace\/attachments\/s1\/workflow-node-1-result\.md/,
  );
  assert.equal(String(workflowTurn?.content || "").includes("message-node-done"), false);
  assert.equal(String(workflowTurn?.content || "").includes("answer-node-done"), false);
  assert.equal(workflowTurn?.workflowMeta?.source, "workflow-plugin");
  assert.equal(
    workflowTurn?.workflowMeta?.payload?.execution?.nodeAgentRuns?.[0]?.nodeResultText,
    undefined,
  );
  const hasPayloadBuiltEvent = eventLogCalls.some(
    (item) => String(item?.event?.event || "").trim() === "workflow_payload_build_succeeded",
  );
  assert.equal(hasPayloadBuiltEvent, true);
});
