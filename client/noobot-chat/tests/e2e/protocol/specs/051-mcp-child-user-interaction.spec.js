/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { findProtocolObjects, waitForCaptured } from "../helpers/websocket-capture.js";
import { readSessionExecutionEventTree } from "../helpers/persistence-audit.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";

test("@core PBE-051 MCP 子 Session 的 user_interaction authority 闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(PROTOCOL_TIMEOUTS.toolChain);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "只调用一次 call_mcp_task，不得直接调用 user_interaction。",
        "mcpName 必须是 market_cmgjmcp。",
        "传给 MCP 子 Agent 的任务必须要求它先调用 user_interaction，交互内容必须是 CASE051-MCP-CHILD-INTERACTION，要求一个必填字段 verificationCode，显示名 Verification Code。",
        "子 Agent 收到交互结果后必须原样返回 verificationCode，不需要调用任何 MCP 业务工具。",
        "等待 MCP 子 Agent 完成后，主 Agent 原样回复它的结果。",
      ].join(" "),
    ),
  );

  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  const interactionRequest = await waitForCaptured(
    () =>
      findProtocolObjects(protocolCapture.websocketReceived).find(
        (event) =>
          event.event === "interaction_request" &&
          event.data?.payload?.content === "CASE051-MCP-CHILD-INTERACTION" &&
          event.data?.payload?.lifecycle === "pending",
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
  const childSessionId = String(interactionRequest.data?.identity?.sessionId || "").trim();
  expect(childSessionId).toBeTruthy();
  expect(childSessionId).not.toBe(noobot.sessionId);
  expect(interactionRequest.data?.payload?.dialogProcessId).toBeTruthy();

  const interaction = noobot.page.locator(".interaction-card");
  await expect(interaction).toBeVisible({ timeout: 60000 });
  await expect(interaction.locator(".interaction-title")).toContainText(
    "CASE051-MCP-CHILD-INTERACTION",
  );
  await interaction.locator(".el-input input").fill("CASE051-CHILD-VALUE");
  await interaction.locator(".el-button--primary").click();
  await expect(interaction).toBeHidden();

  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    timeoutMs: PROTOCOL_TIMEOUTS.model,
  });

  const events = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const childToolEvents = events.filter(
    (event) =>
      event.sessionId === childSessionId &&
      event.data?.tool === "user_interaction" &&
      ["tool_call_start", "tool_call_end"].includes(event.event),
  );
  expect(childToolEvents.map((event) => event.event)).toEqual(["tool_call_start", "tool_call_end"]);
  const result = String(childToolEvents.at(-1)?.data?.result || "");
  expect(result).toContain("CASE051-CHILD-VALUE");
  expect(result).not.toContain("session_not_found");
  const transportEvidence = [...protocolCapture.websocketReceived, ...protocolCapture.websocketSent]
    .map((record) => String(record?.payload || ""))
    .join("\n");
  expect(transportEvidence).not.toContain("interaction authority event commit failed");
  expect(transportEvidence).not.toContain("RECOVERABLE_TOOL_INVOKE_ERROR");
  expect(transportEvidence).not.toContain("session_not_found");
});
