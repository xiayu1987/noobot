/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT } from "@noobot/hook-protocol";

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
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../helpers/workflow-hook-session-strategy-helper.js";

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
      resolveModelMessages: () => [],
      capabilityModelInvoker: async (payload = {}) => {
        semanticRequestMessages.push(...(Array.isArray(payload?.messages) ? payload.messages : []));
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=read type=action name="读取附件" task="请读取并总结用户附件" attachments="attachment:v1:s-input-att/user/att-user-1"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=read",
              "EDGE from=read to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => {
        const systemMessages = await payload.systemMessageFactory?.({
          attachments: payload.attachments,
        });
        subSessionCalls.push({ ...payload, systemMessages });
        return {
          lifecycle: {
            executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
            executionKind: "agent",
            state: "completed",
            revision: 4,
            sequence: 4,
          },
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
        sessionId: "s-input-att",
        attachmentSource: "user",
        name: "合同.pdf",
        mimeType: "application/pdf",
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
  assert.equal(subSessionCalls[0]?.metadata?.inputAttachmentRefs, undefined);
  const nodeSystemMessages = String((subSessionCalls[0]?.systemMessages || []).join("\n\n"));
  assert.match(nodeSystemMessages, /用户原始附件/);
  assert.match(nodeSystemMessages, /合同\.pdf/);
  assert.match(nodeSystemMessages, /attachment:v1:s-input-att\/user\/att-user-1/);
  assert.doesNotMatch(nodeSystemMessages, /workspace|attachments\/s-input-att/);

  const semanticPrompt = String(semanticRequestMessages[0]?.content || "");
  assert.match(semanticPrompt, /用户附件/);
  assert.match(semanticPrompt, /identityRef=attachment:v1:s-input-att\/user\/att-user-1/);
  assert.doesNotMatch(semanticPrompt, /sessionId=|attachmentSource=/);
  assert.doesNotMatch(semanticPrompt, /ATTACHMENT id=/);
  assert.match(semanticPrompt, /attachments="user:\*"|identityRef=attachment:v1:/);
});
