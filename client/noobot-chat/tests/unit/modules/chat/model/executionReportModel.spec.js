/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildExecutionReportView } from "../../../../../src/modules/chat/model/executionReportModel.js";

const translate = (key) => key;

function createReport() {
  return {
    status: "completed",
    durationMs: 9000,
    summary: {
      visibleTotal: 2,
      toolCallCount: 2,
      toolResultCount: 2,
      errorCount: 0,
      metrics: {
        model: {
          llmCalls: 1,
          llmCallsWithTools: 1,
          maxLoopRound: 1,
          invocations: 1,
          retries: 0,
          switches: 0,
          models: {},
        },
        tools: {
          toolStats: {},
          riskLevels: {},
          totalToolDurationMs: 7000,
          totalPersistDurationMs: 1500,
          slowestToolCalls: [
            {
              toolCallId: "a",
              tool: "execute_script",
              subject: "npm test",
              durationMs: 5000,
              persistDurationMs: 800,
              success: true,
            },
          ],
        },
        hooks: { count: 0, errorCount: 0, totalDurationMs: 0 },
        phases: { contextBuildMs: 100 },
      },
    },
    summaryError: null,
    error: null,
  };
}

describe("executionReportModel persistence timing", () => {
  it("shows execution, framework and shared projection time when present", () => {
    const report = createReport();
    Object.assign(report.summary.metrics.tools, { totalExecutionMs: 3000, totalFrameworkMs: 4000 });
    report.summary.metrics.phases.checkpointDurationMs = 200;
    const rows = Object.fromEntries(
      buildExecutionReportView(report, translate).phases.map((item) => [item.label, item.value]),
    );
    expect(rows["message.executionReportToolExecution"]).toBe("3.0s");
    expect(rows["message.executionReportToolFramework"]).toBe("4.0s");
    expect(rows["message.executionReportCheckpointDuration"]).toBe("200ms");
  });
  it("shows tool time and persistence time as separate phase rows", () => {
    const view = buildExecutionReportView(createReport(), translate);
    const rows = Object.fromEntries(view.phases.map((item) => [item.label, item.value]));
    expect(rows["message.executionReportToolDuration"]).toBe("7.0s");
    expect(rows["message.executionReportPersistDuration"]).toBe("1.5s");
  });

  it("carries each slowest call's own persistence time without merging it into the tool time", () => {
    const view = buildExecutionReportView(createReport(), translate);
    expect(view.slowest[0].duration).toBe("5.0s");
    expect(view.slowest[0].persistDuration).toBe("800ms");
  });
});
