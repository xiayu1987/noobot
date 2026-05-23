import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("AgentRuntimeFacade.buildRunTurnContext keeps runtime object reference for tool/model switch consistency", () => {
  const engine = new SessionExecutionEngine({});
  const runtime = { runtimeModel: "" };
  const agentContext = {
    execution: {
      controllers: {
        runtime,
      },
    },
    payload: {
      tools: {
        registry: [],
      },
    },
  };

  const abortSignal = { aborted: false };
  const out = engine.agentRuntimeFacade.buildRunTurnContext(agentContext, abortSignal);

  assert.equal(
    out.execution.controllers.runtime,
    runtime,
    "runtime 引用应保持一致，避免工具侧与模型侧状态分叉",
  );
  assert.equal(runtime.abortSignal, abortSignal);

  runtime.runtimeModel = "gpt_5_3_codex";
  assert.equal(
    out.execution.controllers.runtime.runtimeModel,
    "gpt_5_3_codex",
    "同一引用下，工具修改 runtimeModel 后模型侧可见",
  );
});
