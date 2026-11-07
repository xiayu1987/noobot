/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import BaseMarkdownContent from "../../../src/shared/ui/BaseMarkdownContent.vue";
import { configureAuthenticatedFetcher } from "../../../src/infrastructure/http/authenticatedHttpService.js";
import { normalizeMessageAttachments } from "../../../src/modules/chat/model/messageModel.js";
import { buildAttachmentRefIndex } from "../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";
import { useMarkdownRenderer } from "../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { RESOURCE_ACCESS_TOKEN_QUERY } from "@noobot/shared/resource-access";

const REF = "attachment:v1:s1/model/a1";
const attachments = normalizeMessageAttachments(
  [
    {
      attachmentId: "a1",
      sessionId: "s1",
      attachmentSource: "model",
      name: "bird.png",
      mimeType: "image/png",
    },
  ],
  { userId: "admin" },
);

describe("Markdown attachment image authorization", () => {
  let wrapper;
  let fetcher;
  function mountImage(content = `![bird](${REF})`) {
    wrapper = mount(BaseMarkdownContent, {
      props: {
        content,
        renderMarkdown: useMarkdownRenderer().renderMarkdown,
        attachmentRefIndex: buildAttachmentRefIndex(attachments),
        linkSnapshots: [],
        messageIndex: 0,
        workspaceRootDirectory: null,
        translate: (key) => key,
      },
    });
    return wrapper;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    fetcher = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        token: `ticket-${fetcher.mock.calls.length}`,
        expiresAt: Date.now() + 10000,
      }),
    }));
    configureAuthenticatedFetcher(fetcher);
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("withholds src until authorized and shares tickets across repeated images and stream updates", async () => {
    mountImage(`![bird](${REF}) ![bird again](${REF})`);
    expect(wrapper.get("img").attributes("src")).toBeUndefined();
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      target: attachments[0].url.slice(4),
    });
    for (const image of wrapper.findAll("img")) {
      const src = new URL(image.attributes("src"), window.location.origin);
      expect(src.searchParams.get(RESOURCE_ACCESS_TOKEN_QUERY)).toBe("ticket-1");
      expect(src.searchParams.get("sessionId")).toBe("s1");
      expect(src.searchParams.get("attachmentSource")).toBe("model");
    }
    await wrapper.setProps({ content: `updated ![bird](${REF})` });
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("renews tickets and cancels renewal when the image disappears", async () => {
    mountImage();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.get("img").attributes("src")).toContain("ticket-2");
    const signal = fetcher.mock.calls[1][1].signal;
    await wrapper.setProps({ content: "removed" });
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shows authorization errors and emits link-error without an unauthenticated src", async () => {
    fetcher.mockResolvedValue({ ok: false, status: 403 });
    mountImage();
    await flushPromises();
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 403");
    expect(wrapper.emitted("link-error")[0][0].message).toContain("HTTP 403");
  });

  it("aborts pending authorization on unmount and ignores its late response", async () => {
    let finish;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mountImage();
    await flushPromises();
    const signal = fetcher.mock.calls[0][1].signal;
    wrapper.unmount();
    wrapper = null;
    expect(signal.aborted).toBe(true);
    finish({
      ok: true,
      json: async () => ({ ok: true, token: "late", expiresAt: Date.now() + 10000 }),
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
