/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PERF_ROUNDS,
  PERF_SCENARIO,
  PERF_PLUGINS,
  PERF_HARNESS,
  PERF_STOP_CONTINUE_CYCLES,
  PERF_HARNESS_MODELS,
  performanceRound,
} from "../../mock-model-service/performance-contract.mjs";
import { PERF_ALL_TOOLS } from "../../mock-model-service/scenario.mjs";
import { DEFAULT_TURN_THRESHOLDS } from "../../../shared/turn-thresholds.js";
import { IMMUTABLE_CHECKPOINT_FORBIDDEN_WORK } from "@noobot/session-protocol/immutable-storage";
import {
  HARNESS_MAIN_RELAYS,
  HARNESS_REQUIRED_EVENTS,
  HARNESS_THRESHOLD_FIELDS,
} from "../performance-harness.mjs";

function sample(plan) {
  const toolCount = PERF_ALL_TOOLS.length * plan.repetitions;
  return {
    ...plan,
    toolCount,
    modelRequestCount: toolCount + 1,
    summaryCount: 1,
    harness: {
      run: { status: "success" },
      purposes: Object.keys(PERF_HARNESS_MODELS),
      mainRelays: [...HARNESS_MAIN_RELAYS],
      events: [
        ...HARNESS_REQUIRED_EVENTS.map((event) => ({ event })),
        ...Object.entries(HARNESS_THRESHOLD_FIELDS).map(([event, field]) => ({
          event,
          detail: {
            thresholdMode: "full",
            thresholdSource: "fallback",
            triggerTurns: DEFAULT_TURN_THRESHOLDS.harness.modeThresholds.full[field],
          },
        })),
      ],
    },
    metrics: { pipelineLocalMs: plan.kind === "long" ? 10000 : 1000, checkpointMs: 20 },
    toolSamples: Object.fromEntries(
      PERF_ALL_TOOLS.map((name) => [name, Array(plan.repetitions).fill(10)]),
    ),
    serverToolEvents: Array.from({ length: plan.repetitions }, () =>
      PERF_ALL_TOOLS.map((tool) => ({ event: "tool_call_end", data: { tool, success: true } })),
    ).flat(),
    checkpointSamples: Array.from({ length: toolCount * 3 + 1 }, () => ({
      durationMs: 20,
      preparationMs: 1,
      appendMs: 18,
      verificationMs: 1,
      queueWaitMs: 0,
      storageWork: {
        ...Object.fromEntries(IMMUTABLE_CHECKPOINT_FORBIDDEN_WORK.map((name) => [name, 0])),
        immutableHeadReadBytes: 800,
        immutableHeadWriteBytes: 400,
        immutableIndexPageReads: 20,
        immutableObjectReads: 30,
        immutableSegmentWrites: 1,
        immutableSegmentSyncs: 1,
        immutableReadBytes: 12000,
        immutableWriteBytes: 8000,
      },
    })),
  };
}

export function performanceReportFixture() {
  return {
    version: 2,
    scenario: PERF_SCENARIO,
    plan: PERF_ROUNDS,
    plugins: PERF_PLUGINS,
    harness: PERF_HARNESS,
    samples: PERF_ROUNDS.map(sample),
    stopContinues: [...Array(PERF_STOP_CONTINUE_CYCLES).keys()].map((index) => ({
      cycle: index + 1,
      stopTiming: { clickToCommandMs: 10, clickToCompletedMs: 20, clickToUiReadyMs: 30 },
      continued: sample(performanceRound(PERF_ROUNDS.length + index + 1)),
    })),
  };
}
