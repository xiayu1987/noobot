/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readMessageDelta, readToolFrame } from "./turn-events.js";

export function createRenderer(format, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let streamedAny = false;
  const writeLine = (stream, value) => stream.write(`${JSON.stringify(value)}\n`);

  return {
    event(packet) {
      if (format === "stream-json") {
        writeLine(stdout, packet);
        return;
      }
      if (format !== "text") return;
      const delta = readMessageDelta(packet);
      if (delta) {
        streamedAny = true;
        stdout.write(delta);
        return;
      }
      const tool = readToolFrame(packet);
      if (tool?.phase === "start") stderr.write(`\n[tool] ${tool.name}\n`);
      else if (tool?.phase === "end" && !tool.success) stderr.write(`[tool] ${tool.name} failed\n`);
    },
    notice(message) {
      if (format === "stream-json") writeLine(stdout, { type: "notice", message });
      else stderr.write(`[noobot] ${message}\n`);
    },
    result(result) {
      if (format === "stream-json") {
        writeLine(stdout, { type: "result", ...result });
      } else if (format === "json") {
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        if (!streamedAny && result.content) stdout.write(result.content);
        stdout.write("\n");
        if (result.exitCode !== 0) {
          stderr.write(`[noobot] turn ${result.status} (session ${result.sessionId})\n`);
        }
      }
    },
  };
}

export function buildResult({ tracker, outcome, exitCode }) {
  const { state } = tracker;
  return {
    sessionId: state.sessionId,
    turnScopeId: state.turnScopeId,
    dialogProcessId: state.dialogProcessId,
    status: outcome.reason || "closed",
    lifecycleEvent: state.lifecycleEvent,
    exitCode,
    content: tracker.content(),
    ...(state.failure ? { failure: state.failure } : {}),
  };
}
