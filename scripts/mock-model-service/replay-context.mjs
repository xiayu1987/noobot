/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { performanceRound } from "./performance-contract.mjs";

function readReplayProgress(messages, serialized, { evidenceStart, filePath, turnKey }) {
  let completed = 0;
  const results = new Set();
  for (const [offset, item] of messages.slice(evidenceStart).entries()) {
    const text = typeof item.content === "string" ? item.content : "";
    const progress = serialized[evidenceStart + offset].includes(`NOOBOT_PERF_CASE:${filePath}`)
      ? [...text.matchAll(/NOOBOT_PERF_PROGRESS:(\d+)/g)].map((match) => Number(match[1]))
      : [];
    completed = Math.max(completed, ...progress);
    const observer = text.match(
      /^Tool result \[(perf_step_\d+_[a-f0-9]{8})\] \(matching tool result of the executed call above\):\n([\s\S]*)$/,
    );
    const id = item.role === "tool" ? item.tool_call_id : observer?.[1];
    const match = id?.match(new RegExp(`^perf_step_(\\d+)_${turnKey}$`));
    if (!match) continue;
    const result = JSON.parse(observer ? observer[2] : text);
    if (result.ok !== true) throw new TypeError(`Performance tool failed: ${id}`);
    results.add(Number(match[1]));
  }
  while (results.has(completed + 1)) completed += 1;
  if ([...results].some((step) => step > completed))
    throw new TypeError("Non-contiguous performance tool results");
  return completed;
}

export function readReplayContext(messages) {
  const serialized = messages.map((message) => JSON.stringify(message));
  const start = serialized.findLastIndex(
    (content, index) =>
      messages[index].role === "user" &&
      content.includes("NOOBOT_PERF_CASE:") &&
      !content.includes("NOOBOT_PERF_PROGRESS:"),
  );
  const evidenceStart =
    start >= 0 ? start : serialized.findIndex((content) => content.includes("NOOBOT_PERF_CASE:"));
  if (evidenceStart < 0) throw new TypeError("Missing performance replay context");
  const content = serialized[evidenceStart];
  const filePath = content.match(/NOOBOT_PERF_CASE:([A-Za-z0-9_./-]+)/)?.[1];
  if (
    !filePath ||
    !/^runtime\/ops_workdir\/e2e-[A-Za-z0-9_-]+\/perf-(?:stop-)?[1-9]\d*\.txt$/.test(filePath)
  )
    throw new TypeError("Invalid performance scenario path");
  const round = Number(content.match(/NOOBOT_PERF_ROUND:(\d+)/)?.[1]);
  const plan = performanceRound(round);
  const connectorId = content.match(/NOOBOT_PERF_CONNECTOR:([A-Za-z0-9_-]+)/)?.[1];
  if (!connectorId) throw new TypeError("Missing performance connector identity");
  const turnKey = createHash("sha256").update(filePath).digest("hex").slice(0, 8);
  const completed = readReplayProgress(messages, serialized, { evidenceStart, filePath, turnKey });
  return { ...plan, filePath, connectorId, turnKey, completed };
}

export function replayEvidence(context) {
  return `NOOBOT_PERF_CASE:${context.filePath}\nNOOBOT_PERF_ROUND:${context.round}\nNOOBOT_PERF_CONNECTOR:${context.connectorId}\nNOOBOT_PERF_PROGRESS:${context.completed}`;
}
