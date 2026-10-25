/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SERVICE_STARTUP_PROGRESS_STAGES } from "@noobot/runtime-events";

function describeFailure(userId, stage, error) {
  return {
    userId,
    stage,
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
  };
}

function collectLayoutUpgradeFailures(userId, layoutUpgrades = []) {
  const failures = [];
  for (const upgrade of layoutUpgrades) {
    if (upgrade.failed) {
      failures.push({ userId, stage: upgrade.id, ...upgrade.failed });
    }
    for (const unit of upgrade.result?.quarantined || []) {
      failures.push({
        userId,
        stage: upgrade.id,
        path: unit.path,
        quarantinePath: unit.quarantinePath,
        code: unit.error?.code || "",
        message: unit.error?.message || "",
      });
    }
  }
  return failures;
}

export async function prepareUserWorkspaces({ userIds, bot, reportProgress }) {
  const results = [];
  const failures = [];
  for (const [index, userId] of userIds.entries()) {
    const userProgress = { userId, userIndex: index + 1, userCount: userIds.length };
    try {
      const { report } = await bot.repairUserWorkspace(userId, {
        onProgress: (upgrade) =>
          reportProgress({
            ...userProgress,
            stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
            ...upgrade,
          }),
      });
      failures.push(...collectLayoutUpgradeFailures(userId, report?.layoutUpgrades));
    } catch (error) {
      failures.push(describeFailure(userId, "workspace", error));
      continue;
    }
    try {
      const result = await bot.session.maintainSessionDisplaySummaries({
        userId,
        onProgress: (summary) =>
          reportProgress({
            ...userProgress,
            stage: SERVICE_STARTUP_PROGRESS_STAGES.DISPLAY_SUMMARY,
            upgradeId: "",
            ...summary,
          }),
      });
      results.push(result);
      failures.push(...(result.failures || []).map((failure) => ({ userId, ...failure })));
    } catch (error) {
      failures.push(describeFailure(userId, "sessionDisplaySummary", error));
    }
  }
  return {
    userCount: userIds.length,
    rebuiltSessionCount: results.reduce(
      (count, result) => count + (result.rebuiltSessionIds?.length || 0),
      0,
    ),
    failures,
  };
}
