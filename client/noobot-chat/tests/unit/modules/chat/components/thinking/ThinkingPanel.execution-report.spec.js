/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

const getReport = vi.hoisted(() => vi.fn());
vi.mock("../../../../../../src/infrastructure/api/thinking/executionReportService.js", () => ({
  executionReportService: { getReport },
}));

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
    const wrapper = mountThinkingPanel(finishedMessage, {}, { stubs: drawerStub });

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
    getReport.mockResolvedValue({
      status: "completed",
      durationMs: 2500,
      summary: {
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
          },
          tools: {
            toolStats: {
              read_file: {
                calls: 2,
                failures: 0,
                timedCount: 2,
                totalDurationMs: 400,
                maxDurationMs: 300,
              },
              execute: {
                calls: 1,
                failures: 1,
                timedCount: 1,
                totalDurationMs: 3000,
                maxDurationMs: 3000,
              },
              search: {
                calls: 1,
                failures: 0,
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
                success: false,
              },
            ],
            totalToolDurationMs: 3400,
          },
          hooks: { count: 5, errorCount: 0, totalDurationMs: 120 },
          phases: { contextBuildMs: 800 },
        },
      },
    });
    const wrapper = mountThinkingPanel(finishedMessage, { userId: "admin" }, { stubs: drawerStub });
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
      .findAll('[data-testid="execution-report-tools"] tbody tr')
      .map((row) => row.findAll("td").map((td) => td.text()));
    expect(rows).toEqual([
      ["execute", "1", "1", "3.0s", "3.0s", "3.0s"],
      ["read_file", "2", "0", "400ms", "200ms", "300ms"],
      ["search", "1", "0", "-", "-", "-"],
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

  it("renders legacy reports without metrics", async () => {
    getReport.mockResolvedValue({
      status: "failed",
      durationMs: 900,
      summary: { toolCallCount: 0, errorCount: 0, toolStats: {} },
      error: { message: "boom" },
    });
    const wrapper = mountThinkingPanel(finishedMessage, {}, { stubs: drawerStub });

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    const drawer = wrapper.find(".execution-report-drawer");
    expect(drawer.find('[data-testid="execution-report-overview"]').text()).toContain("900ms");
    expect(drawer.find('[data-testid="execution-report-model"]').exists()).toBe(false);
    expect(drawer.text()).toContain("boom");
  });

  it("shows the empty hint when the report has not been generated", async () => {
    getReport.mockResolvedValue(null);
    const wrapper = mountThinkingPanel(finishedMessage, {}, { stubs: drawerStub });

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    const dialog = wrapper.find(".execution-report-drawer");
    expect(dialog.find('[data-testid="execution-report-body"]').exists()).toBe(false);
    expect(dialog.find(".empty-hint").text()).toMatch(/本轮暂无执行报告|No execution report/);
  });

  it("loads the report through the data-owner fetcher instead of the host endpoint", async () => {
    const fetchExecutionReport = vi.fn(async () => ({ status: "completed", durationMs: 1000 }));
    const wrapper = mountThinkingPanel(
      finishedMessage,
      { userId: "user-1", fetchExecutionReport },
      { stubs: drawerStub },
    );

    await findReportButton(wrapper).trigger("click");
    await flushPromises();

    expect(getReport).not.toHaveBeenCalled();
    expect(fetchExecutionReport).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
    });
    expect(wrapper.find('[data-testid="execution-report-body"]').exists()).toBe(true);
  });
});
