/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountItem } from "./sharedChatMessageItemHarness.js";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { clearExtensionRegistry } from "../../../../../../src/extensions/extension-registry.js";
import { clearSessionTurnUiStates } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";
import { canonicalWorkflowRuntimeEvent } from "../../helpers/workflowRuntimeEventFixture.js";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";

describe("SharedChatMessageItem workflow ownership", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSessionTurnUiStates("session-content");
    clearExtensionRegistry();
  });

  it("keeps the single outer assistant header that owns a live workflow", () => {
    const wrapper = mountItem({
      storeSetup: (store) =>
        store.applyWorkflowRuntimeEvent(
          canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.PLANNING, {
            eventId: "turn-workflow:planning",
            executionId: "turn-workflow",
            workflowRunId: "turn-workflow",
            authoritySessionId: "session-1",
            dialogProcessId: "dialog-workflow",
            turnScopeId: "turn-workflow",
            presentationMessageId: "workflow-thinking-host",
            semanticText: "WORKFLOW_DSL/1",
            workflowPayload: {
              nodes: [{ nodeExecutionId: "node-1" }],
              nodeSessions: [
                {
                  nodeExecutionId: "node-1",
                  eventId: "workflow_node_state:turn-workflow:node-1:1",
                  activeChildExecutionId: "agent-1",
                  attemptExecutionIds: ["agent-1"],
                  status: "running",
                  revision: 1,
                  sequence: 1,
                },
              ],
            },
          }),
          { source: "test" },
        ),
      messageItem: {
        presentationMessageId: "workflow-thinking-host",
        role: "assistant",
        type: "message",
        content: "",
        sessionId: "session-1",
        dialogProcessId: "dialog-workflow",
        turnScopeId: "turn-workflow",
        pending: true,
      },
    });

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("false");
  });

  it("keeps the assistant header when workflow ownership arrives after mount", async () => {
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "workflow-thinking-host-late",
        role: "assistant",
        type: "message",
        content: "",
        sessionId: "session-late",
        dialogProcessId: "dialog-before-workflow",
        turnScopeId: "turn-before-workflow",
        pending: true,
      },
    });
    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("false");

    useChatStore().applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.PLANNING, {
        eventId: "workflow-late:planning",
        executionId: "workflow-late",
        workflowRunId: "workflow-late",
        authoritySessionId: "session-late",
        dialogProcessId: "dialog-workflow-late",
        turnScopeId: "turn-workflow-late",
        presentationMessageId: "workflow-thinking-host-late",
        semanticText: "WORKFLOW_DSL/1",
        workflowPayload: {
          nodes: [{ nodeExecutionId: "node-late" }],
          nodeSessions: [
            {
              nodeExecutionId: "node-late",
              eventId: "workflow_node_state:late-workflow:node-late:1",
              activeChildExecutionId: "agent-late",
              attemptExecutionIds: ["agent-late"],
              status: "running",
              revision: 1,
              sequence: 1,
            },
          ],
        },
      }),
      { source: "test" },
    );
    await nextTick();

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("false");
  });
});
