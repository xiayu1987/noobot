/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { selectPlugins, sendMessage } from "../helpers/browser-actions.js";
import { waitForCommand, waitForTurnTerminal } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { toolEventsForTurn, waitForToolSet } from "../helpers/thinking-tool-assertions.js";

test("@core PBE-037 user_interaction timeout closes the real modal and is not replayed", async ({ noobot, protocolCapture }, testInfo) => {
  test.setTimeout(180000);
  await selectPlugins(noobot.page, ["harness"]);
  await sendMessage(noobot.page, uniquePrompt(testInfo, [
    "只调用一次 user_interaction 工具，不得调用任何其他工具。",
    "交互内容必须是 CASE037-TIMEOUT，要求一个必填字段 verificationCode。",
    "不要等待用户输入，交互超时后直接结束本轮并返回失败原因。",
  ].join(" ")));

  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  const interaction = noobot.page.locator(".interaction-card");
  await expect(interaction).toBeVisible({ timeout: 60000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE037-TIMEOUT");
  // The terminal lifecycle timeout is measured by the service from request
  // creation; the card becomes visible only after websocket delivery. Allow
  // transport/startup latency while keeping the authoritative lifecycle
  // assertion unchanged.
  await expect(interaction).toBeHidden({ timeout: 60000 });

  await waitForTurnTerminal(
    protocolCapture,
    noobot.sessionId,
    command.identity.turnScopeId,
    { timeoutMs: 60000 },
  );
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeHidden();

  const records = await waitForToolSet(
    noobot.userId,
    noobot.sessionId,
    command.identity.turnScopeId,
    ["user_interaction"],
  );
  const events = toolEventsForTurn(records, command.identity.turnScopeId);
  const result = events.find((event) => event.event === "tool_call_end" && event.data?.tool === "user_interaction");
  expect(String(result?.data?.result || "")).toMatch(/timeout|超时/i);
});
