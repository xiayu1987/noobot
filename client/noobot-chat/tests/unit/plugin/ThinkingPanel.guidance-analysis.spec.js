/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
// Tests split by responsibility from ThinkingPanel.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

describe("ThinkingPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  

  

  

  

  

  

  

  it("renders latest guidance analysis above execution logs without mixing it into rolling tool logs", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      processRealtimeLogs: [
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old analysis\nline two",
          text: "old analysis\nline two",
        },
        { event: "tool_call", type: "tool_call", text: "read_file" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest analysis\nkeep newline",
          text: "latest analysis\nkeep newline",
        },
        { event: "tool_result", type: "tool_result", text: "read_file done" },
      ],
    });

    const analysisBlock = wrapper.find(".thinking-analysis-block");
    expect(analysisBlock.exists()).toBe(true);
    expect(analysisBlock.text()).toContain("latest analysis\nkeep newline");
    expect(analysisBlock.text()).not.toContain("old analysis");

    const rollingLogs = wrapper.findAll(".execution-log-line").map((line) => line.text());
    expect(rollingLogs).toEqual(["开始：执行命令：read_file", "完成：执行命令：read_file done"]);
  });

  it("does not render non-guidance analysis logs in the dedicated analysis block", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      processRealtimeLogs: [
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "summary",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "summary analysis should stay hidden",
          text: "summary analysis should stay hidden",
        },
        { event: "tool_call", type: "tool_call", text: "execute_script" },
      ],
    });

    expect(wrapper.find(".thinking-analysis-block").exists()).toBe(false);
    expect(wrapper.findAll(".execution-log-line").map((line) => line.text())).toEqual([
      "开始：执行命令：execute_script",
    ]);
  });

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  it("does not render plugin capability responses as guidance analysis", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      turnScopeId: "client-turn:plugin-analysis",
      processExecutionLogTotal: 5,
      processRealtimeLogs: [
        { event: "tool_call", type: "tool_call", text: "tool log" },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          text: "planning response",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old guidance analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old planning analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest planning analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).not.toContain("分析流程");
    expect(wrapper.text()).not.toContain("模型返回");
    expect(wrapper.text()).not.toContain("latest guidance analysis");
    expect(wrapper.text()).not.toContain("old planning analysis");
    expect(wrapper.text()).not.toContain("latest planning analysis");
    expect(wrapper.text()).not.toContain("planning response");
    expect(wrapper.text()).not.toContain("old guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.findAll(".execution-log-line")[0].text()).toContain("tool log");
    expect(wrapper.find("button").text()).toContain("1");
  });

  it("renders latest guidance analysis response from completed logs after reload", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:plugin-completed",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "completed guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("completed guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });

  it("renders guidance analysis from normalized data fields", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:plugin-data-fields",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis_response",
          type: "guidance_analysis_response",
          data: {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
            output: "data field guidance analysis",
          },
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("data field guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });

  it("keeps old completed guidance analysis visible after reload", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:old-harness-completed",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          harnessFlow: "analysis",
          chain: "auxiliary",
          output: "old completed guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("old completed guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });
});
