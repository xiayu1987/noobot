import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import MessageAttachments from "../../../../../../plugin/noobot-plugin-harness/frontend/components/MessageAttachments.vue";

vi.mock("../../../../src/shared/ui", () => ({
  BaseFileCardList: defineComponent({
    name: "BaseFileCardList",
    template: "<div class='base-file-card-list-stub'><slot /></div>",
  }),
  BaseAttachmentFileCard: defineComponent({
    name: "BaseAttachmentFileCard",
    props: {
      attachmentItem: { type: Object, required: true },
      translate: { type: Function, required: true },
      formatFileSize: { type: Function, required: true },
      showParsedResult: { type: Boolean, default: false },
    },
    emits: ["preview", "download", "preview-parsed-result", "download-parsed-result"],
    template: `
      <div class='base-attachment-file-card-stub'>
        <span>{{ attachmentItem.name }}</span>
        <span v-if='showParsedResult'>{{ translate("message.parsedResultLabel") }}</span>
        <button
          v-if='showParsedResult && attachmentItem.parsedResultAttachmentId && attachmentItem.parsedResultUrl'
          type='button'
          :title='translate("message.previewParsedResult", { name: attachmentItem.parsedResultName || translate("message.parsedResultDefaultName") })'
          @click='$emit("preview-parsed-result", attachmentItem)'
        >{{ translate("message.previewParsedResultShort") }}</button>
        <button
          v-if='showParsedResult && attachmentItem.parsedResultAttachmentId && attachmentItem.parsedResultUrl'
          type='button'
          :title='translate("message.downloadParsedResult", { name: attachmentItem.parsedResultName || translate("message.parsedResultDefaultName") })'
          @click='$emit("download-parsed-result", attachmentItem)'
        >{{ translate("message.downloadParsedResultShort") }}</button>
      </div>
    `,
  }),
}));

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key, params = {}) => ({
      "message.parsedResult": "解析结果",
      "message.parsedResultLabel": "解析结果",
      "message.previewParsedResult": `预览解析结果 ${params.name || ""}`.trim(),
      "message.previewParsedResultShort": "预览",
      "message.downloadParsedResult": `下载解析结果 ${params.name || ""}`.trim(),
      "message.downloadParsedResultShort": "下载",
      "message.parsedResultDefaultName": "解析结果.md",
      "message.pluginAttachment": "插件附件",
      "composer.expand": "展开",
      "message.collapse": "收起",
    }[key] || key),
  }),
}));

function mountMessageAttachments(overrides = {}) {
  return mount(MessageAttachments, {
    props: {
      attachments: [
        {
          attachmentId: "src-1",
          name: "source.pdf",
          mimeType: "application/pdf",
          parsedResultAttachmentId: "parsed-1",
          parsedResultUrl: "/api/attachments/parsed-1",
          parsedResultName: "source.md",
        },
      ],
      isImageMime: () => false,
      canPreviewAttachment: () => true,
      formatFileSize: (size) => `${size || 0} B`,
      userId: "admin",
      ...overrides,
    },
    global: {
      stubs: {
        "el-icon": true,
      },
    },
  });
}

describe("MessageAttachments parsed result", () => {
  it("shows parsed result actions for normal attachments", () => {
    const wrapper = mountMessageAttachments();

    expect(wrapper.text()).toContain("解析结果");
    expect(wrapper.text()).toContain("预览");
    expect(wrapper.text()).toContain("下载");
  });

  it("emits parsed result preview and download payloads", async () => {
    const wrapper = mountMessageAttachments();
    const buttons = wrapper.findAll("button");
    const previewButton = buttons.find((button) => button.attributes("title") === "预览解析结果 source.md");
    const downloadButton = buttons.find((button) => button.attributes("title") === "下载解析结果 source.md");

    expect(previewButton).toBeTruthy();
    expect(downloadButton).toBeTruthy();

    await previewButton.trigger("click");
    await downloadButton.trigger("click");

    expect(wrapper.emitted("preview")?.[0]?.[0]).toMatchObject({
      attachmentId: "parsed-1",
      name: "source.md",
      mimeType: "text/markdown",
      previewUrl: "/api/attachments/parsed-1",
    });
    expect(wrapper.emitted("download")?.[0]?.[0]).toMatchObject({
      attachmentId: "parsed-1",
      name: "source.md",
      mimeType: "text/markdown",
      previewUrl: "/api/attachments/parsed-1",
    });
  });
});
