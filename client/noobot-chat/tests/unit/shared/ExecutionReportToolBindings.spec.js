/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createExecutionModelMeasurements } from "@noobot/session-protocol/execution-report";
import ExecutionReportDrawer from "../../../src/modules/chat/components/thinking/ExecutionReportDrawer.vue";
import {
  setToolNameBindings,
  updateToolNameBindings,
  clearToolNameBindings,
} from "../../../src/shared/state/toolNameBindings.js";

afterEach(() => {
  clearToolNameBindings();
  vi.unstubAllGlobals();
});

it("uses current bindings for grouped and slowest tools without changing report identity or subjects", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  setToolNameBindings("admin", { read_file: { bindingName: "nb_read_file" } });
  const report = {
    status: "completed",
    durationMs: 10,
    summary: {
      toolCallCount: 1,
      errorCount: 0,
      metrics: {
        model: { models: {}, measurements: createExecutionModelMeasurements() },
        phases: {},
        hooks: {},
        tools: {
          riskLevels: {},
          toolStats: {
            read_file: {
              calls: 1,
              failures: 0,
              nonZeroExits: 0,
              timedCount: 1,
              totalDurationMs: 10,
              maxDurationMs: 10,
            },
          },
          slowestToolCalls: [
            {
              toolCallId: "read-1",
              tool: "read_file",
              subject: "read_file.txt",
              durationMs: 10,
              success: true,
            },
          ],
        },
      },
    },
  };
  const wrapper = mount(ExecutionReportDrawer, {
    props: {
      visible: true,
      userId: "admin",
      messageItem: { sessionId: "session", dialogProcessId: "dialog" },
      translate: (key) => key,
      fetchExecutionReport: async () => report,
    },
    global: { stubs: { "el-drawer": { template: "<div><slot /></div>" } } },
  });
  await flushPromises();
  expect(wrapper.findAll(".execution-report-tool-name").map((row) => row.text())).toEqual([
    "nb_read_file",
    "nb_read_file",
  ]);
  expect(wrapper.get('[data-testid="execution-report-slowest-subject"]').text()).toBe(
    "read_file.txt",
  );
  updateToolNameBindings("admin", { read_file: { bindingName: "read_document" } });
  await nextTick();
  expect(wrapper.findAll(".execution-report-tool-name").map((row) => row.text())).toEqual([
    "read_document",
    "read_document",
  ]);
  expect(Object.keys(report.summary.metrics.tools.toolStats)).toEqual(["read_file"]);
  expect(report.summary.metrics.tools.slowestToolCalls[0].tool).toBe("read_file");
  wrapper.unmount();
});
