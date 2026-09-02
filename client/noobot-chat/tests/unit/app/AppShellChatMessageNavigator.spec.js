/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import AppShellLayout from "../../../src/app/shell/AppShellLayout.vue";
import AppShellDrawers from "../../../src/app/shell/AppShellDrawers.vue";
import { openChatMessageNavigator } from "../../../src/app/state/chatMessageNavigatorState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/shell/AppShell.vue"),
  "utf8",
);
const appShellLayoutSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/shell/AppShellLayout.vue"),
  "utf8",
);
const chatMessageListPanelSource = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/modules/chat/components/navigation/ChatMessageListPanel.vue",
  ),
  "utf8",
);
const appShellDrawersSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/shell/AppShellDrawers.vue"),
  "utf8",
);
const connectorManagerSource = readFileSync(
  path.resolve(__dirname, "../../../src/modules/connectors/components/ConnectorManager.vue"),
  "utf8",
);
const chatMessageNavigatorPanelSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/composables/useChatMessageNavigatorPanel.js"),
  "utf8",
);
const chatMessageScrollSyncSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/runtime/chatMessageScrollSync.js"),
  "utf8",
);
const chatMessageNavigatorStateSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/state/chatMessageNavigatorState.js"),
  "utf8",
);
const chatMessageNavigatorComponentSource = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/modules/chat/components/navigation/ChatMessageNavigator.vue",
  ),
  "utf8",
);
const chatMessageNavItemsStateSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/state/chatMessageNavItemsState.js"),
  "utf8",
);

describe("AppShell chat message navigator", () => {
  it("keeps desktop navigation and connector overview independent from more actions", () => {
    const panelActionsSource = readFileSync(
      path.resolve(__dirname, "../../../src/app/composables/useAppShellPanelActions.js"),
      "utf8",
    );
    const moreHandler = panelActionsSource.slice(
      panelActionsSource.indexOf("function handleComposerMorePanelVisibleUpdate"),
      panelActionsSource.indexOf("function handleDrawerModelUpdate"),
    );
    expect(moreHandler).not.toContain("closeAllDrawers?.()");
    expect(moreHandler).toContain("closeMobileSidebar?.()");
  });

  it("opens the mobile drawer through a real mounted trigger click", async () => {
    const pushPseudoRoute = vi.fn();
    let visibleState;
    const Harness = defineComponent({
      setup() {
        const mobileChatNavigatorVisible = ref(false);
        visibleState = mobileChatNavigatorVisible;
        const openNavigator = () =>
          openChatMessageNavigator({
            mobileChatNavigatorVisible,
            activeSessionId: ref("session-1"),
            currentMessageAnchorId: ref("message-1"),
            chatNavigatorPanel: "chat-navigator",
            pushPseudoRoute,
          });
        return () =>
          h("div", [
            h(AppShellLayout, {
              isMobile: true,
              chatMessageNavItems: [{ id: "message-1", title: "Message 1" }],
              shouldRenderMessageInChat: () => true,
              authFetch: vi.fn(),
              renderMarkdown: String,
              formatTime: String,
              formatFileSize: String,
              isImageMime: () => false,
              deleteMonotonicMessage: vi.fn(),
              resendMonotonicMessage: vi.fn(),
              translate: (key) => key,
              onMobileChatNavigatorTriggerClick: openNavigator,
            }),
            h(AppShellDrawers, {
              isMobile: true,
              mobileChatNavigatorVisible: mobileChatNavigatorVisible.value,
              chatMessageNavItems: [{ id: "message-1", title: "Message 1" }],
              translate: (key) => key,
            }),
          ]);
      },
    });
    const passthroughStub = defineComponent({
      inheritAttrs: false,
      setup(_, { attrs, slots }) {
        return () => h("div", attrs, slots.default?.());
      },
    });
    const wrapper = mount(Harness, {
      attachTo: document.body,
      global: {
        stubs: {
          Teleport: false,
          "el-button": defineComponent({
            inheritAttrs: false,
            emits: ["click"],
            setup(_, { attrs, emit, slots }) {
              return () =>
                h("button", { ...attrs, onClick: () => emit("click") }, slots.default?.());
            },
          }),
          "el-drawer": defineComponent({
            inheritAttrs: false,
            props: { modelValue: Boolean },
            setup(props, { attrs, slots }) {
              return () =>
                h(
                  "section",
                  {
                    ...attrs,
                    class: ["el-drawer", attrs.class],
                    "data-visible": String(props.modelValue),
                  },
                  slots.default?.(),
                );
            },
          }),
          "el-icon": passthroughStub,
          ChatMainHeader: passthroughStub,
          ChatMessageListPanel: passthroughStub,
          ChatComposer: passthroughStub,
          ChatMessageNavigator: passthroughStub,
          ConversationStateDebugPanel: passthroughStub,
          SessionSidebar: passthroughStub,
          UserInteractionForm: passthroughStub,
        },
      },
    });

    const trigger = document.body.querySelector(".mobile-chat-message-nav-trigger");
    expect(trigger).not.toBeNull();
    trigger.click();
    await nextTick();

    expect(pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-1",
      panel: "chat-navigator",
      anchor: "message-1",
    });
    expect(visibleState.value).toBe(true);
    wrapper.unmount();
  });

  it("connects the mobile trigger to the navigator panel open action", () => {
    expect(appShellSource).toContain(
      "openChatMessageNavigator,\n  handleMobileChatNavigatorClosed,",
    );
    expect(appShellSource).toContain(
      '@mobile-chat-navigator-trigger-click="openChatMessageNavigator"',
    );
  });

  it("builds navigator items from active session messages and delegates selection to the message list", () => {
    expect(chatMessageNavigatorPanelSource).toContain("const chatMessageNavItems = computed(() =>");
    expect(chatMessageNavigatorPanelSource).toContain("buildChatMessageNavItems({");
    expect(chatMessageNavigatorPanelSource).toContain("selectTurnPresentations({");
    expect(chatMessageNavigatorPanelSource).toContain("messages: presentationMessages.value");
    expect(chatMessageNavigatorPanelSource).toContain(
      "getMessageAnchorId: messageListPanelRef?.value?.getMessageAnchorId",
    );
    expect(chatMessageNavItemsStateSource).toContain("export function buildChatMessageNavItems({");
    expect(chatMessageNavItemsStateSource).toContain("shouldRenderMessageInChat");
    expect(chatMessageNavItemsStateSource).toContain(
      "getMessageAnchorId(messageItem, messageIndex)",
    );
    expect(chatMessageNavItemsStateSource).toContain("content.slice(0, 28)");
    expect(chatMessageNavItemsStateSource).toContain(
      'title: `${messageIndex + 1}. ${roleLabel}${content ? `：${content}` : ""}`',
    );
    expect(chatMessageNavigatorComponentSource).toContain(
      'popper-class="chat-message-navigator-popover"',
    );
    expect(chatMessageNavigatorComponentSource).not.toContain(':title="item.title"');
    expect(chatMessageNavigatorPanelSource).toContain(
      "function handleSelectChatMessageNavItem(item = {})",
    );
    expect(chatMessageNavigatorPanelSource).toContain("selectChatMessageNavigatorItem({");
    expect(chatMessageNavigatorStateSource).toContain(
      "function normalizeChatMessageNavigatorAnchor(item = {})",
    );
    expect(chatMessageNavigatorStateSource).toContain('return String(item?.id || "").trim();');
    expect(chatMessageNavigatorStateSource).toContain(
      "messageListPanelRef.value?.scrollToMessageAnchor?.(anchor)",
    );
  });

  it("navigates to the last message through navigator selection instead of direct bottom scroll", () => {
    expect(chatMessageNavigatorPanelSource).toContain("function navigateToLastMessage()");
    expect(chatMessageNavigatorPanelSource).toContain(
      "const lastItem = items[items.length - 1] || null;",
    );
    expect(chatMessageNavigatorPanelSource).toContain("handleSelectChatMessageNavItem(lastItem);");
    expect(chatMessageNavigatorComponentSource).toContain(
      "function syncCurrentNavigatorItemIntoView()",
    );
    expect(chatMessageNavigatorComponentSource).toContain("currentLink?.scrollIntoView?.({");
    expect(chatMessageNavigatorComponentSource).toContain(':data-chat-message-nav-id="item.id"');
    expect(appShellSource).toContain("function navigateToLastMessage()");
    expect(appShellSource).not.toContain("setScrollTop(top)");
    expect(appShellSource).not.toContain("scrollHeight");
    expect(appShellSource).not.toContain("scrollToBottom");
  });

  it("syncs the highlighted navigator item from scroll position", () => {
    expect(chatMessageNavigatorPanelSource).toContain(
      'import { createChatMessageScrollSync } from "../runtime/chatMessageScrollSync.js";',
    );
    expect(chatMessageNavigatorPanelSource).toContain("} = createChatMessageScrollSync({");
    expect(chatMessageNavigatorPanelSource).toContain("currentMessageAnchorId,");
    expect(chatMessageNavigatorPanelSource).toContain("messageListPanelRef,");
    expect(chatMessageScrollSyncSource).toContain("function syncCurrentMessageAnchorId()");
    expect(chatMessageScrollSyncSource).toContain(
      'querySelectorAll?.("[data-chat-message-anchor]")',
    );
    expect(chatMessageScrollSyncSource).toContain(
      "const nextAnchorId = getAnchorId(currentAnchor);",
    );
    expect(chatMessageScrollSyncSource).toContain(
      "if (shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId)) return;",
    );
    expect(chatMessageScrollSyncSource).toContain("currentMessageAnchorId.value = nextAnchorId;");
    expect(chatMessageScrollSyncSource).toContain("function bindChatMessageScrollSync()");
    expect(chatMessageScrollSyncSource).toContain(
      'wrapRef.addEventListener?.("scroll", syncCurrentMessageAnchorId, { passive: true })',
    );
    expect(chatMessageScrollSyncSource).toContain("function unbindChatMessageScrollSync()");
    expect(chatMessageNavigatorPanelSource).toContain("nextTick(bindChatMessageScrollSync)");
    expect(appShellSource).toContain("unbindChatMessageScrollSync();");
  });

  it("uses Element Plus anchor on desktop and drawer on mobile", () => {
    expect(appShellLayoutSource).toContain('class="chat-message-nav-scroll"');
    expect(appShellLayoutSource).toContain("<ChatMessageNavigator");
    expect(appShellSource).toContain(':mobile-chat-navigator-visible="mobileChatNavigatorVisible"');
    expect(appShellSource).toContain(
      '@update:mobile-chat-navigator-visible="mobileChatNavigatorVisible = $event"',
    );
    expect(appShellDrawersSource).toContain('class="chat-message-nav-drawer noobot-side-drawer"');
    expect(chatMessageNavigatorStateSource).toContain("if (isMobile.value) {");
    expect(chatMessageNavigatorStateSource).toContain("mobileChatNavigatorVisible.value = false;");
  });

  it("reserves equal desktop space for any expanded right tool panel", () => {
    expect(appShellLayoutSource).toContain('<main class="main-content">');
    expect(appShellLayoutSource).toContain("<ChatMainHeader");
    expect(appShellLayoutSource).toContain('class="chat-content-body"');
    expect(appShellLayoutSource).toContain('class="chat-composer-body"');
    expect(appShellLayoutSource).toContain("const rightToolPanelOpen = computed(");
    expect(appShellLayoutSource).toContain("'right-tool-panel-docked': !isMobile");
    expect(appShellLayoutSource).toContain("'right-tool-panel-open': rightToolPanelOpen");
    expect(appShellLayoutSource.indexOf("<ChatMainHeader")).toBeLessThan(
      appShellLayoutSource.indexOf('class="chat-content-body"'),
    );
    expect(appShellLayoutSource.indexOf('class="chat-content-body"')).toBeLessThan(
      appShellLayoutSource.indexOf('class="chat-composer-body"'),
    );
    expect(appShellLayoutSource.indexOf('class="chat-composer-body"')).toBeLessThan(
      appShellLayoutSource.indexOf("<ChatComposer"),
    );
    expect(appShellLayoutSource).toContain(".chat-content-body {\n  position: relative;");
    expect(appShellLayoutSource).toContain(
      ".chat-content-body.right-tool-panel-docked,\n  .chat-composer-body.right-tool-panel-docked {\n    padding-right: 96px;",
    );
    expect(appShellLayoutSource).toContain(
      ".chat-composer-body.right-tool-panel-open {\n    padding-right: 268px;",
    );
    expect(appShellLayoutSource).toContain(".chat-composer-body {\n  flex-shrink: 0;");
    expect(appShellLayoutSource).not.toContain(".main-content {\n    padding-right: 268px;");
    expect(appShellLayoutSource).toContain("top: 18px;");
    expect(appShellLayoutSource).toContain(":class=\"{ 'is-collapsed': !chatNavigatorVisible }\"");
    expect(appShellLayoutSource).toContain(".chat-message-nav-panel.is-collapsed {");
    expect(appShellLayoutSource).toContain("width: var(--noobot-side-panel-collapsed-width);");
    expect(appShellLayoutSource).toContain(".chat-message-nav-scroll {");
    expect(appShellLayoutSource).toContain(
      ".chat-message-nav-scroll :deep(.chat-message-navigator)",
    );
    expect(appShellLayoutSource).toContain("max-height: none;");
    expect(appShellLayoutSource).toContain("overflow: visible;");
    expect(appShellLayoutSource).toContain("function toggleChatNavigator()");
    expect(appShellLayoutSource).toContain("if (nextVisible) featurePanelVisible.value = false;");
    expect(appShellLayoutSource).toContain("overflow: hidden;");
    expect(appShellLayoutSource).toContain(".right-tool-panels > * {\n  flex: 0 0 auto;");
    expect(appShellLayoutSource).toContain(".right-tool-panels > *.is-collapsed {");
    expect(appShellLayoutSource).toContain("overflow-y: auto;");
    expect(chatMessageListPanelSource).not.toContain("has-right-tool-panel");
    expect(chatMessageListPanelSource).not.toContain("rightToolPanelOpen");
  });

  it("keeps the navigator polished and the mobile trigger reachable", () => {
    expect(appShellLayoutSource).toContain("chat-message-nav-title-group");
    expect(appShellLayoutSource).toContain("{{ chatMessageNavItems.length }}");
    expect(appShellLayoutSource).toContain("position: fixed;");
    expect(appShellLayoutSource).toContain("top: calc(56px + 16px + env(safe-area-inset-top));");
    expect(appShellLayoutSource).toContain("right: calc(16px + env(safe-area-inset-right));");
    expect(appShellLayoutSource).not.toContain(':style="mobileChatNavigatorTriggerStyle"');
    expect(appShellLayoutSource).not.toContain("@pointerdown=");
    expect(appShellLayoutSource).not.toContain("@pointermove=");
    expect(appShellLayoutSource).toContain(":aria-label=\"translate('common.chatNavigator')\"");
  });

  it("hosts right-tool extensions in a dedicated mobile trigger and drawer", () => {
    expect(appShellLayoutSource).toContain(
      'class="mobile-feature-trigger noobot-floating-action-btn"',
    );
    expect(appShellLayoutSource).toContain('data-testid="mobile-feature-panel-trigger"');
    expect(appShellLayoutSource).toContain('data-testid="mobile-feature-panel"');
    expect(appShellLayoutSource).toContain('class="mobile-feature-drawer noobot-side-drawer"');
    expect(appShellLayoutSource).toContain(':title="featurePanelTitle"');
    expect(appShellLayoutSource).toContain(':point="EXTENSION_POINTS.RIGHT_TOOL_PANEL"');
    expect(appShellLayoutSource).toContain("top: calc(56px + 120px + env(safe-area-inset-top));");
  });

  it("uses Element Plus icons, theme variables, and pseudo route for the mobile navigator", () => {
    expect(appShellLayoutSource).toContain(
      'import { Connection, Grid, Tickets } from "@element-plus/icons-vue"',
    );
    expect(appShellLayoutSource).toContain("<el-icon><Tickets /></el-icon>");
    expect(appShellLayoutSource).toContain(
      '<el-icon class="mobile-chat-message-nav-trigger-icon"><Tickets /></el-icon>',
    );
    expect(chatMessageNavigatorPanelSource).toContain(
      '} from "../state/chatMessageNavigatorState.js";',
    );
    expect(chatMessageNavigatorPanelSource).toContain("function openChatMessageNavigator()");
    expect(chatMessageNavigatorPanelSource).toContain("openChatMessageNavigatorState({");
    expect(appShellSource).toContain("chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR");
    expect(chatMessageNavigatorPanelSource).toContain("function handleMobileChatNavigatorClosed()");
    expect(chatMessageNavigatorPanelSource).toContain("closeChatMessageNavigator({");
    expect(appShellDrawersSource).toContain('@closed="handleMobileNavigatorClose"');
    expect(appShellDrawersSource).toContain('emit("mobile-chat-navigator-closed")');
    expect(appShellSource).toContain(
      '@mobile-chat-navigator-closed="handleMobileChatNavigatorClosed"',
    );
    expect(chatMessageNavigatorStateSource).toContain(
      "replacePseudoRoute(buildChatMessageNavigatorCloseRoute({",
    );
    expect(appShellLayoutSource).toContain(
      'class="mobile-chat-message-nav-trigger noobot-floating-action-btn"',
    );
    expect(appShellLayoutSource).toContain('class="connector-overview-panel noobot-panel-card"');
    expect(appShellLayoutSource).toContain(":class=\"{ 'is-collapsed': !connectorVisible }\"");
    expect(appShellLayoutSource).toContain("<ConnectorManager");
    expect(appShellLayoutSource).toContain(':fetcher="authFetch"');
    expect(appShellLayoutSource).toContain(":drawer-size=\"isMobile ? '100%' : '72%'\"");
    expect(connectorManagerSource).toContain(':size="drawerSize"');
    expect(connectorManagerSource).toContain(
      'class="connector-add-drawer workspace-drawer noobot-side-drawer"',
    );
    expect(connectorManagerSource).not.toContain('size="min(520px, 92vw)"');
    expect(appShellLayoutSource).toMatch(
      /class="chat-message-nav-toggle"[\s\S]*?translate\("common\.hideChatNavigator"\)/,
    );
    expect(appShellLayoutSource).toMatch(
      /class="connector-overview-header"[\s\S]*?translate\("connectors\.collapse"\)/,
    );
    expect(appShellLayoutSource).toContain(
      'class="mobile-connector-trigger noobot-floating-action-btn"',
    );
  });

  it("fixes the mobile navigator trigger below the header at the inset right without drag handlers", () => {
    expect(appShellLayoutSource).toContain(
      "@click=\"emit('mobile-chat-navigator-trigger-click')\"",
    );
    expect(appShellLayoutSource).toContain("position: fixed;");
    expect(appShellLayoutSource).toContain("top: calc(56px + 16px + env(safe-area-inset-top));");
    expect(appShellLayoutSource).toContain("right: calc(16px + env(safe-area-inset-right));");
    expect(appShellLayoutSource).toContain('<Teleport to="body">');
    expect(appShellLayoutSource).toContain("z-index: 2001;");
    expect(appShellLayoutSource).toContain("pointer-events: auto;");
    expect(appShellLayoutSource.indexOf('class=\"chat-content-body\"')).toBeLessThan(
      appShellLayoutSource.indexOf(
        'class=\"mobile-chat-message-nav-trigger noobot-floating-action-btn\"',
      ),
    );
    expect(
      appShellLayoutSource.indexOf(
        'class=\"mobile-chat-message-nav-trigger noobot-floating-action-btn\"',
      ),
    ).toBeLessThan(appShellLayoutSource.indexOf('class=\"chat-composer-body\"'));
    expect(appShellLayoutSource).not.toContain("@pointercancel=");
    expect(appShellLayoutSource).not.toContain("@touchstart.stop.prevent");
    expect(appShellLayoutSource).not.toContain("is-dragging");
    expect(appShellSource).not.toContain("mobile-chat-navigator-trigger-pointer");
  });

  it("anchors the session artifact panel to the right without runtime offsets", () => {
    const artifactPanelSource = readFileSync(
      path.resolve(
        __dirname,
        "../../../src/modules/chat/components/artifacts/SessionArtifactPanel.vue",
      ),
      "utf8",
    );
    expect(artifactPanelSource).toContain("right: var(--noobot-space-xl);");
    expect(artifactPanelSource).toContain("--noobot-mobile-artifact-top:");
    expect(artifactPanelSource).toContain("top: var(--noobot-mobile-artifact-top);");
    expect(artifactPanelSource).not.toContain("top: 124px;");
    expect(artifactPanelSource).not.toContain("rightOffset");
    expect(artifactPanelSource).not.toContain(':style="{ right:');
  });
});
