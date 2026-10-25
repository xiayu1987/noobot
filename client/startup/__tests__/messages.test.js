/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { formatUpgradeProgress, startupMessages } from "../src/locales/messages.js";

const layoutProgress = {
  userId: "admin",
  userIndex: 1,
  userCount: 2,
  stage: "layoutUpgrade",
  upgradeId: "session-storage-v13",
  upgradeIndex: 2,
  upgradeCount: 3,
  processedSessions: 37,
};
const summaryProgress = {
  userId: "admin",
  userIndex: 2,
  userCount: 2,
  stage: "displaySummary",
  upgradeId: "",
  sessionIndex: 5,
  sessionCount: 9,
};

test("layout upgrade progress renders in both languages", () => {
  assert.equal(
    formatUpgradeProgress(startupMessages["zh-CN"].status, layoutProgress),
    "正在升级工作区数据：用户 1/2，步骤 2/3，已处理 37 个会话...",
  );
  assert.equal(
    formatUpgradeProgress(startupMessages["en-US"].status, layoutProgress),
    "Upgrading workspace data: user 1/2, step 2/3, 37 sessions processed...",
  );
});

test("display summary progress renders in both languages", () => {
  assert.equal(
    formatUpgradeProgress(startupMessages["zh-CN"].status, summaryProgress),
    "正在重建会话摘要：用户 2/2，会话 5/9...",
  );
  assert.equal(
    formatUpgradeProgress(startupMessages["en-US"].status, summaryProgress),
    "Rebuilding session summaries: user 2/2, session 5/9...",
  );
});

test("every upgrade template placeholder is supplied by its stage progress", () => {
  const placeholders = (template) => [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  for (const [language, { status }] of Object.entries(startupMessages)) {
    for (const [template, progress] of [
      [status.upgradingLayout, layoutProgress],
      [status.upgradingSummaries, summaryProgress],
    ]) {
      for (const key of placeholders(template)) {
        assert.ok(
          key in progress,
          `${language} template placeholder {${key}} has no progress field`,
        );
      }
    }
  }
});

test("stalled upgrade appends a stable minute-granular warning in both languages", () => {
  assert.equal(
    formatUpgradeProgress(startupMessages["zh-CN"].status, layoutProgress, 6),
    "正在升级工作区数据：用户 1/2，步骤 2/3，已处理 37 个会话..." +
      "已 6+ 分钟无进展，可能停滞。可查看服务日志、继续等待或退出。",
  );
  assert.equal(
    formatUpgradeProgress(startupMessages["en-US"].status, summaryProgress, 6),
    "Rebuilding session summaries: user 2/2, session 5/9..." +
      " No progress for 6+ min; it may be stalled. Check the service log, keep waiting, or quit.",
  );
  assert.equal(
    formatUpgradeProgress(startupMessages["en-US"].status, summaryProgress, 0),
    "Rebuilding session summaries: user 2/2, session 5/9...",
  );
});
