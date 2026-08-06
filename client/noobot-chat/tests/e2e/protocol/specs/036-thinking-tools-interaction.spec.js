/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectPlugins,
  sendMessage,
  setHarnessCapability,
  setHarnessGuidanceAnalysisIntensity,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import {
  assertCanonicalToolPairs,
  assertRealtimeToolDetails,
  assertThinkingDetailsDrawer,
  observeRealtimeThinkingChanges,
  readRealtimeToolProjection,
  toolEventsForTurn,
  waitForToolSet,
} from "../helpers/thinking-tool-assertions.js";

const EXPECTED_TOOLS = Object.freeze([
  "write_file",
  "read_file",
  "search",
  "patch_file",
  "execute_script",
  "list_skills",
  "user_interaction",
]);
const REALTIME_EXECUTION_WINDOW_SIZE = 10;

test("@full PBE-036 全工具、实时思考明细与交互结果闭环", async ({ noobot, protocolCapture }, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", false);
  await setHarnessCapability(noobot.page, "Planning Acceptance", false);
  await setHarnessGuidanceAnalysisIntensity(noobot.page, 9);
  await sendMessage(noobot.page, uniquePrompt(testInfo, [
    "严格按顺序且每种只调用一次以下七个工具，不得调用任何其他工具：",
    "1) write_file 写 runtime/ops_workdir/case036.txt，内容 CASE036-TOOL-CONTENT，overwrite=true，riskLevel=low；",
    "2) read_file 读取该文件且不显示行号，riskLevel=low；",
    "3) search 使用 source=text 在文本 CASE036-SEARCH-TARGET 中查 SEARCH-TARGET，riskLevel=low；",
    "4) patch_file 对 case036.txt 做仅把 TOOL 改为 PATCH 的 unified diff，但 dryRun=true、root=runtime/ops_workdir、strip=1、riskLevel=low；",
    "5) execute_script 执行 printf CASE036-SCRIPT，foreground、riskLevel=low；",
    "6) list_skills 使用空参数；",
    "7) user_interaction 显示 CASE036-INTERACTION，并要求一个必填字段 verificationCode，显示名 Verification Code。",
    "收到交互返回后，最终回复必须同时包含 CASE036-UI-VALUE 和前述 read/search/script 的实际结果。",
  ].join(" ")));
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");

  const realtimeObservation = observeRealtimeThinkingChanges(noobot.page);
  const interaction = noobot.page.locator(".interaction-card");
  await expect(interaction).toBeVisible({ timeout: 180000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE036-INTERACTION");
  const shell = await realtimeObservation;
  await assertRealtimeToolDetails(shell, REALTIME_EXECUTION_WINDOW_SIZE);
  const pendingProjectionBeforeRefresh = await readRealtimeToolProjection(noobot.page);
  expect(pendingProjectionBeforeRefresh).toHaveLength(REALTIME_EXECUTION_WINDOW_SIZE);

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeVisible({ timeout: 60000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE036-INTERACTION");
  await expect(interaction.locator(".el-form-item__label")).toContainText("Verification Code");
  const pendingProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  expect(pendingProjectionAfterRefresh).toEqual(pendingProjectionBeforeRefresh);

  await interaction.locator(".el-input input").fill("CASE036-UI-VALUE");
  await interaction.locator(".el-button--primary").click();
  await expect(interaction).toBeHidden();

  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    timeoutMs: 240000,
  });
  const records = await waitForToolSet(
    noobot.userId,
    noobot.sessionId,
    command.identity.turnScopeId,
    EXPECTED_TOOLS,
  );
  const events = toolEventsForTurn(records, command.identity.turnScopeId);
  const { calls, results } = assertCanonicalToolPairs(events, EXPECTED_TOOLS);
  const interactionCall = calls.find((event) => event.data?.tool === "user_interaction");
  const interactionResult = results.find((event) => event.data?.toolCallId === interactionCall.data?.toolCallId);
  expect(interactionCall.data?.args).toMatchObject({ content: "CASE036-INTERACTION" });
  expect(String(interactionResult.data?.result)).toContain("CASE036-UI-VALUE");
  expect(String(results.find((event) => event.data?.tool === "read_file")?.data?.result)).toContain("CASE036-TOOL-CONTENT");
  expect(String(results.find((event) => event.data?.tool === "search")?.data?.result)).toContain("SEARCH-TARGET");

  const completedProjectionBeforeRefresh = await readRealtimeToolProjection(noobot.page);
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeHidden();
  const completedProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  expect(completedProjectionAfterRefresh).toEqual(completedProjectionBeforeRefresh);
  await assertThinkingDetailsDrawer(noobot.page, EXPECTED_TOOLS.length);
});
