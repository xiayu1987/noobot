/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_CONTROL_ROLE,
  projectToolDefinitionContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { collectLatestCheckpointEvidenceMessageIndexes } from "@noobot/context-protocol/policy/summary";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { createTaskCheckTool } from "../../../src/tools/collaboration/task-check-tool.js";
import { buildAssistantModelMessageForToolCalls } from "../../../src/runtime/turn/tool-call-message.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

function createFlowControlToolMap() {
  const runtime = createTestRuntimeContext({ systemRuntime: {} });
  const agentContext = createTestAgentExecutionScope(runtime);
  const tools = [...createTaskCheckTool({ agentContext })];
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function assistantToolCallMessage(toolMap, name, id) {
  const call = projectToolDefinitionContextPolicy({ id, name, args: {} }, toolMap.get(name));
  return buildAssistantModelMessageForToolCalls({
    toolCalls: [call],
    messageUid: createMessageUid(),
    modelMessageId: `model-${id}`,
  });
}

test("flow-control tool definitions project their declared role onto model tool calls", () => {
  const toolMap = createFlowControlToolMap();
  const evidence = assistantToolCallMessage(toolMap, "task_check", "call-check");

  assert.equal(
    evidence.tool_calls[0].contextPolicy.flowControlRole,
    FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE,
  );
  assert.equal(toolMap.has("task_summary"), false);
  const messages = [evidence];
  assert.deepEqual([...collectLatestCheckpointEvidenceMessageIndexes(messages)], [0]);
});

test("ordinary tool definitions do not gain a context policy", () => {
  const call = projectToolDefinitionContextPolicy(
    { id: "call-1", name: "read_file", args: {} },
    { name: "read_file", metadata: {} },
  );
  assert.equal(Object.hasOwn(call, "contextPolicy"), false);
});
