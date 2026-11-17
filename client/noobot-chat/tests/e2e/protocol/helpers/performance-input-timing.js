/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export async function installPerformanceInputTiming(page) {
  await page.evaluate(() => {
    const clicks = new Map();
    const commands = new Map();
    window.noobotPerformanceInputTiming = commands;
    document.addEventListener(
      "click",
      (event) => {
        for (const selector of [".send-btn", ".stop-float-btn"]) {
          if (event.target.closest(selector)) {
            clicks.set(selector, { clickAtMs: performance.now(), eventAtMs: event.timeStamp });
          }
        }
      },
      true,
    );
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const sentAtMs = performance.now();
      const result = send.call(this, data);
      if (typeof data !== "string" || !data.startsWith("{")) return result;
      const command = JSON.parse(data);
      if (!["turn.send", "turn.continue", "turn.stop"].includes(command.commandType)) return result;
      if (commands.has(command.commandId)) return result;
      const selector = command.commandType === "turn.stop" ? ".stop-float-btn" : ".send-btn";
      commands.set(command.commandId, { ...clicks.get(selector), sentAtMs });
      clicks.delete(selector);
      return result;
    };
  });
}

export async function readPerformanceInputTiming(page, commandId) {
  const timing = await page.evaluate(
    (id) => window.noobotPerformanceInputTiming.get(id),
    commandId,
  );
  expect(timing?.clickAtMs, "browser must observe the real click").toBeGreaterThan(0);
  expect(timing.sentAtMs).toBeGreaterThanOrEqual(timing.clickAtMs);
  return {
    clock: "Browser performance.now; capture-phase click to WebSocket.send on the same page",
    ...timing,
    clickToCommandMs: timing.sentAtMs - timing.clickAtMs,
    eventToHandlerMs: timing.clickAtMs - timing.eventAtMs,
  };
}
