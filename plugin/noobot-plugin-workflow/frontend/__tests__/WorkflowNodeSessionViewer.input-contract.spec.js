/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { detailResponse, step, mountViewer } from "./workflowNodeSessionViewerHarness.js";

describe("workflow node detail input and failure contract", () => {
  it("shows invalid request identities without sending a request and can reopen a corrected node", async () => {
    const selectedStep = step("invalid-request");
    const fetcher = vi.fn(async () =>
      detailResponse(selectedStep.nodeSessionId, "recovered", selectedStep.dialogProcessId),
    );
    const { wrapper, state, viewer, viewerProps } = mountViewer({
      fetcher,
      sessionDocs: {},
      runtimeNodes: [selectedStep],
    });
    viewerProps.userId = " user-1";
    await viewer.openNodeSession(selectedStep, { traceId: "trace-invalid" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.viewerVisible.value).toBe(true);
    expect(state.viewerState.value).toBe("failed");
    expect(state.viewerError.value).toContain("userId");
    viewerProps.userId = "user-1";
    await viewer.openNodeSession(selectedStep, { traceId: "trace-valid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.viewerError.value).toBe("");
    expect(state.selectedNodeMessages.value[0].content).toBe("recovered");
    wrapper.unmount();
  });

  it("rejects a conflicting REST snapshot before materializing it", async () => {
    const selectedStep = step("snapshot-conflict");
    const { wrapper, state, viewer, applyWorkflowRuntimeEvent } = mountViewer({
      fetcher: vi.fn(async () =>
        detailResponse("foreign-session", "foreign", selectedStep.dialogProcessId),
      ),
      sessionDocs: {},
      runtimeNodes: [selectedStep],
    });
    await viewer.openNodeSession(selectedStep, { traceId: "trace-conflict" });
    expect(applyWorkflowRuntimeEvent).not.toHaveBeenCalled();
    expect(state.viewerState.value).toBe("failed");
    expect(state.viewerError.value).toContain("nodeSessionId");
    expect(state.selectedNodeMessages.value).toEqual([]);
    wrapper.unmount();
  });

  it("exposes live projection failures, blocks further merges and recovers on explicit reopen", async () => {
    const selectedStep = step("live-failure");
    const { wrapper, state, viewer, viewerProps } = mountViewer({
      fetcher: vi.fn(async () =>
        detailResponse(selectedStep.nodeSessionId, "persisted", selectedStep.dialogProcessId),
      ),
      sessionDocs: {},
      runtimeNodes: [selectedStep],
    });
    await viewer.openNodeSession(selectedStep, { traceId: "trace-live" });
    const selectSessionMessages = viewerProps.selectSessionMessages;
    viewerProps.selectSessionMessages = () => {
      throw new Error("damaged live content");
    };
    viewerProps.subSessionMessageRegistryVersion += 1;
    await nextTick();
    expect(state.viewerState.value).toBe("failed");
    expect(state.viewerError.value).toBe("damaged live content");
    viewerProps.selectSessionMessages = selectSessionMessages;
    viewerProps.subSessionMessageRegistryVersion += 1;
    await nextTick();
    expect(state.viewerState.value).toBe("failed");
    await viewer.openNodeSession(selectedStep, { traceId: "trace-reopen" });
    expect(state.viewerError.value).toBe("");
    expect(state.viewerState.value).toBe("ready");
    wrapper.unmount();
  });
});
