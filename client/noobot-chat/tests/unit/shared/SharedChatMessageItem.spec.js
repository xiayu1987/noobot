import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import SharedChatMessageItem from "../../../src/shared/message/SharedChatMessageItem.vue";
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
    BaseMessageShell: passthrough("BaseMessageShell"),
    BaseMessageTypeTag: defineComponent({
      name: "BaseMessageTypeTag",
      setup() {
        return () => null;
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

function mountItem(props = {}) {
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
      ...props,
    },
    global: {
      stubs: {
        "el-dialog": true,
      },
    },
  });
}

describe("SharedChatMessageItem", () => {
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
});
