import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createBaseContext,
  createContextWithSharedTools,
  getBeforeDispatch,
  runWorkflowHook,
  callsByNodeName,
  workflowTurn,
  createRegisterWorkflowHooks,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "./helpers/workflow-hook-session-strategy-helper.js";

test("workflow hook passes planned user attachments to node sub-session", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticRequestMessages = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async (payload = {}) => {
        semanticRequestMessages.push(...(Array.isArray(payload?.messages) ? payload.messages : []));
        return {
          output: [
            "WORKFLOW_DSL/1",
            'ATTACHMENT id="node-file" name="合同.pdf" path="/workspace/attachments/s-input-att/contract.pdf" mimeType="application/pdf"',
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=read type=action name="读取附件" task="请读取并总结用户附件" attachments="node-file"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=read",
            "EDGE from=read to=end",
            "END",
          ].join("\n"),
        };
      },
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        return {
          sessionId: "node-session-read",
          dialogProcessId: "node-dialog-read",
          result: {
            answer: "done",
            messages: [{ role: "assistant", content: "done" }],
          },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-input-att",
    dialogProcessId: "d-input-att",
    userMessage: "请基于附件规划并执行",
    attachments: [
      {
        attachmentId: "att-user-1",
        name: "合同.pdf",
        mimeType: "application/pdf",
        path: "/attachments/s-input-att/contract.pdf",
      },
    ],
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              resolveSandboxPath({ hostPath = "" } = {}) {
                return `/workspace${String(hostPath || "")}`;
              },
            },
          },
        },
      },
    },
  });

  assert.equal(subSessionCalls.length, 1);
  assert.equal(subSessionCalls[0]?.metadata?.inputAttachmentRefs?.[0], "node-file");
  const nodeSystemMessages = String((subSessionCalls[0]?.systemMessages || []).join("\n\n"));
  assert.match(nodeSystemMessages, /用户原始附件/);
  assert.match(nodeSystemMessages, /合同\.pdf/);
  assert.match(nodeSystemMessages, /\/workspace\/attachments\/s-input-att\/contract\.pdf/);

  const semanticPrompt = String(semanticRequestMessages[0]?.content || "");
  assert.match(semanticPrompt, /用户附件/);
  assert.match(semanticPrompt, /attachmentId=att-user-1/);
  assert.match(semanticPrompt, /ATTACHMENT id=/);
  assert.match(semanticPrompt, /attachments="user:\*"/);
});


