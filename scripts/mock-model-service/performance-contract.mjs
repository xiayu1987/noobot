/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEVELOPMENT_THRESHOLDS } from "../lib/development-thresholds.mjs";

export const PERF_SCENARIO = "harness-mixed-session-v1";
const PERF_REPETITIONS = 6;
const PERF_LONG_REPETITIONS = 38;
export const PERF_STOP_CONTINUE_CYCLES = 2;
export const PERF_HISTORY = Object.freeze({
  turns: 8,
  checkpointsPerTurn: 6,
  messagesPerCheckpoint: 8,
  minimumContentBytes: DEVELOPMENT_THRESHOLDS.length.performanceHistoryMinimumContentBytes,
});
export const PERF_PLUGINS = Object.freeze(["character", "harness"]);
export const PERF_HARNESS = Object.freeze({
  thresholds: "system",
  planning: true,
  planningAcceptance: true,
});
export const PERF_HARNESS_MODELS = Object.freeze(
  Object.fromEntries(
    [
      "planning",
      "guidance",
      "summary",
      "planning_revision",
      "planning_refinement",
      "phase_acceptance",
      "acceptance_semantic_validation",
    ].map((purpose) => [purpose, `e2e_harness_${purpose}`]),
  ),
);
export const PERF_ROUNDS = Object.freeze(
  [...Array(20).keys()].map((index) => {
    const round = index + 1;
    const kind = round === 10 || round === 20 ? "long" : "ordinary";
    return Object.freeze({
      round,
      kind,
      repetitions: kind === "long" ? PERF_LONG_REPETITIONS : PERF_REPETITIONS,
    });
  }),
);
export function performanceRound(round) {
  if (
    !Number.isInteger(round) ||
    round < 1 ||
    round > PERF_ROUNDS.length + PERF_STOP_CONTINUE_CYCLES
  )
    throw new TypeError(`Invalid performance round: ${round}`);
  return (
    PERF_ROUNDS[round - 1] ||
    Object.freeze({ round, kind: "continuation", repetitions: PERF_REPETITIONS })
  );
}
