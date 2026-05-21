/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const cleanupIntervals = new Map();

export function ensureIntervalCleanupTask(
  name = "",
  task = () => {},
  intervalMs = 0,
  { unref = true } = {},
) {
  const taskName = String(name || "").trim();
  if (!taskName || typeof task !== "function") return null;
  const normalizedInterval = Number(intervalMs);
  if (!Number.isFinite(normalizedInterval) || normalizedInterval <= 0) return null;

  const existing = cleanupIntervals.get(taskName);
  if (existing?.timer) return existing.timer;

  const timer = setInterval(() => {
    try {
      task();
    } catch (error) {
      console.debug(`[harness] cleanup task failed (${taskName}): ${String(error?.message || error || "")}`);
    }
  }, normalizedInterval);

  if (unref && typeof timer?.unref === "function") {
    timer.unref();
  }

  cleanupIntervals.set(taskName, {
    timer,
    intervalMs: normalizedInterval,
  });
  return timer;
}

export function stopIntervalCleanupTask(name = "") {
  const taskName = String(name || "").trim();
  if (!taskName) return false;
  const existing = cleanupIntervals.get(taskName);
  if (!existing?.timer) return false;
  clearInterval(existing.timer);
  cleanupIntervals.delete(taskName);
  return true;
}

export function stopAllIntervalCleanupTasks() {
  for (const { timer } of cleanupIntervals.values()) {
    clearInterval(timer);
  }
  cleanupIntervals.clear();
}
