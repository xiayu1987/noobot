/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nextTick, reactive, ref } from "vue";
import { describe, expect, it } from "vitest";
import { useWorkflowViewerState } from "../composables/useWorkflowViewerState.js";

describe("workflow viewer state ownership", () => {
  it("preserves selection without reopening after the live-to-persisted remount", async () => {
    const registry = reactive({ workflows: {}, viewerStates: {} });
    const livePayload = ref({ execution: { instanceId: "workflow-a" } });
    const live = useWorkflowViewerState(livePayload, registry);
    const node = { nodeId: "node-a", actionNodeStates: [{ steps: [] }] };
    const step = { stepId: "step-a", sessionId: "session-a" };

    live.selectedRuntimeNode.value = node;
    live.selectedRuntimeStep.value = step;
    live.selectedNode.value = step;
    live.selectedGraphDialogProcessId.value = "dialog-a";
    live.viewerVisible.value = true;
    await nextTick();

    const persistedPayload = ref({ workflowRunId: "workflow-a", execution: { workflowRunId: "workflow-a" } });
    const persisted = useWorkflowViewerState(persistedPayload, registry);

    expect(persisted.viewerVisible.value).toBe(false);
    expect(persisted.selectedRuntimeNode.value).toEqual(node);
    expect(persisted.selectedRuntimeStep.value).toEqual(step);
    expect(persisted.selectedNode.value).toEqual(step);
    expect(persisted.selectedGraphDialogProcessId.value).toBe("dialog-a");
  });
});
