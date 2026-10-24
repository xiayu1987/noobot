/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { readSessionTurnMessages } from "../helpers/persistence-audit.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-055 可恢复工具错误的 tool_result 进入 durable journal 且轮次正常完成", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "先调用一次 help 工具（不带参数），",
        '再调用一次 access_connector，参数为 {"connector_id":"probe","operation":"list","input":{}}；',
        "该调用预期失败，不要重试，直接用一句话说明失败原因作为最终回复。",
      ].join(""),
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
  });

  const messages = (await readSessionTurnMessages(noobot.userId, noobot.sessionId)).filter(
    (message) => message.turnScopeId === send.identity.turnScopeId,
  );
  const connectorCall = messages
    .filter((message) => message.role === "assistant" && Array.isArray(message.tool_calls))
    .flatMap((message) => message.tool_calls)
    .find((call) => call.function.name === "access_connector");
  expect(connectorCall, JSON.stringify(messages.map((m) => [m.role, m.type]))).toBeTruthy();
  const connectorResult = messages.find(
    (message) => message.role === "tool" && message.tool_call_id === connectorCall.id,
  );
  expect(connectorResult).toBeTruthy();
  expect(String(connectorResult.content)).toContain("RECOVERABLE_SELECTED_CONNECTOR_MISMATCH");
});
