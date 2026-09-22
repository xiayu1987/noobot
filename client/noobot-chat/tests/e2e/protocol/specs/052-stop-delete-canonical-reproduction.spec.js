/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  deleteLatestUserMessage,
  selectPlugins,
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { waitForSessionExecutionEventTree, workspaceRoot } from "../helpers/persistence-audit.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import {
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";
import { toolEventsForTurn } from "../helpers/thinking-tool-assertions.js";

async function readTurnRecords(turnDirectory) {
  const files = (await fs.readdir(turnDirectory)).filter((file) => file.endsWith(".jsonl"));
  const records = [];
  for (const file of files) {
    const lines = await fs.readFile(path.join(turnDirectory, file), "utf8");
    for (const line of lines.split("\n").filter(Boolean)) records.push(JSON.parse(line));
  }
  return records;
}

test("@core PBE-052 回答显示后发送、锁失败、停止并删除的 canonical 复现", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(PROTOCOL_TIMEOUTS.model * 3);
  const pageErrors = [];
  noobot.page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  await selectPlugins(noobot.page, []);

  const turnDirectory = path.join(
    workspaceRoot(),
    noobot.userId,
    "runtime/session",
    noobot.sessionId,
    "turns",
  );
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

  const lockPath = path.join(
    workspaceRoot(),
    noobot.userId,
    "runtime/session/.lifecycle/locks",
    `${noobot.sessionId}.lock`,
  );
  const toolStartedMarker = path.join(
    workspaceRoot(),
    noobot.userId,
    "runtime/session",
    noobot.sessionId,
    "pbe052-tool-started",
  );
  const toolFinishedMarker = path.join(
    workspaceRoot(),
    noobot.userId,
    "runtime/session",
    noobot.sessionId,
    "pbe052-tool-finished",
  );
  const secondOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  const delayedCommand = `node -e "const fs=require('node:fs');fs.writeFileSync('${toolStartedMarker}','started');setTimeout(()=>{fs.writeFileSync('${toolFinishedMarker}','finished');console.log('PBE052-DURABLE')},8000)"`;
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
  await expect.poll(() => fs.readFile(toolStartedMarker, "utf8").catch(() => "")).toBe("started");

  await expect
    .poll(async () => {
      const records = await readTurnRecords(turnDirectory);
      const messages = records
        .map((record) => record?.message)
        .filter((message) => message?.turnScopeId === secondSend.identity.turnScopeId);
      return {
        assistant: messages.some((message) => message.role === "assistant"),
        user: messages.some((message) => message.role === "user"),
      };
    })
    .toEqual({ assistant: true, user: true });

  await expect
    .poll(async () => {
      try {
        await fs.mkdir(lockPath);
        await fs.writeFile(path.join(lockPath, "owner"), `${process.pid}:e2e-lock-failure`, "utf8");
        return true;
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
    })
    .toBe(true);
  const lockDirectory = path.dirname(lockPath);
  const settledWaiterPattern = new RegExp(
    `^${path.basename(lockPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.wait-\\d+-`,
  );
  try {
    const earlierWaiters = new Set(
      (await fs.readdir(lockDirectory)).filter((name) => settledWaiterPattern.test(name)),
    );
    await expect
      .poll(() => fs.readFile(toolFinishedMarker, "utf8").catch(() => ""))
      .toBe("finished");
    const observedWaiters = new Set(earlierWaiters);
    const timeoutWaiters = [];
    for (let timeoutIndex = 0; timeoutIndex < 2; timeoutIndex += 1) {
      await expect
        .poll(
          async () => {
            const names = await fs.readdir(lockDirectory);
            for (const name of names) {
              if (!settledWaiterPattern.test(name) || observedWaiters.has(name)) continue;
              observedWaiters.add(name);
              timeoutWaiters.push(name);
            }
            return timeoutWaiters.length > timeoutIndex;
          },
          { timeout: PROTOCOL_TIMEOUTS.model },
        )
        .toBe(true);
      const observedWaiter = timeoutWaiters[timeoutIndex];
      await expect
        .poll(
          () =>
            fs
              .access(path.join(lockDirectory, observedWaiter))
              .then(() => true)
              .catch(() => false),
          { timeout: 60000 },
        )
        .toBe(false);
    }
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
    await fs.rm(toolStartedMarker, { force: true });
    await fs.rm(toolFinishedMarker, { force: true });
  }

  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) => {
      const scoped = records.filter(
        (record) => record.turnScopeId === secondSend.identity.turnScopeId,
      );
      return (
        scoped.some(
          (record) =>
            record.event === "tool_call_end" &&
            record.data?.tool === "execute_script" &&
            record.data?.success === false &&
            /lock|mutation|busy|timeout/i.test(String(record.data?.result || "")),
        ) &&
        scoped.some(
          (record) =>
            record.event === "turn_orchestrator_error" &&
            /lock|mutation|busy|timeout/i.test(String(record.data?.message || "")),
        )
      );
    },
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );

  await expect
    .poll(async () => {
      const records = await readTurnRecords(turnDirectory);
      const messages = records
        .map((record) => record?.message)
        .filter((message) => message?.turnScopeId === secondSend.identity.turnScopeId);
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
      const records = await readTurnRecords(turnDirectory);
      return records.some(
        (record) => record?.message?.turnScopeId === thirdSend.identity.turnScopeId,
      );
    })
    .toBe(true);

  await deleteLatestUserMessage(noobot.page);
  expect(pageErrors.filter((message) => message.includes("multiple canonical"))).toEqual([]);

  await expect
    .poll(async () => {
      const records = await readTurnRecords(turnDirectory);
      return records.some(
        (record) => record?.message?.turnScopeId === thirdSend.identity.turnScopeId,
      );
    })
    .toBe(false);

  await expect
    .poll(async () => {
      const records = await readTurnRecords(turnDirectory);
      const firstTurnAssistants = records.filter(
        (record) =>
          record?.message?.role === "assistant" &&
          record.message.turnScopeId === firstSend.identity.turnScopeId,
      );
      return {
        assistantCount: firstTurnAssistants.length,
        canonicalCount: firstTurnAssistants.filter(
          (record) => record.message.chatPresentation === true,
        ).length,
      };
    })
    .toEqual({ assistantCount: 3, canonicalCount: 1 });
});
