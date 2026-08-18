/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BaseAttachmentFileCard from "../../../src/shared/ui/BaseAttachmentFileCard.vue";

function mountCard(overrides = {}) {
  return mount(BaseAttachmentFileCard, {
    props: {
      attachmentItem: {
        attachmentId: "source-attachment-id",
        sessionId: "session-id",
        attachmentSource: "user",
        name: "source.pdf",
        mimeType: "application/pdf",
        relations: [
          {
            relationType: "parsed_result",
            sourceIdentity: {
              attachmentId: "source-attachment-id",
              sessionId: "session-id",
              attachmentSource: "user",
            },
            targetIdentity: {
              attachmentId: "parsed-attachment-id",
              sessionId: "session-id",
              attachmentSource: "model",
            },
            name: "source.md",
            mimeType: "text/markdown",
            createdAt: "2026-08-16T00:00:00.000Z",
          },
        ],
      },
      userId: "admin",
      isImageMime: () => false,
      canPreviewAttachment: () => true,
      canPreviewParsedResult: () => true,
      formatFileSize: (size) => String(size),
      showParsedResult: true,
      ...overrides,
    },
    global: {
      stubs: {
        "el-icon": { template: "<span><slot /></span>" },
      },
    },
  });
}

describe("BaseAttachmentFileCard parsed result actions", () => {
  it("renders preview and download for a canonical parsed result with user access identity", () => {
    const wrapper = mountCard();

    expect(wrapper.find(".parsed-result-row").exists()).toBe(true);
    expect(wrapper.findAll(".parsed-result-action")).toHaveLength(2);
  });

  it("emits the canonical source attachment for parsed-result actions", async () => {
    const wrapper = mountCard();
    const actions = wrapper.findAll(".parsed-result-action");

    await actions[0].trigger("click");
    await actions[1].trigger("click");

    expect(wrapper.emitted("preview-parsed-result")?.[0]?.[0]).toBe(
      wrapper.props("attachmentItem"),
    );
    expect(wrapper.emitted("download-parsed-result")?.[0]?.[0]).toBe(
      wrapper.props("attachmentItem"),
    );
  });

  it("renders relation actions independently from the API caller identity", () => {
    const wrapper = mountCard({ userId: "" });

    expect(wrapper.find(".parsed-result-row").exists()).toBe(true);
  });
});
