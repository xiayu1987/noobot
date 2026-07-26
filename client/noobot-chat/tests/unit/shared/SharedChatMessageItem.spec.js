/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import SharedChatMessageItem from "../../../src/shared/message/SharedChatMessageItem.vue";
import { useChatStore } from "../../../src/shared/stores/useChatStore";
import { registerFrontendPlugin } from "../../../src/plugins/frontend-plugin-registry";

vi.mock("../../../src/shared/ui", async () => {
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

vi.mock("../../../src/shared/i18n/useLocale", () => ({
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
      },
    },
  });
}

describe("SharedChatMessageItem", () => {
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
      storeSetup: (store) => store.upsertWorkflowPlanningEvent({
        workflowRunId: "turn-workflow",
        sessionId: "session-1",
        dialogProcessId: "dialog-workflow",
        turnScopeId: "turn-workflow",
        semanticText: "WORKFLOW_DSL/1",
        nodeSessions: [{ nodeExecutionId: "node-1", status: "running" }],
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

  it("keeps the assistant header for a workflow node running placeholder", () => {
    const wrapper = mountItem({
      messageItem: {
        id: "workflow-node-running",
        role: "assistant",
        type: "message",
        content: "",
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "workflow-node:node-1",
        pending: true,
        workflowNodeRunningPlaceholder: true,
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

    useChatStore().upsertWorkflowPlanningEvent({
      workflowRunId: "workflow-late",
      sessionId: "session-late",
      dialogProcessId: "dialog-workflow-late",
      turnScopeId: "turn-workflow-late",
      semanticText: "WORKFLOW_DSL/1",
      nodeSessions: [{ nodeExecutionId: "node-late", status: "running" }],
    });
    await nextTick();

    expect(wrapper.find(".BaseMessageShell-stub").attributes("data-hide-header")).toBe("false");
  });

  it("passes displayed attachments to message card renderers with the legacy alias", () => {
    registerFrontendPlugin({
      id: "shared-message-context-probe",
      messageCards: [
        {
          id: "shared-message-context-probe:card",
          slot: "pre",
          component: TestRenderer,
          match: (messageItem = {}) => messageItem?.id === "msg-1",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            legacyAttachmentCount: Array.isArray(context.displayedAttachmentMetas)
              ? context.displayedAttachmentMetas.length
              : -1,
          }),
        },
      ],
    });

    const wrapper = mountItem();
    const probe = wrapper.find(".context-probe");

    expect(probe.exists()).toBe(true);
    expect(probe.attributes("data-attachment-count")).toBe("1");
    expect(probe.attributes("data-legacy-attachment-count")).toBe("1");
  });

  it("passes refreshed transfer envelope attachments through displayed attachments", () => {
    registerFrontendPlugin({
      id: "shared-message-transfer-context-probe",
      messageCards: [
        {
          id: "shared-message-transfer-context-probe:card",
          slot: "pre",
          component: TestRenderer,
          match: (messageItem = {}) => messageItem?.id === "msg-transfer",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            legacyAttachmentCount: Array.isArray(context.displayedAttachmentMetas)
              ? context.displayedAttachmentMetas.length
              : -1,
          }),
        },
      ],
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

  it("does not render the default asset list when a post renderer suppresses default assets", () => {
    registerFrontendPlugin({
      id: "shared-message-assets-suppress-probe",
      messageCards: [
        {
          id: "shared-message-assets-suppress-probe:card",
          slot: "post",
          suppressDefaultAssets: true,
          component: AssetRenderer,
          match: (messageItem = {}) => messageItem?.id === "msg-assets-suppress",
          resolveProps: (context = {}) => ({
            attachmentCount: Array.isArray(context.displayedAttachments)
              ? context.displayedAttachments.length
              : -1,
            writtenFileCount: Array.isArray(context.writtenFiles)
              ? context.writtenFiles.length
              : -1,
          }),
        },
      ],
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
