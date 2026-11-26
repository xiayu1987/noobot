/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { holdSessionLock } from "../../../../../../agent/__tests__/helpers/session-lock-process.js";
import { nodeScriptCommand } from "../../../../../../agent/__tests__/helpers/node-script-command.js";
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  deleteLatestUserMessage,
  selectPlugins,
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  readSessionRuntimeEvents,
  readSessionTurnMessages,
  waitForSessionExecutionEventTree,
  workspaceRoot,
} from "../helpers/persistence-audit.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import {
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";
import { toolEventsForTurn } from "../helpers/thinking-tool-assertions.js";
import { runOpsWorkdir } from "../helpers/run-ops-workdir.js";

async function readMarker(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("@core PBE-052 回答显示后发送、锁失败、停止并删除的 canonical 复现", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(PROTOCOL_TIMEOUTS.model * 3);
  const pageErrors = [];
  noobot.page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  await selectPlugins(noobot.page, []);

  const firstOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  const firstDelayedCommand = `node -e "setTimeout(()=>console.log('PBE052-FIRST'),1000)"`;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `Call execute_script once with this exact command and wait for it before replying: ${firstDelayedCommand}`,
    ),
  );
  const firstSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    firstOffset,
  );
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    firstSend.identity.turnScopeId,
  );

  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      toolEventsForTurn(records, firstSend.identity.turnScopeId).some(
        (record) => record.event === "tool_call_start" && record.data?.tool === "execute_script",
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      toolEventsForTurn(records, firstSend.identity.turnScopeId).some(
        (record) =>
          record.event === "tool_call_end" &&
          record.data?.tool === "execute_script" &&
          record.data?.success === true,
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );

  const followupOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, "下一条普通消息：继续。");
  await waitForCommand(protocolCapture, noobot.sessionId, "turn.interject", followupOffset);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: firstSend.identity.turnScopeId,
    timeoutMs: PROTOCOL_TIMEOUTS.model,
  });

  const firstTurnAssistants = (
    await readSessionTurnMessages(noobot.userId, noobot.sessionId)
  ).filter(
    (message) =>
      message?.role === "assistant" && message.turnScopeId === firstSend.identity.turnScopeId,
  );
  expect(firstTurnAssistants.length).toBeGreaterThan(0);
  expect(firstTurnAssistants.filter((message) => message.chatPresentation === true)).toHaveLength(
    1,
  );

  const lockPath = path.join(
    workspaceRoot(),
    noobot.userId,
    WORKSPACE_LAYOUT.SESSION_LIFECYCLE_LOCKS_DIR,
    `${noobot.sessionId}.lock`,
  );
  const toolStartedMarker = path.join(
    workspaceRoot(),
    noobot.userId,
    WORKSPACE_LAYOUT.SESSION_DIR,
    noobot.sessionId,
    "pbe052-tool-started",
  );
  const toolFinishedMarker = path.join(
    workspaceRoot(),
    noobot.userId,
    WORKSPACE_LAYOUT.SESSION_DIR,
    noobot.sessionId,
    "pbe052-tool-finished",
  );
  const secondOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  const commandDirectory = path.join(workspaceRoot(), noobot.userId, runOpsWorkdir());
  await fs.mkdir(commandDirectory, { recursive: true });
  const delayedCommand = await nodeScriptCommand(
    commandDirectory,
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(toolStartedMarker)},'started');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(toolFinishedMarker)},'finished');console.log('PBE052-DURABLE')},8000)`,
  );
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `Call execute_script once with this exact command and wait for it before replying: ${delayedCommand}`,
    ),
  );
  const secondSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    secondOffset,
  );
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    secondSend.identity.turnScopeId,
  );
  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      toolEventsForTurn(records, secondSend.identity.turnScopeId).some(
        (record) => record.event === "tool_call_start" && record.data?.tool === "execute_script",
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
  await expect.poll(() => readMarker(toolStartedMarker)).toBe("started");

  await expect
    .poll(async () => {
      const messages = (await readSessionTurnMessages(noobot.userId, noobot.sessionId)).filter(
        (message) => message?.turnScopeId === secondSend.identity.turnScopeId,
      );
      return {
        assistant: messages.some((message) => message.role === "assistant"),
        user: messages.some((message) => message.role === "user"),
      };
    })
    .toEqual({ assistant: true, user: true });

  const releaseLock = await holdSessionLock(lockPath);
  try {
    await expect.poll(() => readMarker(toolFinishedMarker)).toBe("finished");
    await expect
      .poll(
        async () =>
          (await readSessionRuntimeEvents(noobot.userId, noobot.sessionId)).some(
            (record) =>
              record.event === "run_session_failed" &&
              record.data?.extra?.code === "SESSION_MUTATION_BUSY",
          ),
        { timeout: PROTOCOL_TIMEOUTS.model },
      )
      .toBe(true);
  } finally {
    await releaseLock();
    await fs.rm(toolStartedMarker, { force: true });
    await fs.rm(toolFinishedMarker, { force: true });
  }

  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      records.some(
        (record) =>
          record.turnScopeId === secondSend.identity.turnScopeId &&
          record.event === "turn_orchestrator_error" &&
          record.data?.error?.code === "SESSION_MUTATION_BUSY",
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
  const failedTurn = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.failed",
    0,
    secondSend.identity.turnScopeId,
  );
  expect(failedTurn.failure.code).toBe("SESSION_MUTATION_BUSY");

  await expect
    .poll(async () => {
      const messages = (await readSessionTurnMessages(noobot.userId, noobot.sessionId)).filter(
        (message) => message?.turnScopeId === secondSend.identity.turnScopeId,
      );
      return {
        assistant: messages.some((message) => message.role === "assistant"),
        user: messages.some((message) => message.role === "user"),
      };
    })
    .toEqual({ assistant: true, user: true });

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);

  const thirdOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "第三轮。"));
  const thirdSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    thirdOffset,
  );
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    thirdSend.identity.turnScopeId,
  );
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    thirdSend.identity.turnScopeId,
  );

  await expect
    .poll(async () => {
      const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
      return messages.some((message) => message.turnScopeId === thirdSend.identity.turnScopeId);
    })
    .toBe(true);

  await deleteLatestUserMessage(noobot.page);
  expect(pageErrors.filter((message) => message.includes("multiple canonical"))).toEqual([]);

  await expect
    .poll(async () => {
      const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
      return messages.some((message) => message.turnScopeId === thirdSend.identity.turnScopeId);
    })
    .toBe(false);

  await expect
    .poll(async () => {
      return (await readSessionTurnMessages(noobot.userId, noobot.sessionId)).filter(
        (message) =>
          message?.role === "assistant" && message.turnScopeId === firstSend.identity.turnScopeId,
      );
    })
    .toEqual(firstTurnAssistants);
});
