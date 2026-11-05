/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

vi.mock("../../../../../../src/shared/public-api/ui.js", async () => {
  const { defineComponent, h } = await import("vue");
  const { default: BaseMessageTypeTag } =
    await import("../../../../../../src/shared/ui/BaseMessageTypeTag.vue");
  const passthrough = (name) =>
    defineComponent({
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
        return () =>
          h(
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
      props: { error: { type: String, default: "" } },
      setup(props) {
        return () =>
          props.error
            ? h("div", { class: "BaseMessageErrorAlert-stub", "data-error": props.error })
            : null;
      },
    }),
    BaseMessageShell: defineComponent({
      name: "BaseMessageShell",
      props: { hideHeader: { type: Boolean, default: false } },
      setup(props, { slots }) {
        return () =>
          h(
            "div",
            {
              class: "BaseMessageShell-stub",
              "data-hide-header": String(props.hideHeader),
            },
            [
              h("div", { class: "before-content-slot" }, slots["before-content"]?.()),
              h("div", { class: "message-content-slot" }, slots.default?.()),
              h("div", { class: "after-content-slot" }, slots["after-content"]?.()),
            ],
          );
      },
    }),
    BaseMessageTypeTag,
    BasePreviewContent: defineComponent({
      name: "BasePreviewContent",
      setup() {
        return () => null;
      },
    }),
  };
});

vi.mock("../../../../../../src/modules/chat/components/thinking/ThinkingPanel.vue", async () => {
  const { defineComponent, h, onMounted } = await import("vue");
  return {
    default: defineComponent({
      name: "ThinkingPanel",
      props: {
        messageItem: { type: Object, default: () => ({}) },
        fetchExecutionReport: { type: Function, default: null },
      },
      emits: ["panel-visibility-change", "open-thinking-details"],
      setup(props, { emit }) {
        const visible = props.messageItem?.thinkingProbeVisible === true;
        onMounted(() => emit("panel-visibility-change", visible));
        return () => (visible ? h("div", { class: "thinking-panel-probe" }) : null);
      },
    }),
  };
});

vi.mock("../../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key = "") => key,
  }),
}));

export function mountItem(props = {}) {
  const { storeSetup, ...componentProps } = props;
  const pinia = createPinia();
  setActivePinia(pinia);
  storeSetup?.(useChatStore(pinia));
  const messageItem = componentProps.messageItem || {
    presentationMessageId: "msg-1",
    role: "assistant",
    content: "hello",
    attachments: [
      {
        attachmentId: "att-1",
        sessionId: "test-session",
        attachmentSource: "test",
        name: "a.txt",
        size: 12,
      },
    ],
  };
  return mount(SharedChatMessageItem, {
    props: {
      sessionDocs: [],
      userId: "u1",
      renderMarkdown: (content = "") => String(content || ""),
      formatTime: (value = "") => String(value || ""),
      formatFileSize: (value = 0) => String(value || 0),
      isImageMime: () => false,
      stopExecution: async () => true,
      fetchExecutionReport: async () => null,
      ...componentProps,
      messageItem,
      allMessages: componentProps.allMessages || [messageItem],
    },
    global: {
      plugins: [pinia],
      ...createElementPlusMountOptions({
        "el-drawer": true,
        "el-button": defineComponent({
          name: "ElButton",
          setup(_, { slots }) {
            return () => h("button", slots.default?.());
          },
        }),
      }),
    },
  });
}
