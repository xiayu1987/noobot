/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { createPinia, setActivePinia } from "pinia";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../../../../../../src/extensions/extension-point-ids.js";
import { clearSessionTurnUiStates } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";

vi.mock("../../../../../../src/shared/public-api/ui.js", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = (name) => defineComponent({
    name,
    setup(_, { slots }) {
      return () => h("div", { class: `${name}-stub` }, slots.default?.());
    },
  });
  return {
    BaseAttachmentFileCard: defineComponent({
      name: "BaseAttachmentFileCard",
      props: {
        attachmentItem: { type: Object, default: () => ({}) },
        nameText: { type: String, default: "" },
      },
      setup(props) {
        return () => h(
          "div",
          { class: "BaseAttachmentFileCard-stub" },
          props.nameText || props.attachmentItem?.name || props.attachmentItem?.fileName || "",
        );
      },
    }),
    BaseFileCardList: passthrough("BaseFileCardList"),
    BaseMarkdownContent: defineComponent({
      name: "BaseMarkdownContent",
      props: { content: { type: String, default: "" } },
      setup(props) {
        return () => h("div", { class: "BaseMarkdownContent-stub" }, props.content);
      },
    }),
    BaseMessageErrorAlert: defineComponent({
      name: "BaseMessageErrorAlert",
      setup() {
        return () => null;
      },
    }),
    BaseMessageShell: defineComponent({
      name: "BaseMessageShell",
      props: { hideHeader: { type: Boolean, default: false } },
      setup(props, { slots }) {
        return () => h("div", {
          class: "BaseMessageShell-stub",
          "data-hide-header": String(props.hideHeader),
        }, slots.default?.());
      },
    }),
    BaseMessageTypeTag: defineComponent({
      name: "BaseMessageTypeTag",
      setup() {
        return () => h("div", { class: "BaseMessageTypeTag-stub" });
      },
    }),
    BasePreviewContent: defineComponent({
      name: "BasePreviewContent",
      setup() {
        return () => null;
      },
    }),
  };
});

vi.mock("../../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key = "") => key,
  }),
}));

const TestRenderer = defineComponent({
  name: "SharedMessageContextProbe",
  props: {
    attachmentCount: { type: Number, default: 0 },
    legacyAttachmentCount: { type: Number, default: 0 },
  },
  setup(props) {
    return () => h("div", {
      class: "context-probe",
      "data-attachment-count": String(props.attachmentCount),
      "data-legacy-attachment-count": String(props.legacyAttachmentCount),
    });
  },
});

const AssetRenderer = defineComponent({
  name: "SharedMessageAssetRendererProbe",
  props: {
    attachmentCount: { type: Number, default: 0 },
    writtenFileCount: { type: Number, default: 0 },
  },
  setup(props) {
    return () => h("div", {
      class: "asset-renderer-probe",
      "data-attachment-count": String(props.attachmentCount),
      "data-written-file-count": String(props.writtenFileCount),
    });
  },
});

const RuntimeRenderer = defineComponent({
  name: "SharedMessageRuntimeProbe",
  props: {
    startedAt: { type: String, default: "" },
    finishedAt: { type: String, default: "" },
    running: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h("div", {
      class: "runtime-probe",
      "data-started-at": props.startedAt,
      "data-finished-at": props.finishedAt,
      "data-running": String(props.running),
    });
  },
});

const VisibleThinkingRenderer = defineComponent({
  name: "VisibleThinkingRenderer",
  emits: ["panel-visibility-change"],
  setup(_, { emit }) {
    onMounted(() => emit("panel-visibility-change", true));
    return () => h("div", { class: "thinking-panel-probe" });
  },
});

const HiddenThinkingRenderer = defineComponent({
  name: "HiddenThinkingRenderer",
  emits: ["panel-visibility-change"],
  setup(_, { emit }) {
    onMounted(() => emit("panel-visibility-change", false));
    return () => null;
  },
});

function contributeThinkingPanel(component, messageId) {
  contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
    pluginId: "thinking-panel-test",
    id: "thinking-panel",
    slot: "pre",
    component,
    when: (context = {}) => context?.messageItem?.id === messageId,
  });
}

function mountItem(props = {}) {
  const { storeSetup, ...componentProps } = props;
  const pinia = createPinia();
  setActivePinia(pinia);
  storeSetup?.(useChatStore(pinia));
  return mount(SharedChatMessageItem, {
    props: {
      messageItem: {
        id: "msg-1",
        role: "assistant",
        content: "hello",
        attachments: [
          {
            attachmentId: "att-1",
            name: "a.txt",
            size: 12,
          },
        ],
      },
      allMessages: [],
      sessionDocs: [],
      userId: "u1",
      renderMarkdown: (content = "") => String(content || ""),
      formatTime: (value = "") => String(value || ""),
      formatFileSize: (value = 0) => String(value || 0),
      isImageMime: () => false,
      ...componentProps,
    },
    global: {
      plugins: [pinia],
      stubs: {
        "el-dialog": true,
        "el-button": defineComponent({
          name: "ElButton",
          setup(_, { slots }) {
            return () => h("button", slots.default?.());
          },
        }),
      },
    },
  });
}

describe("SharedChatMessageItem", () => {
  afterEach(() => {
    clearSessionTurnUiStates("session-content");
    clearExtensionRegistry();
  });

  it("applies one outer breathing state only while both runtime panels are visible and running", async () => {
    contributeThinkingPanel(VisibleThinkingRenderer, "runtime-panels-running");
    const wrapper = mountItem({
      messageItem: {
        id: "runtime-panels-running",
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
    expect(panels.classes()).toEqual(expect.arrayContaining([
      "has-status-steps",
      "has-thinking-panel",
      "is-running",
    ]));
    expect(panels.find(".message-status-steps").exists()).toBe(true);
    expect(panels.find(".thinking-panel-probe").exists()).toBe(true);

    await wrapper.setProps({
      messageItem: {
        ...wrapper.props("messageItem"),
        projectedStatusStepState: "completed",
      },
    });
    expect(wrapper.get(".message-runtime-panels").classes()).not.toContain("is-running");
  });

  it("does not breathe when the thinking contribution has no visible panel", async () => {
    contributeThinkingPanel(HiddenThinkingRenderer, "runtime-panel-hidden");
    const wrapper = mountItem({
      messageItem: {
        id: "runtime-panel-hidden",
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

  it("mounts the current assistant body and unmounts it when collapsed", async () => {
    const wrapper = mountItem({
      currentTurn: true,
      messageItem: {
        id: "assistant-current",
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

  it("does not mount a historical assistant body until expanded", async () => {
    const wrapper = mountItem({
      currentTurn: false,
      messageItem: {
        id: "assistant-history",
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

  it("keeps the canonical asset area mounted while assistant body is collapsed", () => {
    const wrapper = mountItem({
      currentTurn: false,
      messageItem: {
        id: "assistant-assets-history",
        role: "assistant",
        content: "collapsed body",
        sessionId: "session-content",
        turnScopeId: "turn-assets-history",
        attachments: [{ attachmentId: "asset-1", name: "report.pdf", size: 42 }],
      },
    });

    expect(wrapper.find(".BaseMarkdownContent-stub").exists()).toBe(false);
    expect(wrapper.find(".BaseFileCardList-stub").exists()).toBe(true);
    expect(wrapper.find(".BaseAttachmentFileCard-stub").text()).toBe("report.pdf");
  });

  it("hides the message type tag for an empty assistant thinking host", () => {
    const wrapper = mountItem({
      messageItem: {
        id: "thinking-placeholder",
        role: "assistant",
        type: "message",
        content: "",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    });

    expect(wrapper.find(".BaseMessageTypeTag-stub").exists()).toBe(false);
  });

  it("keeps the type tag for persisted workflow messages", () => {
    const wrapper = mountItem({
      messageItem: {
        id: "workflow-1",
        role: "assistant",
        type: "workflow",
        content: "WORKFLOW_DSL/1",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    });

    expect(wrapper.find(".BaseMessageTypeTag-stub").exists()).toBe(true);
  });

  it("keeps the single outer assistant header that owns a live workflow", () => {
    const wrapper = mountItem({
      storeSetup: (store) => store.applyWorkflowRuntimeEvent({
        event: "workflow_planning_message_prepared",
        data: {
          workflowRunId: "turn-workflow",
          sessionId: "session-1",
          dialogProcessId: "dialog-workflow",
          turnScopeId: "turn-workflow",
          semanticText: "WORKFLOW_DSL/1",
          nodeSessions: [{ nodeExecutionId: "node-1", status: "running" }],
        },
      }),
      messageItem: {
        id: "workflow-thinking-host",
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
        id: "workflow-thinking-host-late",
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

    useChatStore().applyWorkflowRuntimeEvent({
      event: "workflow_planning_message_prepared",
      data: {
        workflowRunId: "workflow-late",
        sessionId: "session-late",
        dialogProcessId: "dialog-workflow-late",
        turnScopeId: "turn-workflow-late",
        semanticText: "WORKFLOW_DSL/1",
        nodeSessions: [{ nodeExecutionId: "node-late", status: "running" }],
      },
    });
    await nextTick();

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("false");
  });

  it("passes displayed attachments to message card renderers with the legacy alias", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
          pluginId: "shared-message-context-probe",
          id: "shared-message-context-probe:card",
          slot: "pre",
          component: TestRenderer,
          when: (context = {}) => context?.messageItem?.id === "msg-1",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            legacyAttachmentCount: Array.isArray(context.displayedAttachmentMetas)
              ? context.displayedAttachmentMetas.length
              : -1,
          }),
    });

    const wrapper = mountItem();
    const probe = wrapper.find(".context-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("1");
    expect(probe.attributes("data-legacy-attachment-count")).toBe("1");
  });

  it("passes refreshed transfer envelope attachments through displayed attachments", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
          pluginId: "shared-message-transfer-context-probe",
          id: "shared-message-transfer-context-probe:card",
          slot: "pre",
          component: TestRenderer,
          when: (context = {}) => context?.messageItem?.id === "msg-transfer",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            legacyAttachmentCount: Array.isArray(context.displayedAttachmentMetas)
              ? context.displayedAttachmentMetas.length
              : -1,
          }),
    });

    const wrapper = mountItem({
      messageItem: {
        id: "msg-transfer",
        role: "assistant",
        content: "done",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            files: [
              {
                role: "primary",
                filePath: "runtime/attach/report.pdf",
                attachmentMeta: {
                  attachmentId: "att-transfer-1",
                  name: "report.pdf",
                  mimeType: "application/pdf",
                  size: 42,
                },
              },
            ],
          },
        ],
      },
    });
    const probe = wrapper.find(".context-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("1");
    expect(probe.attributes("data-legacy-attachment-count")).toBe("1");
  });

  it("projects child-session persisted turn timing into the canonical renderer context", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-runtime-probe",
      id: "shared-message-runtime-probe:card",
      slot: "pre",
      component: RuntimeRenderer,
      when: (context = {}) => context?.messageItem?.id === "msg-child-timing",
      resolveProps: (context = {}) => ({
        startedAt: context?.messageRuntime?.startedAt || "",
        finishedAt: context?.messageRuntime?.finishedAt || "",
        running: context?.messageRuntime?.running === true,
      }),
    });

    const wrapper = mountItem({
      storeSetup: (store) => store.applyWorkflowRuntimeEvent({
        event: "workflow_session_snapshot_loaded",
        data: {
          sessionId: "child-session",
          snapshotVersion: 1,
          turnTimings: [{
            dialogProcessId: "child-dialog",
            turnScopeId: "child-turn",
            thinkingStartedAt: "2026-07-29T09:44:50.000Z",
            thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
          }],
        },
      }, { source: "test_snapshot" }),
      messageItem: {
        id: "msg-child-timing",
        role: "assistant",
        content: "child result",
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
      sessionDocs: [{
        sessionId: "child-session",
        turnTimings: [{
          dialogProcessId: "child-dialog",
          turnScopeId: "child-turn",
          thinkingStartedAt: "2026-07-29T09:44:50.000Z",
          thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
        }],
      }],
    });
    const probe = wrapper.find(".runtime-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-started-at")).toBe("2026-07-29T09:44:50.000Z");
    expect(probe.attributes("data-finished-at")).toBe("2026-07-29T09:44:56.296Z");
  });

  it("lets persisted child terminal facts close stale realtime sending state", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_PRE, {
      pluginId: "shared-message-terminal-runtime-probe",
      id: "shared-message-terminal-runtime-probe:card",
      slot: "pre",
      component: RuntimeRenderer,
      when: (context = {}) => context?.messageItem?.id === "msg-child-terminal",
      resolveProps: (context = {}) => ({
        startedAt: context?.messageRuntime?.startedAt || "",
        finishedAt: context?.messageRuntime?.finishedAt || "",
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
        store.applyWorkflowRuntimeEvent({
          event: "workflow_session_snapshot_loaded",
          data: {
            sessionId: "child-session-terminal",
            snapshotVersion: 1,
            turnTimings: [{
              dialogProcessId: "child-dialog-terminal",
              turnScopeId: "workflow-node:terminal",
              thinkingStartedAt: "2026-07-29T09:44:50.000Z",
              thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
            }],
          },
        }, { source: "test_snapshot" });
      },
      messageItem: {
        id: "msg-child-terminal",
        role: "assistant",
        content: "child result",
        sessionId: "child-session-terminal",
        dialogProcessId: "child-dialog-terminal",
        turnScopeId: "workflow-node:terminal",
      },
      sessionDocs: [{
        sessionId: "child-session-terminal",
        turnTimings: [{
          dialogProcessId: "child-dialog-terminal",
          turnScopeId: "workflow-node:terminal",
          thinkingStartedAt: "2026-07-29T09:44:50.000Z",
          thinkingFinishedAt: "2026-07-29T09:44:56.296Z",
        }],
        turnStatuses: [{
          dialogProcessId: "child-dialog-terminal",
          turnScopeId: "workflow-node:terminal",
          status: "completed",
        }],
      }],
    });
    const probe = wrapper.find(".runtime-probe");

    expect(probe.attributes("data-finished-at")).toBe("2026-07-29T09:44:56.296Z");
    expect(probe.attributes("data-running")).toBe("false");
  });

  it("does not render the default asset list when a post renderer suppresses default assets", () => {
    contributeExtension(EXTENSION_POINTS.MESSAGE_CARD_POST, {
          pluginId: "shared-message-assets-suppress-probe",
          id: "shared-message-assets-suppress-probe:card",
          slot: "post",
          suppressDefaultAssets: true,
          component: AssetRenderer,
          when: (context = {}) => context?.messageItem?.id === "msg-assets-suppress",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            writtenFileCount: Array.isArray(context.writtenFiles)
              ? context.writtenFiles.length
              : -1,
          }),
    });

    const wrapper = mountItem({
      messageItem: {
        id: "msg-assets-suppress",
        role: "assistant",
        content: "done",
        attachments: [
          { attachmentId: "att-1", name: "a.txt", size: 12 },
          { attachmentId: "att-2", name: "b.txt", size: 34 },
        ],
      },
    });

    const probe = wrapper.find(".asset-renderer-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("2");
    expect(probe.attributes("data-written-file-count")).toBe("0");
    expect(wrapper.find(".BaseFileCardList-stub").exists()).toBe(false);
    expect(wrapper.findAll(".BaseAttachmentFileCard-stub")).toHaveLength(0);
  });

  it("passes embedded header visibility to the message shell", () => {
    const wrapper = mountItem({ hideHeader: true });

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("true");
  });
});
