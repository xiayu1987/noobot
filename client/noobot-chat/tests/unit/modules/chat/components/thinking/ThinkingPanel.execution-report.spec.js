/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutionReport,
  createExecutionModelMeasurements,
} from "@noobot/session-protocol/execution-report";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

const getReport = vi.fn();

const drawerStub = {
  "el-drawer": {
    props: ["modelValue", "title", "direction", "size"],
    template:
      '<div v-if="modelValue" class="execution-report-drawer" :data-title="title" :data-direction="direction" :data-size="size"><slot /></div>',
  },
};

function installMatchMedia(initialMatches) {
  const listeners = new Set();
  const mediaQuery = {
    matches: initialMatches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  window.matchMedia = vi.fn(() => mediaQuery);
  return {
    change(matches) {
      mediaQuery.matches = matches;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

const finishedMessage = {
  role: "assistant",
  pending: false,
  sessionId: "session-1",
  dialogProcessId: "dialog-1",
  toolTimeline: [
    {
      key: "call:call-1",
      toolCallId: "call-1",
      tool: "execute",
      status: "completed",
      args: { command: "npm test" },
      result: { ok: true },
      call: {
        eventId: "call-event-1",
        sequence: 1,
        sequenceScopeId: "message-1",
        sequenceDomain: "message-event",
        authority: "authoritative",
        timestamp: "2026-07-25T01:00:00.000Z",
      },
      success: true,
      resultEvent: {
        eventId: "result-event-1",
        sequence: 2,
        sequenceScopeId: "message-1",
        sequenceDomain: "message-event",
        authority: "authoritative",
        timestamp: "2026-07-25T01:00:01.000Z",
      },
    },
  ],
};

const EMPTY_METRICS = Object.freeze({
  model: {
    llmCalls: 0,
    llmCallsWithTools: 0,
    maxLoopRound: 0,
    invocations: 0,
    retries: 0,
    switches: 0,
    models: {},
    measurements: createExecutionModelMeasurements(),
  },
  tools: {
    toolStats: {},
    riskLevels: {},
    slowestToolCalls: [],
    totalToolDurationMs: 0,
    totalPersistDurationMs: 0,
  },
  hooks: { count: 0, errorCount: 0, totalDurationMs: 0 },
  phases: { contextBuildMs: null },
});

function v4Report({ status = "completed", durationMs, executionSummary = null, ...rest }) {
  const startedAt = "2026-07-25T01:00:00.000Z";
  return buildExecutionReport({
    status,
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + durationMs).toISOString(),
    executionSummary,
    ...rest,
  });
}

function summaryOf({ toolCallCount = 0, errorCount = 0, metrics = EMPTY_METRICS } = {}) {
  return { visibleTotal: 0, toolCallCount, toolResultCount: toolCallCount, errorCount, metrics };
}

function findReportButton(wrapper) {
  return wrapper.find(".execution-report-action-button");
}

describe("ThinkingPanel execution report", () => {
  beforeEach(() => {
    localStorage.clear();
    getReport.mockReset();
    installMatchMedia(false);
  });

  it("keeps the drawer width in sync with the viewport while open", async () => {
    const viewport = installMatchMedia(false);
    getReport.mockResolvedValue(null);
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );

    await findReportButton(wrapper).trigger("click");
    await flushPromises();
    expect(wrapper.find(".execution-report-drawer").attributes("data-size")).toBe("72%");

    viewport.change(true);
    await flushPromises();
    expect(wrapper.find(".execution-report-drawer").attributes("data-size")).toBe("100%");

    viewport.change(false);
    await flushPromises();
    expect(wrapper.find(".execution-report-drawer").attributes("data-size")).toBe("72%");
  });

  it("opens the right drawer and renders every report dimension", async () => {
    getReport.mockResolvedValue(
      v4Report({
        durationMs: 2500,
        executionSummary: summaryOf({
          toolCallCount: 3,
          errorCount: 1,
          metrics: {
            model: {
              llmCalls: 4,
              llmCallsWithTools: 3,
              maxLoopRound: 4,
              invocations: 4,
              retries: 1,
              switches: 0,
              models: { claude: 4 },
              measurements: createExecutionModelMeasurements(),
            },
            tools: {
              toolStats: {
                read_file: {
                  calls: 2,
                  failures: 0,
                  nonZeroExits: 0,
                  timedCount: 2,
                  totalDurationMs: 400,
                  maxDurationMs: 300,
                },
                execute: {
                  calls: 1,
                  failures: 1,
                  nonZeroExits: 1,
                  timedCount: 1,
                  totalDurationMs: 3000,
                  maxDurationMs: 3000,
                },
                search: {
                  calls: 1,
                  failures: 0,
                  nonZeroExits: 0,
                  timedCount: 0,
                  totalDurationMs: 0,
                  maxDurationMs: 0,
                },
              },
              riskLevels: { critical: 1, low: 2 },
              slowestToolCalls: [
                {
                  toolCallId: "c1",
                  tool: "execute",
                  subject: "npm run build",
                  durationMs: 3000,
                  persistDurationMs: 200,
                  success: false,
                },
              ],
              totalToolDurationMs: 3400,
              totalPersistDurationMs: 200,
            },
            hooks: { count: 5, errorCount: 0, totalDurationMs: 120 },
            phases: { contextBuildMs: 800 },
          },
        }),
      }),
    );
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { userId: "admin", fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );
    expect(wrapper.find(".execution-report-drawer").exists()).toBe(false);

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    expect(getReport).toHaveBeenCalledWith({
      userId: "admin",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
    });
    const drawer = wrapper.find(".execution-report-drawer");
    expect(drawer.attributes("data-title")).toMatch(/执行报告|Execution Report/);
    expect(drawer.attributes("data-direction")).toBe("rtl");
    const overview = drawer.find('[data-testid="execution-report-overview"]').text();
    expect(overview).toMatch(/已完成|Completed/);
    expect(overview).toContain("2.5s");
    const model = drawer.find('[data-testid="execution-report-model"]').text();
    expect(model).toContain("claude × 4");
    expect(drawer.find('[data-testid="execution-report-phases"]').text()).toContain("800ms");
    const risks = drawer
      .findAll('[data-testid="execution-report-risks"] span')
      .map((n) => n.text());
    expect(risks).toEqual(["low × 2", "critical × 1"]);
    const rows = drawer
      .findAll('[data-testid="execution-report-tools"] .execution-report-tool')
      .map((item) => [
        item.find(".execution-report-tool-name").text(),
        ...item.findAll("dd").map((dd) => dd.text()),
      ]);
    expect(rows).toEqual([
      ["execute", "1", "1", "1", "3.0s", "3.0s", "3.0s"],
      ["read_file", "2", "0", "0", "400ms", "200ms", "300ms"],
      ["search", "1", "0", "0", "-", "-", "-"],
    ]);
    expect(drawer.find('[data-testid="execution-report-slowest"]').text()).toContain("execute");
    const subject = drawer.find('[data-testid="execution-report-slowest-subject"]');
    expect(subject.text()).toBe("npm run build");
    expect(subject.attributes("title")).toBe("npm run build");
    expect(drawer.find(".execution-report-status").attributes("data-tone")).toBe("success");
    const cards = drawer.findAll(".execution-report-card");
    expect(cards.map((node) => node.find(".execution-report-card-value").text())).toEqual([
      "2.5s",
      "3",
      "1",
      "4",
    ]);
    expect(cards[2].attributes("data-tone")).toBe("error");
    const riskTones = drawer
      .findAll('[data-testid="execution-report-risks"] span')
      .map((node) => node.attributes("data-tone"));
    expect(riskTones).toEqual(["success", "error"]);
    const barWidths = drawer
      .findAll('[data-testid="execution-report-tools"] .execution-report-bar-fill')
      .map((node) => node.attributes("style"));
    expect(barWidths).toEqual(["width: 100%;", "width: 13%;", "width: 0%;"]);
    expect(drawer.find(".execution-report-rank").text()).toBe("1");
  });

  it("renders the summary error when execution statistics are unavailable", async () => {
    getReport.mockResolvedValue(
      v4Report({
        status: "failed",
        durationMs: 900,
        summaryError: { message: "summary unreadable" },
        error: { message: "boom" },
      }),
    );
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    const drawer = wrapper.find(".execution-report-drawer");
    const cards = drawer.findAll(".execution-report-card");
    expect(cards.map((node) => node.find(".execution-report-card-value").text())).toEqual([
      "900ms",
    ]);
    expect(drawer.find('[data-testid="execution-report-model"]').exists()).toBe(false);
    expect(drawer.find(".execution-report-status").attributes("data-tone")).toBe("error");
    expect(drawer.text()).toContain("boom");
    expect(drawer.text()).toContain("summary unreadable");
    expect(drawer.text()).toMatch(/执行统计不可用|Execution statistics unavailable/);
  });

  it("shows the empty hint when the report has not been generated", async () => {
    getReport.mockResolvedValue(null);
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    const dialog = wrapper.find(".execution-report-drawer");
    expect(dialog.find('[data-testid="execution-report-body"]').exists()).toBe(false);
    expect(dialog.find(".empty-hint").text()).toMatch(/本轮暂无执行报告|No execution report/);
  });

  it("renders usage totals, sample averages and rates in the report drawer", async () => {
    const measurements = createExecutionModelMeasurements();
    Object.assign(measurements.requests, { startedCount: 2, completedCount: 2 });
    Object.assign(measurements.usage.tokens, {
      sampleCount: 2,
      inputTokensSum: 400,
      outputTokensSum: 40,
    });
    Object.assign(measurements.usage.cacheRead, {
      sampleCount: 2,
      inputTokensSum: 400,
      cacheReadInputTokensSum: 80,
      hitRequestCount: 1,
    });
    Object.assign(measurements.usage.cacheWrite, {
      unavailableCount: 2,
      unavailableReasons: { unsupported: 2 },
    });
    Object.assign(measurements.requestPrefix, {
      sampleCount: 2,
      requestBodyBytesSum: 300,
      commonPrefixBytesSum: 90,
    });
    getReport.mockResolvedValue(
      v4Report({
        durationMs: 1000,
        executionSummary: summaryOf({
          metrics: {
            ...EMPTY_METRICS,
            model: { ...EMPTY_METRICS.model, measurements },
          },
        }),
      }),
    );
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );
    await findReportButton(wrapper).trigger("click");
    await flushPromises();
    const usage = wrapper.find('[data-testid="execution-report-usage"]');
    const labels = usage.findAll("dt").map((item) => item.text());
    const values = usage.findAll("dd").map((item) => item.text());
    const displayed = Object.fromEntries(labels.map((label, index) => [label, values[index]]));
    const valueFor = (pattern) => displayed[labels.find((label) => pattern.test(label))];
    expect(valueFor(/总 token 消耗|Total Token Usage/)).toBe("440");
    expect(valueFor(/平均每次请求 token 消耗|Average Tokens per Request/)).toBe("220");
    expect(valueFor(/公共前缀总量|Total Request Body Common Prefix/)).toBe("90");
    expect(valueFor(/平均每次请求公共前缀|Average Common Prefix per Request/)).toBe("45");
    expect(valueFor(/平均每次请求实际缓存读取|Average Actual Cache Read per Request/)).toBe("40");
    expect(valueFor(/缓存命中请求率|Cache Hit Request Rate/)).toBe("50%");
    expect(valueFor(/实际缓存读取占输入比例|Actual Cache Read Share of Input/)).toBe("20%");
    expect(valueFor(/用量采集覆盖率|Usage Collection Coverage/)).toBe("100% (2/2)");
  });

  it("renders and reorders multiple measurement diagnostics without duplicate keys", async () => {
    const measurements = createExecutionModelMeasurements();
    Object.assign(measurements.requests, { startedCount: 3, completedCount: 3 });
    for (const group of Object.values(measurements.usage))
      Object.assign(group, { unavailableCount: 3, unavailableReasons: { measurement_failed: 3 } });
    Object.assign(measurements.requestPrefix, {
      unavailableCount: 3,
      unavailableReasons: { unsupported: 3 },
    });
    measurements.measurementErrors = [
      { transportRequestId: "request-1", message: "first measurement error" },
      { transportRequestId: "request-2", message: "second measurement error" },
      { transportRequestId: "request-3", message: "third measurement error" },
    ];
    const report = reactive(
      v4Report({
        durationMs: 1000,
        executionSummary: summaryOf({
          metrics: { ...EMPTY_METRICS, model: { ...EMPTY_METRICS.model, measurements } },
        }),
      }),
    );
    getReport.mockResolvedValue(report);
    const warnings = vi.spyOn(console, "warn");
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { fetchExecutionReport: getReport },
      { stubs: drawerStub },
    );
    try {
      await findReportButton(wrapper).trigger("click");
      await flushPromises();
      const values = () =>
        wrapper
          .findAll('[data-testid="execution-report-usage"] dd')
          .map((node) => node.text())
          .filter((text) => text.startsWith("request-"));
      expect(values()).toEqual(
        measurements.measurementErrors.map(
          ({ transportRequestId, message }) => `${transportRequestId}: ${message}`,
        ),
      );
      report.summary.metrics.model.measurements.measurementErrors.reverse();
      await flushPromises();
      expect(values()).toEqual([
        "request-3: third measurement error",
        "request-2: second measurement error",
        "request-1: first measurement error",
      ]);
      expect(
        warnings.mock.calls.filter((args) =>
          args.some((arg) => String(arg).includes("Duplicate keys")),
        ),
      ).toEqual([]);
    } finally {
      wrapper.unmount();
      warnings.mockRestore();
    }
  });

  it("loads the report only through the injected host capability", async () => {
    const fetchExecutionReport = vi.fn(async () =>
      v4Report({ durationMs: 1000, executionSummary: summaryOf() }),
    );
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { userId: "user-1", fetchExecutionReport },
      { stubs: drawerStub },
    );

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    expect(fetchExecutionReport).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
    });
    expect(wrapper.find('[data-testid="execution-report-body"]').exists()).toBe(true);
  });
});
