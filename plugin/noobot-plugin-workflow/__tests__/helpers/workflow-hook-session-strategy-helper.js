/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";

import { createRegisterWorkflowHooks } from "../../src/core/hooks.js";
import { WORKFLOW_BOT_HOOK_POINTS, WORKFLOW_PLUGIN_DEFAULTS } from "../../src/core/constants.js";
import { resolveWorkflowNodeDialogProcessId } from "../../src/core/dialog-process-compat.js";
import {
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../../frontend/components/workflow-message-card/workflowDialogProcessIdCompat.js";

export function createMockBotHookManager() {
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



export function workflowDsl(lines = []) {
  return ["WORKFLOW_DSL/1", ...lines, "END"].join("\n");
}

export function simpleActionWorkflowDsl({
  nodeId = "act",
  nodeName = "节点A",
  task = "执行当前请求",
} = {}) {
  return workflowDsl([
    'NODE id=start type=state stateType=start name="开始"',
    `NODE id=${nodeId} type=action name="${nodeName}" task="${task}"`,
    'NODE id=end type=state stateType=end name="结束"',
    `EDGE from=start to=${nodeId}`,
    `EDGE from=${nodeId} to=end`,
  ]);
}

export function createCapabilityModelInvoker(output, calls = null) {
  return async (payload = {}) => {
    if (Array.isArray(calls)) calls.push(payload);
    return { output };
  };
}

export function createNodeResult(nodeName, overrides = {}) {
  return {
    sessionId: `session-${nodeName}`,
    dialogProcessId: `dialog-${nodeName}`,
    result: {
      answer: `answer-${nodeName}`,
      messages: [{ role: "assistant", content: `result-${nodeName}` }],
    },
    ...overrides,
  };
}

export function createRecordingSubSessionRunner(calls, { failNodeName = "", failMessage = "" } = {}) {
  return async (payload = {}) => {
    calls.push(payload);
    const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
    if (failNodeName && nodeName === failNodeName) {
      throw new Error(failMessage || `${nodeName}失败`);
    }
    return createNodeResult(nodeName);
  };
}

export function createAttachmentPersister({ prefix = "att", counterRef = { value: 0 } } = {}) {
  return async (payload = {}) => {
    counterRef.value += 1;
    const artifactName = String(payload?.artifacts?.[0]?.name || `result-${counterRef.value}.md`);
    return [
      {
        attachmentId: `${prefix}-${counterRef.value}`,
        name: artifactName,
        mimeType: "text/markdown",
        path: `/attachments/${artifactName}`,
      },
    ];
  };
}

export function createSemanticTransferTool({ prefix = "att", counterRef = { value: 0 } } = {}) {
  return {
    async transferSemanticContent({ scenario = "", strategy = "", messages = [] } = {}) {
      if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
        return { transferEnvelopes: [] };
      }
      counterRef.value += 1;
      const nodeName = String(messages?.[0]?.nodeName || `节点${counterRef.value}`).trim();
      const fileName = `workflow-node-${counterRef.value}-${nodeName}-result.md`;
      const envelope = {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        filePath: `/workspace/${fileName}`,
        files: [{
          role: "primary",
          filePath: `/workspace/${fileName}`,
          attachmentMeta: {
            attachmentId: `${prefix}-${counterRef.value}`,
            name: fileName,
            mimeType: "text/markdown",
            relativePath: `runtime/attach/${fileName}`,
          },
          pathView: { displayPath: `/workspace/${fileName}` },
        }],
      };
      return { transferEnvelopes: [envelope] };
    },
  };
}

export function createBaseContext(overrides = {}) {
  return {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请执行一个工作流",
    runConfig: { locale: "zh-CN" },
    ...overrides,
  };
}

export function createContextWithSharedTools(sharedTools = {}, overrides = {}) {
  return createBaseContext({
    agentContext: {
      execution: { controllers: { runtime: { sharedTools } } },
    },
    ...overrides,
  });
}

export function getBeforeDispatch(hookManager) {
  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  return beforeDispatch;
}

export async function runWorkflowHook({ options = {}, context = {} } = {}) {
  const hookManager = createMockBotHookManager();
  createRegisterWorkflowHooks()({ hookManager, options: { enabled: true, mode: "on", ...options } });
  const ctx = createBaseContext(context);
  await getBeforeDispatch(hookManager).handler(ctx);
  return { hookManager, ctx, agentResult: ctx.overrideAgentResult };
}

export function callsByNodeName(calls = []) {
  return new Map(calls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]));
}

export function workflowTurn(agentResult) {
  return (agentResult?.turnMessages || []).find((item) => item?.pluginMessage === true && item?.pluginMeta?.kind === "workflow");
}

export {
  createRegisterWorkflowHooks,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
};
