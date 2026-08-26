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
  mutationResultsForTurn,
} from "../helpers/attachment-assertions.js";
import {
  modelInvocationTraces,
  readFileMutationRecords,
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
const EXTERNAL_AND_NATIVE_TOOLS = Object.freeze([
  "execute_native_script",
  "multimodal_parse",
  "multimodal_generate",
  "call_service",
  "web_search",
  "request_help",
  "call_mcp_task",
]);

async function assertGeneratedFilesConverged({
  page,
  userId,
  sessionId,
  turnScopeId,
  filePath = "runtime/ops_workdir/case036.txt",
}) {
  let executionResults = [];
  let persistedFiles = [];
  await expect
    .poll(
      async () => {
        const events = await readSessionExecutionEvents(userId, sessionId);
        executionResults = writeFileResultsForTurn(events, turnScopeId);
        const executionResult = executionResults[0]
          ? JSON.parse(String(executionResults[0].data.result || "{}"))
          : {};
        const executionMutationId = executionResult?.mutations?.[0]?.id || "";
        persistedFiles = (await readFileMutationRecords(userId, sessionId)).filter(
          (record) => record?.mutations?.[0]?.id === executionMutationId,
        );
        return {
          executionCount: executionResults.length,
          executionFileCount: executionResults.flatMap((record) => {
            const result = JSON.parse(String(record.data.result || ""));
            return Array.isArray(result?.mutations) ? result.mutations : [];
          }).length,
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

  const executionMutations = executionResults.flatMap((record) => {
    const result = JSON.parse(String(record.data.result || ""));
    return Array.isArray(result?.mutations) ? result.mutations : [];
  });
  expect(persistedFiles.map((record) => record.mutations[0].id).sort()).toEqual(
    executionMutations.map((mutation) => mutation.id).sort(),
  );
  await expect
    .poll(() => readRenderedFileNames(page), { timeout: 30000 })
    .toEqual(expect.arrayContaining([filePath]));
  expect(executionResults).toHaveLength(1);
}

async function assertFileMutationArtifacts(page, records, turnScopeId, filePath) {
  const writes = mutationResultsForTurn(records, turnScopeId, "write_file");
  const updates = mutationResultsForTurn(records, turnScopeId, "patch_file");
  expect(writes).toHaveLength(1);
  expect(updates).toHaveLength(1);

  const writeMutation = writes[0].result.mutations[0];
  const updateMutation = updates[0].result.mutations[0];
  expect(writeMutation).toMatchObject({
    path: filePath,
    operation: "create",
    before: { exists: false },
    after: { exists: true, isText: true },
  });
  expect(updateMutation).toMatchObject({
    path: filePath,
    operation: "update",
    aggregate: { revision: 1, diffCount: 1, path: filePath },
    before: { exists: true, isText: true },
    after: { exists: true, isText: true },
  });
  expect(updateMutation.diff).toMatchObject({ additions: 1, deletions: 1, changedLines: 2 });

  const artifactTabs = page.locator(".message-artifact-tabs").last();
  await expect(artifactTabs).toBeVisible();
  const writeTab = artifactTabs.getByRole("tab", { name: /文件写入|File Writes/i });
  const updateTab = artifactTabs.getByRole("tab", { name: /文件更新|File Updates/i });
  await expect(writeTab).toBeVisible();
  await expect(updateTab).toBeVisible();

  await writeTab.click();
  const writeCard = artifactTabs.locator(".el-tab-pane:visible .mutation-file-item");
  await expect(writeCard).toHaveCount(1);
  await writeCard.click();
  const writeDialog = page.locator(".generated-file-preview-dialog");
  await expect(writeDialog).toBeVisible();
  await expect(writeDialog.locator(".mutation-file-content")).toContainText("CASE036-TOOL-CONTENT");
  await writeDialog.locator(".el-dialog__headerbtn").click();
  await expect(writeDialog).toBeHidden();

  await updateTab.click();
  const updateCard = artifactTabs.locator(".el-tab-pane:visible .mutation-file-item");
  await expect(updateCard).toHaveCount(1);
  await updateCard.click();
  const updateDialog = page.locator(".generated-file-preview-dialog");
  await expect(updateDialog).toBeVisible();
  await expect(updateDialog.locator(".mutation-diff-split")).toBeVisible();
  await expect(updateDialog.locator(".mutation-diff-pane")).toHaveCount(2);
  await expect(updateDialog.locator(".mutation-diff-line.is-removed")).toHaveCount(1);
  await expect(updateDialog.locator(".mutation-diff-line.is-added")).toHaveCount(1);
  await expect(updateDialog.locator(".mutation-line-sign")).toContainText(["-", "+"]);
  await updateDialog.locator(".el-dialog__headerbtn").click();
  await expect(updateDialog).toBeHidden();
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
  const generatedFileName = `case036-${testInfo.testId}-${Date.now()}.txt`;
  const generatedFilePath = `runtime/ops_workdir/${generatedFileName}`;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "严格按顺序且每种只调用一次以下七个工具，不得调用任何其他工具：",
        "只能使用下面列出的七个规范工具名；不得发明、缩写、别名化或调用任何未列出的工具，尤其不得调用 `zz`。",
        `1) write_file 写 ${generatedFilePath}，内容 CASE036-TOOL-CONTENT，overwrite=true，riskLevel=low；`,
        `2) read_file 读取 ${generatedFilePath} 且不显示行号，riskLevel=low；`,
        "3) search 使用 source=text 在文本 CASE036-SEARCH-TARGET 中查 SEARCH-TARGET，riskLevel=low；",
        `4) patch_file 对 ${generatedFileName} 应用这个精确 unified diff，dryRun=false、root=runtime/ops_workdir、strip=1、riskLevel=low：--- a/${generatedFileName} +++ b/${generatedFileName} @@ -1 +1 @@ -CASE036-TOOL-CONTENT +CASE036-PATCH-CONTENT；`,
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
  await expect(interaction).toBeVisible({ timeout: 360000 });
  await expect(interaction.locator(".interaction-title")).toContainText("CASE036-INTERACTION");
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    filePath: generatedFilePath,
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
    filePath: generatedFilePath,
  });
  const pendingProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  expect(pendingProjectionAfterRefresh.map(({ event }) => event)).toEqual(
    pendingProjectionBeforeRefresh.map(({ event }) => event),
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
  await assertFileMutationArtifacts(
    noobot.page,
    records,
    command.identity.turnScopeId,
    generatedFilePath,
  );
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await assertFileMutationArtifacts(
    noobot.page,
    records,
    command.identity.turnScopeId,
    generatedFilePath,
  );
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
    filePath: generatedFilePath,
  });
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await expect(interaction).toBeHidden();
  const completedProjectionAfterRefresh = await readRealtimeToolProjection(noobot.page);
  await assertGeneratedFilesConverged({
    page: noobot.page,
    userId: noobot.userId,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    filePath: generatedFilePath,
  });
  expect(completedProjectionAfterRefresh.map(({ event }) => event)).toEqual(
    completedProjectionBeforeRefresh.map(({ event }) => event),
  );
  const detailProjection = await assertThinkingDetailsDrawer(noobot.page, EXPECTED_TOOLS.length);
  expect(detailProjection.slice(-REALTIME_EXECUTION_WINDOW_SIZE).map(({ event }) => event)).toEqual(
    completedProjectionAfterRefresh.map(({ event }) => event),
  );
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
        "2) multimodal_parse 解析上一步返回的 case036-native.svg 附件身份，model_name 使用 gpt_5_4，提示词为 Extract the exact visible text；",
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
