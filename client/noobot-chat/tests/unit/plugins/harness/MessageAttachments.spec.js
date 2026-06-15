import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MessageAttachments from "../../../../../../plugin/noobot-plugin-harness/frontend/components/MessageAttachments.vue";

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
