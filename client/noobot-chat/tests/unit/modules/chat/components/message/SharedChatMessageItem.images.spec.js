/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { defineComponent, h, nextTick, ref } from "vue";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { configureAuthenticatedFetcher } from "../../../../../../src/infrastructure/http/authenticatedHttpService.js";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

describe("generated images across session changes", () => {
  let wrapper;
  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
  });

  it("renders raw live attachments, references earlier images, and switches to an empty session", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    configureAuthenticatedFetcher(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, token: "image-ticket", expiresAt: Date.now() + 60000 }),
      })),
    );
    const errors = [];
    const messages = ref([
      {
        presentationMessageId: "generated-image",
        sessionId: "image-session",
        turnScopeId: "image-turn",
        role: "assistant",
        content: "Generating",
        attachments: [],
      },
    ]);
    const activeSessionId = ref("image-session");
    const { renderMarkdown } = useMarkdownRenderer();
    const SessionHost = defineComponent({
      setup() {
        return () =>
          h(
            "div",
            { key: activeSessionId.value },
            activeSessionId.value === "image-session"
              ? messages.value.map((messageItem) =>
                  h(SharedChatMessageItem, {
                    key: messageItem.presentationMessageId,
                    messageItem,
                    allMessages: messages.value,
                    currentTurn: true,
                    userId: "image-user",
                    renderMarkdown,
                    stopExecution: async () => true,
                    fetchExecutionReport: async () => null,
                    formatTime: String,
                    formatFileSize: String,
                    isImageMime: (mimeType) => mimeType.startsWith("image/"),
                  }),
                )
              : [],
          );
      },
    });
    wrapper = mount(SessionHost, {
      global: {
        plugins: [createPinia()],
        config: { errorHandler: (error) => errors.push(error) },
        ...createElementPlusMountOptions({ ThinkingPanel: true, BaseFilePreviewDrawer: true }),
      },
    });
    const imageRef = "attachment:v1:image-session/model/generated-image";
    messages.value[0].attachments = [
      {
        attachmentId: "generated-image",
        sessionId: "image-session",
        attachmentSource: "model",
        name: "bird.png",
        mimeType: "image/png",
      },
    ];
    messages.value[0].content = `![bird](${imageRef})`;
    await flushPromises();
    expect(errors).toEqual([]);
    expect(wrapper.get(".base-markdown-content img").attributes("src")).toContain("image-ticket");
    expect(messages.value[0].attachments[0]).not.toHaveProperty("url");

    messages.value.push({
      presentationMessageId: "reused-image",
      sessionId: "image-session",
      turnScopeId: "reuse-turn",
      role: "assistant",
      content: `![again](${imageRef})`,
      attachments: [],
    });
    await flushPromises();
    expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(2);
    activeSessionId.value = "new-empty-session";
    await nextTick();
    expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(0);
    activeSessionId.value = "image-session";
    await flushPromises();
    expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(2);
    expect(errors).toEqual([]);
  });
});
