/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, storeToRefs } from "pinia";
import { defineComponent, h, nextTick, ref } from "vue";
import ChatMessageListPanel from "../../../../../../src/modules/chat/components/navigation/ChatMessageListPanel.vue";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { useChatList } from "../../../../../../src/modules/chat/composables/useChatList.js";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { configureAuthenticatedFetcher } from "../../../../../../src/infrastructure/http/authenticatedHttpService.js";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";
import { clearSessionTurnUiStates } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";

describe("generated images across session changes", () => {
  let wrapper;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    clearSessionTurnUiStates("image-session");
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "creates and revisits sessions through the real list (authorization pending: %s)",
    async (pending) => {
      vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      const ticketResponse = (token) => ({
        ok: true,
        json: async () => ({ ok: true, token, expiresAt: Date.now() + 60000 }),
      });
      const outstanding = [];
      const fetcher = vi.fn(() =>
        pending
          ? new Promise((resolve) => outstanding.push(resolve))
          : Promise.resolve(ticketResponse("image-ticket")),
      );
      configureAuthenticatedFetcher(fetcher);
      const errors = [];
      let store;
      const messages = [
        {
          presentationMessageId: "generated-image",
          sessionId: "image-session",
          turnScopeId: "image-turn",
          role: "assistant",
          content: "Generating",
          attachments: [],
        },
      ];
      const { renderMarkdown } = useMarkdownRenderer();
      const SessionHost = defineComponent({
        setup() {
          store = useChatStore();
          store.sessions = [
            { sessionId: "image-session", isLocal: true, loaded: true, messages, sessionDocs: [] },
          ];
          store.activeSessionId = "image-session";
          const sessionActions = useChatList({
            ...storeToRefs(store),
            chatStore: store,
            userId: ref("image-user"),
            connected: ref(true),
            ensureConnected: () => true,
            authFetch: fetcher,
            createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
            generateSessionId: () => "new-empty-session",
            refreshSessionConnectorsAsync: vi.fn(),
            notify: vi.fn(),
            makeViewMessage: (message) => ({ ...message }),
            onSessionDetailApplied: vi.fn(),
            getSessionsApi: vi.fn(() => {
              throw new Error("unexpected session list request");
            }),
            getSessionDetailApi: vi.fn(() => {
              throw new Error("unexpected session detail request");
            }),
            deleteSessionApi: vi.fn(() => {
              throw new Error("unexpected session deletion");
            }),
            renameSessionApi: vi.fn(() => {
              throw new Error("unexpected session rename");
            }),
          });
          return () =>
            h("div", [
              h(
                "button",
                { class: "new-session", onClick: sessionActions.newSession },
                "New session",
              ),
              h(
                "button",
                {
                  class: "old-session",
                  onClick: () => sessionActions.selectSession("image-session"),
                },
                "Old session",
              ),
              h(ChatMessageListPanel, {
                activeSession: store.activeSession,
                shouldRenderMessageInChat: () => true,
                userId: "image-user",
                renderMarkdown,
                stopExecution: async () => true,
                fetchExecutionReport: async () => null,
                formatTime: String,
                formatFileSize: String,
                isImageMime: (mimeType) => mimeType.startsWith("image/"),
              }),
            ]);
        },
      });
      wrapper = mount(SessionHost, {
        global: {
          plugins: [createPinia()],
          config: { errorHandler: (error) => errors.push(error) },
          ...createElementPlusMountOptions({
            ThinkingPanel: true,
            BaseFilePreviewDrawer: true,
            "el-scrollbar": defineComponent({
              mounted() {
                Object.defineProperty(this.$el, "clientHeight", { value: 2000 });
                Object.defineProperty(this.$el, "clientWidth", { value: 2000 });
              },
              setup(_props, { slots, expose }) {
                const wrapRef = ref(null);
                expose({ wrapRef });
                return () => h("div", { ref: wrapRef }, slots.default?.());
              },
            }),
          }),
        },
      });
      const imageRef = "attachment:v1:image-session/model/generated-image";
      const panel = wrapper.getComponent(ChatMessageListPanel).element;
      const liveMessages = store.activeSession.messages;
      liveMessages[0].attachments = [
        {
          attachmentId: "generated-image",
          sessionId: "image-session",
          attachmentSource: "model",
          name: "bird.png",
          mimeType: "image/png",
        },
      ];
      liveMessages[0].content = `![bird](${imageRef})`;
      await flushPromises();
      expect(errors).toEqual([]);
      expect(wrapper.get(".base-markdown-content img").attributes("src")).toEqual(
        pending ? undefined : expect.stringContaining("image-ticket"),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(liveMessages[0].attachments[0]).not.toHaveProperty("url");

      liveMessages.push({
        presentationMessageId: "reused-image",
        sessionId: "image-session",
        turnScopeId: "reuse-turn",
        role: "assistant",
        content: `![again](${imageRef})`,
        attachments: [],
      });
      await flushPromises();
      expect(errors).toEqual([]);
      await wrapper.get('.assistant-copy-actions[aria-expanded="false"]').trigger("click");
      await flushPromises();
      expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(2);
      const oldSignals = fetcher.mock.calls.map(([, options]) => options.signal);
      await wrapper.get(".new-session").trigger("click");
      await flushPromises();
      expect(store.activeSessionId).toBe("new-empty-session");
      expect(wrapper.getComponent(ChatMessageListPanel).element).toBe(panel);
      expect(wrapper.find(".empty-state").exists()).toBe(true);
      expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(0);
      expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
      await wrapper.get(".old-session").trigger("click");
      await flushPromises();
      expect(store.activeSessionId).toBe("image-session");
      expect(wrapper.getComponent(ChatMessageListPanel).element).toBe(panel);
      expect(wrapper.findAll(".base-markdown-content img")).toHaveLength(2);
      if (pending) {
        for (const resolve of outstanding.splice(0, oldSignals.length))
          resolve(ticketResponse("stale-ticket"));
        await flushPromises();
        for (const image of wrapper.findAll(".base-markdown-content img"))
          expect(image.attributes("src")).toBeUndefined();
        for (const resolve of outstanding) resolve(ticketResponse("current-ticket"));
        await flushPromises();
        for (const image of wrapper.findAll(".base-markdown-content img"))
          expect(image.attributes("src")).toContain("current-ticket");
      }
      expect(liveMessages[0].attachments[0]).not.toHaveProperty("url");
      wrapper.unmount();
      wrapper = null;
      await nextTick();
      expect(errors).toEqual([]);
    },
  );
});
