/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const TOP_SCRIPT_LIMIT = QUANTITY_THRESHOLDS.client.frameHealthTopScriptLimit;

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function supportedEntryTypes() {
  const types = globalThis.PerformanceObserver?.supportedEntryTypes;
  return Array.isArray(types) ? types : [];
}

function summarizeScript(script = {}) {
  return {
    durationMs: roundMs(Number(script.duration)),
    invoker: String(script.invoker || ""),
    sourceFunctionName: String(script.sourceFunctionName || ""),
    sourceURL: String(script.sourceURL || ""),
  };
}

export function createFrameHealthSampler() {
  let kind = "";
  let entries = [];

  function start() {
    if (kind) return;
    const types = supportedEntryTypes();
    const entryType = types.includes("long-animation-frame")
      ? "long-animation-frame"
      : types.includes("longtask")
        ? "longtask"
        : "";
    kind = entryType || "unsupported";
    if (!entryType) return;
    try {
      const observer = new globalThis.PerformanceObserver((list) => {
        entries.push(...list.getEntries());
      });
      observer.observe({ type: entryType, buffered: false });
    } catch {
      kind = "unsupported";
    }
  }

  function drain() {
    const drained = entries;
    entries = [];
    let maxMs = 0;
    let totalMs = 0;
    let maxBlockingMs = 0;
    let scriptMs = 0;
    let renderMs = 0;
    let styleLayoutMs = 0;
    const scripts = [];
    for (const entry of drained) {
      const duration = Number(entry?.duration) || 0;
      const end = (Number(entry?.startTime) || 0) + duration;
      maxMs = Math.max(maxMs, duration);
      totalMs += duration;
      maxBlockingMs = Math.max(maxBlockingMs, Number(entry?.blockingDuration) || 0);
      if (Number(entry?.renderStart) > 0) renderMs += end - Number(entry.renderStart);
      if (Number(entry?.styleAndLayoutStart) > 0) {
        styleLayoutMs += end - Number(entry.styleAndLayoutStart);
      }
      for (const script of Array.isArray(entry?.scripts) ? entry.scripts : []) {
        scriptMs += Number(script?.duration) || 0;
        scripts.push(script);
      }
    }
    scripts.sort((left, right) => Number(right?.duration || 0) - Number(left?.duration || 0));
    return {
      kind,
      longFrameCount: drained.length,
      maxMs: roundMs(maxMs),
      totalMs: roundMs(totalMs),
      maxBlockingMs: roundMs(maxBlockingMs),
      scriptMs: roundMs(scriptMs),
      renderMs: roundMs(renderMs),
      styleLayoutMs: roundMs(styleLayoutMs),
      topScripts: scripts.slice(0, TOP_SCRIPT_LIMIT).map(summarizeScript),
    };
  }

  return { start, drain };
}
