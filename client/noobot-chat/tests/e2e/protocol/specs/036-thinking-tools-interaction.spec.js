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
  readRenderedFileNames,
  writeFileResultsForTurn,
  attachmentKeys,
  transferAttachmentsForTurn,
} from "../helpers/attachment-assertions.js";
import {
  modelInvocationTraces,
  readAttachmentIndex,
  readSessionExecutionEventTree,
  readSessionExecutionEvents,
} from "../helpers/persistence-audit.js";
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
const GENERATED_FILE_NAME = "case036.txt";
const EXTERNAL_AND_NATIVE_TOOLS = Object.freeze([
  "execute_native_script",
  "multimodal_parse",
  "multimodal_generate",
  "call_service",
  "web_search",
  "request_help",
  "call_mcp_task",
]);

async function assertGeneratedFilesConverged({ page, userId, sessionId, turnScopeId }) {
  let executionResults = [];
  let persistedFiles = [];
  await expect
    .poll(
      async () => {
        const events = await readSessionExecutionEvents(userId, sessionId);
        executionResults = writeFileResultsForTurn(events, turnScopeId);
        const attachmentIndex = await readAttachmentIndex(userId, sessionId, "model");
        persistedFiles = Object.values(attachmentIndex?.attachments || {}).filter(
          (attachment) =>
            (attachment?.descriptor?.name || attachment?.name) === GENERATED_FILE_NAME,
        );
        return {
          executionCount: executionResults.length,
          executionFileCount: transferAttachmentsForTurn(executionResults, turnScopeId).length,
          persistedCount: persistedFiles.length,
        };
      },
      { timeout: 30000 },
    )
    .toEqual({
      executionCount: 1,
      executionFileCount: 1,
      persistedCount: 1,
    });

  const executionFiles = transferAttachmentsForTurn(executionResults, turnScopeId);
  expect(attachmentKeys(persistedFiles)).toEqual(attachmentKeys(executionFiles));
  await expect
    .poll(() => readRenderedFileNames(page), { timeout: 30000 })
    .toEqual([GENERATED_FILE_NAME]);
  expect(executionResults).toHaveLength((await readRenderedFileNames(page, {})).length);
}

test("@full PBE-036 全工具、实时思考明细与交互结果闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", false);
  await setHarnessCapability(noobot.page, "Planning Acceptance", false);
  await setHarnessGuidanceAnalysisIntensity(noobot.page, 9);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "严格按顺序且每种只调用一次以下七个工具，不得调用任何其他工具：",
        "只能使用下面列出的七个规范工具名；不得发明、缩写、别名化或调用任何未列出的工具，尤其不得调用 `zz`。",
        "1) write_file 写 runtime/ops_workdir/case036.txt，内容 CASE036-TOOL-CONTENT，overwrite=true，riskLevel=low；",
        "2) read_file 读取该文件且不显示行号，riskLevel=low；",
        "3) search 使用 source=text 在文本 CASE036-SEARCH-TARGET 中查 SEARCH-TARGET，riskLevel=low；",
        "4) patch_file 对 case036.txt 做仅把 TOOL 改为 PATCH 的 unified diff，但 dryRun=true、root=runtime/ops_workdir、strip=1、riskLevel=low；",
        "5) execute_script 执行 printf CASE036-SCRIPT，foreground、riskLevel=low；",
        "6) list_skills 使用空参数；",
        "7) user_interaction 显示 CASE036-INTERACTION，并要求一个必填字段 verificationCode，显示名 Verification Code。不得提前结束，必须执行到这个交互步骤。",
        "收到交互返回后，最终回复必须同时包含 CASE036-UI-VALUE 和前述 read/search/script 的实际结果。",
      ].join(" "),
    ),
  );
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");

  const realtimeObservation = observeRealtimeThinkingChanges(noobot.page);
  const interaction = noobot.page.locator(".interaction-card");
  await expect(interaction).toBeVisible({ timeout: 180000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE036-INTERACTION");
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });
  const shell = await realtimeObservation;
  await assertRealtimeToolDetails(shell, REALTIME_EXECUTION_WINDOW_SIZE);
  const pendingProjectionBeforeRefresh = await readRealtimeToolProjection(noobot.page);
  expect(pendingProjectionBeforeRefresh).toHaveLength(REALTIME_EXECUTION_WINDOW_SIZE);

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeVisible({ timeout: 60000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE036-INTERACTION");
  await expect(interaction.locator(".el-form-item__label")).toContainText("Verification Code");
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });
  const pendingProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  expect(pendingProjectionAfterRefresh.map(({ event, summary }) => ({ event, summary }))).toEqual(
    pendingProjectionBeforeRefresh.map(({ event, summary }) => ({ event, summary })),
  );

  await interaction.locator(".el-input input").fill("CASE036-UI-VALUE");
  const interactionSubmit = interaction.locator(".el-button--primary");
  await expect(interactionSubmit).toBeEnabled();
  await interactionSubmit.click();
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
  const interactionResult = results.find(
    (event) => event.data?.toolCallId === interactionCall.data?.toolCallId,
  );
  expect(interactionCall.data?.args).toMatchObject({ content: "CASE036-INTERACTION" });
  expect(String(interactionResult.data?.result)).toContain("CASE036-UI-VALUE");
  expect(String(results.find((event) => event.data?.tool === "read_file")?.data?.result)).toContain(
    "CASE036-TOOL-CONTENT",
  );
  expect(String(results.find((event) => event.data?.tool === "search")?.data?.result)).toContain(
    "SEARCH-TARGET",
  );

  const modelTraces = modelInvocationTraces(
    await readSessionExecutionEventTree(noobot.userId, noobot.sessionId),
  );
  expect(
    modelTraces.some(
      (trace) =>
        trace.data?.invocation?.purpose === "guidance" &&
        trace.data?.invocation?.flow === "plugin.analysis",
    ),
    "the scenario must execute the real Harness guidance analysis model flow",
  ).toBe(true);
  expect(
    modelTraces.some((trace) =>
      trace.data?.messages?.preview?.some(
        (message) => message.injectedMessageType === "separate_model_relay:guidance",
      ),
    ),
    "Harness guidance output must be relayed into a later provider model request",
  ).toBe(true);

  const completedProjectionBeforeRefresh = await readRealtimeToolProjection(noobot.page);
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeHidden();
  const completedProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
  });
  expect(completedProjectionAfterRefresh.map(({ event, summary }) => ({ event, summary }))).toEqual(
    completedProjectionBeforeRefresh.map(({ event, summary }) => ({ event, summary })),
  );
  expect(completedProjectionAfterRefresh.every(({ detail }) => detail === "")).toBe(true);
  const detailProjection = await assertThinkingDetailsDrawer(noobot.page, EXPECTED_TOOLS.length);
  expect(
    detailProjection
      .slice(-REALTIME_EXECUTION_WINDOW_SIZE)
      .map(({ event, summary }) => ({ event, summary })),
  ).toEqual(completedProjectionAfterRefresh.map(({ event, summary }) => ({ event, summary })));
});

test("@full PBE-043 普通用户原生、多模态与外部工具结果闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, []);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "严格按顺序且每种只调用一次以下七个工具；即使某个外部服务失败，也必须继续后续步骤，不得调用 switch_model：",
        '1) execute_native_script 不传输入，执行 await files.writeText(output.file(\'case036-native.svg\'), \'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><text x="10" y="45">CASE036-NATIVE</text></svg>\');；',
        "2) multimodal_parse 解析上一步返回的 case036-native.svg 附件身份，提示词为 Extract the exact visible text；",
        "3) multimodal_generate 生成一张简洁的红色正方形图片，n=1；",
        "4) call_service 调用 weather_service.get_weather，queryString.city=Shanghai，custom_param=j1；",
        "5) web_search 搜索 Noobot GitHub；",
        "6) request_help 使用 requestType=experience，helpContent=Summarize relevant tool-testing experience；",
        "7) call_mcp_task 调用 china-railway，任务为查询上海到苏州的可用能力；",
        "每一步必须等到工具返回后再继续。最终按七个工具的真实返回逐项报告成功或失败，不得把未调用的工具报告为已执行。",
      ].join(" "),
    ),
  );
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    timeoutMs: 720000,
  });

  let events = [];
  await expect
    .poll(
      async () => {
        const records = await readSessionExecutionEvents(noobot.userId, noobot.sessionId);
        events = toolEventsForTurn(records, command.identity.turnScopeId);
        return [
          ...new Set(
            events
              .filter((event) => event.event === "tool_call_start")
              .map((event) => event.data?.tool),
          ),
        ].sort();
      },
      { timeout: 30000 },
    )
    .toEqual([...EXTERNAL_AND_NATIVE_TOOLS].sort());

  const calls = events.filter((event) => event.event === "tool_call_start");
  const results = events.filter((event) => event.event === "tool_call_end");
  expect(calls).toHaveLength(EXTERNAL_AND_NATIVE_TOOLS.length);
  expect(results).toHaveLength(calls.length);
  expect(calls.some((event) => event.data?.tool === "switch_model")).toBe(false);
  for (const call of calls) {
    const result = results.find((event) => event.data?.toolCallId === call.data?.toolCallId);
    expect(result, `missing tool result for ${call.data?.tool}`).toBeTruthy();
    expect(result.data?.tool).toBe(call.data?.tool);
    expect(String(result.data?.result || result.data?.error || "").trim()).toBeTruthy();
  }
});
