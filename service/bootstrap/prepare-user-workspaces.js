/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SERVICE_STARTUP_PROGRESS_STAGES } from "@noobot/runtime-events";
import {
  isWorkspaceLayoutUpgradeFailure,
  listWorkspaceLayoutQuarantines,
} from "@noobot/workspace-protocol";
import { recoverServiceRestartTurns } from "./recover-service-restart-turns.js";

function describeFailure(userId, stage, error) {
  return {
    userId,
    stage,
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
  };
}

export async function prepareUserWorkspaces({
  userIds,
  bot,
  reportProgress,
  startupStorage,
  signal,
}) {
  const failures = [];
  let recoveredTurnCount = 0;
  for (const [index, userId] of userIds.entries()) {
    signal?.throwIfAborted();
    const userProgress = { userId, userIndex: index + 1, userCount: userIds.length };
    try {
      const { report } = await bot.repairUserWorkspace(userId, {
        startupStorage,
        signal,
        onProgress: (upgrade) =>
          reportProgress({
            ...userProgress,
            stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
            ...upgrade,
          }),
      });
      failures.push(
        ...listWorkspaceLayoutQuarantines(report.layoutUpgrades).map((unit) => ({
          userId,
          ...unit,
        })),
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (isWorkspaceLayoutUpgradeFailure(error)) {
        failures.push(...error.details.failures.map((failure) => ({ userId, ...failure })));
      } else {
        failures.push(describeFailure(userId, "workspace", error));
      }
      continue;
    }
    try {
      const recovery = await recoverServiceRestartTurns({
        bot,
        userId,
        onProgress: (progress) =>
          reportProgress({
            ...userProgress,
            stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
            upgradeId: "",
            ...progress,
          }),
      });
      recoveredTurnCount += recovery.recoveredSessionIds.length;
      failures.push(
        ...recovery.failures.map((failure) => ({
          userId,
          stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
          ...failure,
        })),
      );
    } catch (error) {
      failures.push(describeFailure(userId, SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY, error));
    }
  }
  return {
    userCount: userIds.length,
    recoveredTurnCount,
    failures,
  };
}
