/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { mountItem } from "./sharedChatMessageItemHarness.js";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { clearSessionTurnUiStates } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";
import { canonicalWorkflowSessionSnapshot } from "../../helpers/workflowRuntimeEventFixture.js";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import { ElTabPane, ElTabs } from "element-plus";

const TestRenderer = defineComponent({
  name: "SharedMessageContextProbe",
  props: {
    attachmentCount: { type: Number, default: 0 },
  },
  setup(props) {
    return () =>
      h("div", {
        class: "context-probe",
        "data-attachment-count": String(props.attachmentCount),
      });
  },
});

const AssetRenderer = defineComponent({
  name: "SharedMessageAssetRendererProbe",
  props: {
    attachmentCount: { type: Number, default: 0 },
  },
  setup(props) {
    return () =>
      h("div", {
        class: "asset-renderer-probe",
        "data-attachment-count": String(props.attachmentCount),
      });
  },
});

const RuntimeRenderer = defineComponent({
  name: "SharedMessageRuntimeProbe",
  props: {
    startedAt: { type: String, default: "" },
    thinkingFinishedAt: { type: String, default: "" },
    running: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h("div", {
        class: "runtime-probe",
        "data-started-at": props.startedAt,
        "data-thinking-finished-at": props.thinkingFinishedAt,
        "data-running": String(props.running),
      });
  },
});

describe("SharedChatMessageItem", () => {
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

  it("uses the shared right-side preview drawer for attachments and mutations", () => {
    const wrapper = mountItem();
    const drawers = wrapper.findAll("el-drawer-stub");

    expect(drawers).toHaveLength(2);
    for (const drawer of drawers) {
      expect(drawer.attributes("direction")).toBe("rtl");
      expect(drawer.attributes("size")).toBe("72%");
      expect(drawer.attributes("append-to-body")).toBeDefined();
      expect(drawer.classes()).toContain("noobot-side-drawer");
      expect(drawer.classes()).toContain("noobot-file-preview-drawer");
    }
    wrapper.unmount();
  });

  it("applies one outer breathing state only while both runtime panels are visible and running", async () => {
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "runtime-panels-running",
        thinkingProbeVisible: true,
        role: "assistant",
        content: "",
        sessionId: "runtime-panels-session",
        turnScopeId: "workflow-node:runtime-panels",
        statusTurnScopeId: "workflow-node:runtime-panels",
        projectedStatusStepState: "sending",
      },
    });
    await nextTick();

    const panels = wrapper.get(".message-runtime-panels");
    expect(panels.classes()).toEqual(
      expect.arrayContaining(["has-status-steps", "has-thinking-panel", "is-running"]),
    );
    expect(panels.find(".message-status-steps").exists()).toBe(true);
    expect(panels.find(".thinking-panel-probe").exists()).toBe(true);
    expect(wrapper.get(".before-content-slot").find(".message-runtime-panels").exists()).toBe(true);
    expect(wrapper.get(".message-content-slot").find(".message-runtime-panels").exists()).toBe(
      false,
    );

    await wrapper.setProps({
      messageItem: {
        ...wrapper.props("messageItem"),
        projectedStatusStepState: "completed",
      },
    });
    expect(wrapper.get(".message-runtime-panels").classes()).not.toContain("is-running");
  });

  it("does not breathe when the host thinking panel has no visible content", async () => {
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "runtime-panel-hidden",
        role: "assistant",
        content: "",
        sessionId: "runtime-panels-session",
        turnScopeId: "workflow-node:hidden",
        statusTurnScopeId: "workflow-node:hidden",
        projectedStatusStepState: "sending",
      },
    });
    await nextTick();

    expect(wrapper.get(".message-runtime-panels").classes()).not.toContain("has-thinking-panel");
    expect(wrapper.get(".message-runtime-panels").classes()).not.toContain("is-running");
  });

  it("hosts the thinking panel for assistant messages without any plugin contribution", () => {
    const fetchExecutionReport = () => null;
    const assistant = mountItem({ fetchExecutionReport });
    const panel = assistant.findComponent({ name: "ThinkingPanel" });
    expect(panel.exists()).toBe(true);
    expect(panel.props("fetchExecutionReport")).toBe(fetchExecutionReport);

    const user = mountItem({ messageItem: { id: "user-1", role: "user", content: "hi" } });
    expect(user.findComponent({ name: "ThinkingPanel" }).exists()).toBe(false);
    expect(user.find(".message-runtime-panels").exists()).toBe(false);
  });

  it("mounts the current assistant body and unmounts it when collapsed", async () => {
    const wrapper = mountItem({
      currentTurn: true,
      messageItem: {
        presentationMessageId: "assistant-current",
        role: "assistant",
        content: "current body",
        sessionId: "session-content",
        turnScopeId: "turn-current",
      },
    });

    expect(wrapper.find(".BaseMarkdownContent-stub").exists()).toBe(true);
    await wrapper.find(".assistant-copy-actions").trigger("click");
    expect(wrapper.find(".BaseMarkdownContent-stub").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("current body");
  });

  it("keeps a historical assistant body collapsed by default and allows it to be expanded", async () => {
    const wrapper = mountItem({
      currentTurn: false,
      messageItem: {
        presentationMessageId: "assistant-history",
        role: "assistant",
        content: "historical body",
        sessionId: "session-content",
        turnScopeId: "turn-history",
      },
    });

    expect(wrapper.find(".BaseMarkdownContent-stub").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("historical body");
    await wrapper.find(".assistant-copy-actions").trigger("click");
    expect(wrapper.find(".BaseMarkdownContent-stub").text()).toBe("historical body");
  });

  it("preserves an explicit expansion when the current assistant turn becomes historical", async () => {
    const wrapper = mountItem({
      currentTurn: true,
      messageItem: {
        presentationMessageId: "assistant-explicit-history",
        role: "assistant",
        content: "explicit historical body",
        sessionId: "session-content",
        turnScopeId: "turn-explicit-history",
      },
    });

    await wrapper.find(".assistant-copy-actions").trigger("click");
    await wrapper.find(".assistant-copy-actions").trigger("click");
    await wrapper.setProps({ currentTurn: false });

    expect(wrapper.find(".BaseMarkdownContent-stub").text()).toBe("explicit historical body");
  });

  it("keeps the canonical asset area mounted while assistant body is collapsed", () => {
    const wrapper = mountItem({
      currentTurn: false,
      messageItem: {
        presentationMessageId: "assistant-assets-history",
        role: "assistant",
        content: "collapsed body",
        sessionId: "session-content",
        turnScopeId: "turn-assets-history",
        attachments: [
          {
            attachmentId: "asset-1",
            sessionId: "session-content",
            attachmentSource: "test",
            name: "report.pdf",
            size: 42,
          },
        ],
      },
    });

    expect(wrapper.find(".BaseMarkdownContent-stub").exists()).toBe(false);
    expect(wrapper.find(".BaseFileCardList-stub").exists()).toBe(true);
    expect(wrapper.find(".BaseAttachmentFileCard-stub").text()).toBe("report.pdf");
  });

  it("hides the message type tag for an empty assistant thinking host", () => {
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "thinking-placeholder",
        role: "assistant",
        type: "message",
        content: "",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    });

    expect(wrapper.find(".base-message-type-row").exists()).toBe(false);
  });

  it.each(["user", "assistant"])("hides the internal message label for %s content", (role) => {
    const wrapper = mountItem({
      currentTurn: true,
      messageItem: {
        presentationMessageId: `message-${role}`,
        role,
        type: "message",
        content: "hello",
      },
    });

    expect(wrapper.find(".base-message-type-row").exists()).toBe(false);
    expect(wrapper.find(".BaseMarkdownContent-stub").text()).toBe("hello");
  });

  it("keeps the type tag for persisted workflow messages", () => {
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "workflow-1",
        role: "assistant",
        type: "workflow",
        content: "WORKFLOW_DSL/1",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    });

    expect(wrapper.find(".base-message-type-row").text()).toBe("workflow");
  });

  it("passes displayed attachments to message card renderers", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-context-probe",
      id: "shared-message-context-probe:card",
      slot: "pre",
      component: TestRenderer,
      when: (context = {}) => resolveMessageViewKey(context?.messageItem) === "msg-1",
      resolveProps: (context = {}) => ({
        attachmentCount: Array.isArray(context.displayedAttachments)
          ? context.displayedAttachments.length
          : -1,
      }),
    });

    const wrapper = mountItem();
    const probe = wrapper.find(".context-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("1");
  });

  it("passes refreshed transfer envelope attachments through displayed attachments", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-transfer-context-probe",
      id: "shared-message-transfer-context-probe:card",
      slot: "pre",
      component: TestRenderer,
      when: (context = {}) => resolveMessageViewKey(context?.messageItem) === "msg-transfer",
      resolveProps: (context = {}) => ({
        attachmentCount: Array.isArray(context.displayedAttachments)
          ? context.displayedAttachments.length
          : -1,
      }),
    });

    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "msg-transfer",
        role: "assistant",
        content: "done",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer-shared-1",
            presentationMessageId: "msg-transfer",
            identity: {
              sessionId: "session-1",
              turnScopeId: "turn-1",
              runId: "run-1",
              producer: { type: "tool", id: "call-1" },
            },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: {
                    attachmentId: "att-transfer-1",
                    sessionId: "session-1",
                    attachmentSource: "test",
                  },
                  role: "primary",
                  name: "report.pdf",
                  mimeType: "application/pdf",
                  size: 42,
                },
              ],
            },
            intent: {
              source: "tool",
              reason: "semantic_transfer_tool_result",
              scenario: "tool",
              strategy: "tool_result_text",
            },
            meta: {},
          },
        ],
      },
    });
    const probe = wrapper.find(".context-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("1");
  });

  it("projects child-session persisted turn timing into the canonical renderer context", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-runtime-probe",
      id: "shared-message-runtime-probe:card",
      slot: "pre",
      component: RuntimeRenderer,
      when: (context = {}) => resolveMessageViewKey(context?.messageItem) === "msg-child-timing",
      resolveProps: (context = {}) => ({
        startedAt: context?.messageRuntime?.startedAt,
        thinkingFinishedAt: context?.messageRuntime?.thinkingFinishedAt,
        running: context?.messageRuntime?.running === true,
      }),
    });

    const wrapper = mountItem({
      storeSetup: (store) =>
        store.applyWorkflowRuntimeEvent(
          canonicalWorkflowSessionSnapshot({
            executionId: "agent-execution-child-session",
            nodeSessionId: "child-session",
            authoritySessionId: "parent-session",
            workflowRunId: "workflow-run-1",
            nodeExecutionId: "node-execution-1",
            aggregateVersion: 1,
            messages: [],
            turnTimings: [
              {
                dialogProcessId: "child-dialog",
                turnScopeId: "child-turn",
                thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
              },
            ],
          }),
          { source: "test_snapshot" },
        ),
      messageItem: {
        presentationMessageId: "msg-child-timing",
        role: "assistant",
        content: "child result",
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
      sessionDocs: [
        {
          sessionId: "child-session",
          turnTimings: [
            {
              dialogProcessId: "child-dialog",
              turnScopeId: "child-turn",
              thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
            },
          ],
        },
      ],
    });
    const probe = wrapper.find(".runtime-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-started-at")).toBe("");
    expect(probe.attributes("data-thinking-finished-at")).toBe("2026-07-29T09:44:56.296Z");
  });

  it("lets persisted child terminal facts close stale realtime sending state", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-terminal-runtime-probe",
      id: "shared-message-terminal-runtime-probe:card",
      slot: "pre",
      component: RuntimeRenderer,
      when: (context = {}) => resolveMessageViewKey(context?.messageItem) === "msg-child-terminal",
      resolveProps: (context = {}) => ({
        startedAt: context?.messageRuntime?.startedAt,
        thinkingFinishedAt: context?.messageRuntime?.thinkingFinishedAt,
        running: context?.messageRuntime?.running === true,
      }),
    });

    const wrapper = mountItem({
      storeSetup: (store) => {
        store.applyTurnRuntimeEvent({
          type: "backend_conversation_state",
          sessionId: "child-session-terminal",
          dialogProcessId: "child-dialog-terminal",
          turnScopeId: "workflow-node:terminal",
          state: "sending",
          updatedAt: "2026-07-29T09:44:50.000Z",
        });
        store.applyWorkflowRuntimeEvent(
          canonicalWorkflowSessionSnapshot({
            executionId: "agent-execution-child-session-terminal",
            nodeSessionId: "child-session-terminal",
            authoritySessionId: "parent-session",
            workflowRunId: "workflow-run-1",
            nodeExecutionId: "node-execution-1",
            aggregateVersion: 1,
            messages: [],
            turnTimings: [
              {
                dialogProcessId: "child-dialog-terminal",
                turnScopeId: "workflow-node:terminal",
                thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
              },
            ],
          }),
          { source: "test_snapshot" },
        );
      },
      messageItem: {
        presentationMessageId: "msg-child-terminal",
        role: "assistant",
        content: "child result",
        sessionId: "child-session-terminal",
        dialogProcessId: "child-dialog-terminal",
        turnScopeId: "workflow-node:terminal",
      },
      sessionDocs: [
        {
          sessionId: "child-session-terminal",
          turnTimings: [
            {
              dialogProcessId: "child-dialog-terminal",
              turnScopeId: "workflow-node:terminal",
              thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
            },
          ],
        },
      ],
    });
    const probe = wrapper.find(".runtime-probe");

    expect(probe.attributes("data-thinking-finished-at")).toBe("2026-07-29T09:44:56.296Z");
    expect(probe.attributes("data-running")).toBe("false");
  });

  it("does not render the default asset list when a post renderer suppresses default assets", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_POST, {
      pluginId: "shared-message-assets-suppress-probe",
      id: "shared-message-assets-suppress-probe:card",
      slot: "post",
      suppressDefaultAssets: true,
      component: AssetRenderer,
      when: (context = {}) => resolveMessageViewKey(context?.messageItem) === "msg-assets-suppress",
      resolveProps: (context = {}) => ({
        attachmentCount: Array.isArray(context.displayedAttachments)
          ? context.displayedAttachments.length
          : -1,
      }),
    });

    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "msg-assets-suppress",
        role: "assistant",
        content: "done",
        attachments: [
          {
            attachmentId: "att-1",
            sessionId: "runtime-panels-session",
            attachmentSource: "test",
            name: "a.txt",
            size: 12,
          },
          {
            attachmentId: "att-2",
            sessionId: "runtime-panels-session",
            attachmentSource: "test",
            name: "b.txt",
            size: 34,
          },
        ],
      },
    });

    const probe = wrapper.find(".asset-renderer-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("2");
    expect(wrapper.find(".BaseFileCardList-stub").exists()).toBe(false);
    expect(wrapper.findAll(".BaseAttachmentFileCard-stub")).toHaveLength(0);
  });

  it("passes embedded header visibility to the message shell", () => {
    const wrapper = mountItem({ hideHeader: true });

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("true");
  });

  it("shows a dedicated alert when the message's tool artifacts conflict", () => {
    const plain = mountItem();
    expect(plain.find(".BaseMessageErrorAlert-stub").exists()).toBe(false);
    const wrapper = mountItem({
      messageItem: {
        presentationMessageId: "msg-conflict",
        role: "assistant",
        content: "result",
        toolArtifactConflict: "transfer_identity_conflict",
      },
    });
    const alerts = wrapper.findAll(".BaseMessageErrorAlert-stub");
    expect(alerts.map((alert) => alert.attributes("data-error"))).toEqual([
      "message.toolArtifactConflict",
    ]);
  });

  it("renders artifact tabs as an accessible tablist with the first available tab active", () => {
    const wrapper = mountItem();
    const tabs = wrapper.findAll('.message-artifact-tabs [role="tab"]');

    expect(wrapper.find('.message-artifact-tabs [role="tablist"]').attributes("aria-label")).toBe(
      "message.artifactTabs",
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0].attributes("data-tab-name")).toBe("attachments");
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    const panel = wrapper.find('.message-artifact-tabs [role="tabpanel"]');
    expect(panel.attributes("aria-labelledby")).toBe(tabs[0].attributes("id"));
    expect(panel.findAll(".BaseAttachmentFileCard-stub")).toHaveLength(1);
    expect(wrapper.get(".after-content-slot").find(".message-artifact-tabs").exists()).toBe(true);
    expect(wrapper.get(".message-content-slot").find(".message-artifact-tabs").exists()).toBe(
      false,
    );
  });

  it("unmounts artifact tabs in the same flush they were mounted in", async () => {
    const errors = [];
    const visible = ref(false);
    const HideOnSetup = defineComponent({
      setup() {
        visible.value = false;
        return () => null;
      },
    });
    const host = mountItem();
    const messageProps = { ...host.props() };
    host.unmount();
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(
      defineComponent({
        setup() {
          return () =>
            visible.value ? [h(SharedChatMessageItem, messageProps), h(HideOnSetup)] : null;
        },
      }),
      {
        global: {
          plugins: [pinia],
          config: { errorHandler: (error) => errors.push(error) },
          ...createElementPlusMountOptions({
            "el-dialog": true,
            "el-tabs": ElTabs,
            ElTabs,
            "el-tab-pane": ElTabPane,
            ElTabPane,
          }),
        },
      },
    );
    visible.value = true;
    await nextTick();
    await nextTick();
    wrapper.unmount();

    expect(errors).toEqual([]);
  });
});
