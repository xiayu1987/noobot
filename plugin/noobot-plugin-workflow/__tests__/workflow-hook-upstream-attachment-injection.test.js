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

test("workflow hook injects upstream node result attachments into downstream sub-session system messages", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticTransferCalls = [];
  let artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=branch type=state stateType=branch name="并发分叉"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=branch2 type=state stateType=branch name="汇聚后并发分叉"',
          'NODE id=d type=action name="节点D" task="执行D"',
          'NODE id=e type=action name="节点E" task="执行E"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=branch",
          "EDGE from=branch to=b",
          "EDGE from=branch to=c",
          "EDGE from=b to=merge",
          "EDGE from=c to=merge",
          "EDGE from=merge to=branch2",
          "EDGE from=branch2 to=d",
          "EDGE from=branch2 to=e",
          "EDGE from=d to=end",
          "EDGE from=e to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        artifactCounter += 1;
        const artifactName = String(payload?.artifacts?.[0]?.name || `result-${artifactCounter}.md`);
        return [
          {
            attachmentId: `att-${artifactCounter}`,
            name: artifactName,
            mimeType: "text/markdown",
            path: `/attachments/${artifactName}`,
          },
        ];
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-upstream",
    dialogProcessId: "d-upstream",
    userMessage: "请运行带并发和汇聚的流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent(payload = {}) {
                  semanticTransferCalls.push(payload);
                  const { scenario = "", strategy = "", messages = [] } = payload;
                  if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
                    return {
                      transferEnvelopes: [],
                    };
                  }
                  artifactCounter += 1;
                  const nodeName = String(messages?.[0]?.nodeName || `节点${artifactCounter}`).trim();
                  const fileName = `workflow-node-${artifactCounter}-${nodeName}-result.md`;
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: `/workspace/${fileName}`,
                    files: [
                      {
                        role: "primary",
                        filePath: `/workspace/${fileName}`,
                        attachmentMeta: {
                          attachmentId: `att-${artifactCounter}`,
                          name: fileName,
                          mimeType: "text/markdown",
                          relativePath: `runtime/attach/${fileName}`,
                        },
                        pathView: {
                          displayPath: `/workspace/${fileName}`,
                        },
                      },
                    ],
                  };
                  return {
                    transferEnvelopes: [envelope],
                    injectionMessage: String(payload?.content || ""),
                  };
                },
              },
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
  assert.equal(subSessionCalls.length, 5);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /上游工作流节点结果附件/);
  assert.match(nodeBSystem, /节点A/);
  assert.match(nodeBSystem, /att-1|workflow-node-1-节点A-result\.md/);
  assert.match(nodeCSystem, /节点A/);

  const nodeDSystem = String(callByNodeName.get("节点D")?.systemMessages?.[0] || "");
  assert.match(nodeDSystem, /节点B/);
  assert.match(nodeDSystem, /节点C/);
  assert.doesNotMatch(nodeDSystem, /节点A \/ workflow-node-1-节点A-result\.md/);

  const nodeESystem = String(callByNodeName.get("节点E")?.systemMessages?.[0] || "");
  assert.match(nodeESystem, /节点B/);
  assert.match(nodeESystem, /节点C/);
  assert.doesNotMatch(nodeESystem, /节点A \/ workflow-node-1-节点A-result\.md/);
  assert.equal(
    semanticTransferCalls.some(
      (item = {}) => String(item?.strategy || "") === "bot_plugin_upstream_injection",
    ),
    true,
  );
});




test("workflow hook injects one upstream action attachments into multiple direct downstream action nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  let artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=b",
          "EDGE from=a to=c",
          "EDGE from=b to=end",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        artifactCounter += 1;
        const artifactName = String(payload?.artifacts?.[0]?.name || `result-${artifactCounter}.md`);
        return [
          {
            attachmentId: `fanout-att-${artifactCounter}`,
            name: artifactName,
            mimeType: "text/markdown",
            path: `/attachments/${artifactName}`,
          },
        ];
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-fanout",
    dialogProcessId: "d-fanout",
    userMessage: "请运行直接多下游流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent({ scenario = "", strategy = "", messages = [] } = {}) {
                  if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
                    return {
                      transferEnvelopes: [],
                    };
                  }
                  artifactCounter += 1;
                  const nodeName = String(messages?.[0]?.nodeName || `节点${artifactCounter}`).trim();
                  const fileName = `workflow-node-${artifactCounter}-${nodeName}-result.md`;
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: `/workspace/${fileName}`,
                    files: [
                      {
                        role: "primary",
                        filePath: `/workspace/${fileName}`,
                        attachmentMeta: {
                          attachmentId: `fanout-att-${artifactCounter}`,
                          name: fileName,
                          mimeType: "text/markdown",
                          relativePath: `runtime/attach/${fileName}`,
                        },
                        pathView: {
                          displayPath: `/workspace/${fileName}`,
                        },
                      },
                    ],
                  };
                  return {
                    transferEnvelopes: [envelope],
                  };
                },
              },
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
  assert.equal(subSessionCalls.length, 3);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /节点A/);
  assert.match(nodeBSystem, /fanout-att-1|workflow-node-1-节点A-result\.md/);
  assert.match(nodeCSystem, /节点A/);
  assert.match(nodeCSystem, /fanout-att-1|workflow-node-1-节点A-result\.md/);
});


