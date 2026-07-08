import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShell.vue"),
  "utf8",
);
const appShellLayoutSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShellLayout.vue"),
  "utf8",
);
const appShellDrawersSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShellDrawers.vue"),
  "utf8",
);
const chatMessageNavigatorPanelSource = readFileSync(
  resolve(__dirname, "../../../src/app/useChatMessageNavigatorPanel.js"),
  "utf8",
);
const mobileChatNavigatorTriggerPositionSource = readFileSync(
  resolve(__dirname, "../../../src/app/mobileChatNavigatorTriggerPosition.js"),
  "utf8",
);
const mobileChatNavigatorTriggerSource = readFileSync(
  resolve(__dirname, "../../../src/app/useMobileChatNavigatorTrigger.js"),
  "utf8",
);
const chatMessageScrollSyncSource = readFileSync(
  resolve(__dirname, "../../../src/app/chatMessageScrollSync.js"),
  "utf8",
);
const chatMessageNavigatorStateSource = readFileSync(
  resolve(__dirname, "../../../src/app/state/chatMessageNavigatorState.js"),
  "utf8",
);
const chatMessageNavItemsStateSource = readFileSync(
  resolve(__dirname, "../../../src/app/state/chatMessageNavItemsState.js"),
  "utf8",
);

describe("AppShell chat message navigator", () => {
  it("builds navigator items from active session messages and delegates selection to the message list", () => {
    expect(chatMessageNavigatorPanelSource).toContain("const chatMessageNavItems = computed(() =>");
    expect(chatMessageNavigatorPanelSource).toContain("buildChatMessageNavItems({");
    expect(chatMessageNavigatorPanelSource).toContain("messages: activeSession?.value?.messages || []");
    expect(chatMessageNavigatorPanelSource).toContain("getMessageAnchorId: messageListPanelRef?.value?.getMessageAnchorId");
    expect(chatMessageNavItemsStateSource).toContain("export function buildChatMessageNavItems({");
    expect(chatMessageNavItemsStateSource).toContain("shouldRenderMessageInChat");
    expect(chatMessageNavItemsStateSource).toContain("getMessageAnchorId(messageItem, messageIndex)");
    expect(chatMessageNavItemsStateSource).toContain("content.slice(0, 28)");
    expect(chatMessageNavigatorPanelSource).toContain("function handleSelectChatMessageNavItem(item = {})");
    expect(chatMessageNavigatorPanelSource).toContain("selectChatMessageNavigatorItem({");
    expect(chatMessageNavigatorStateSource).toContain("function normalizeChatMessageNavigatorAnchor(item = {})");
    expect(chatMessageNavigatorStateSource).toContain("return String(item?.id || \"\").trim();");
    expect(chatMessageNavigatorStateSource).toContain("messageListPanelRef.value?.scrollToMessageAnchor?.(anchor)");
  });

  it("syncs the highlighted navigator item from scroll position", () => {
    expect(chatMessageNavigatorPanelSource).toContain('import { createChatMessageScrollSync } from "./chatMessageScrollSync";');
    expect(chatMessageNavigatorPanelSource).toContain("} = createChatMessageScrollSync({");
    expect(chatMessageNavigatorPanelSource).toContain("currentMessageAnchorId,");
    expect(chatMessageNavigatorPanelSource).toContain("messageListPanelRef,");
    expect(chatMessageScrollSyncSource).toContain("function syncCurrentMessageAnchorId()");
    expect(chatMessageScrollSyncSource).toContain('querySelectorAll?.("[data-chat-message-anchor]")');
    expect(chatMessageScrollSyncSource).toContain("const nextAnchorId = getAnchorId(currentAnchor);");
    expect(chatMessageScrollSyncSource).toContain("if (shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId)) return;");
    expect(chatMessageScrollSyncSource).toContain("currentMessageAnchorId.value = nextAnchorId;");
    expect(chatMessageScrollSyncSource).toContain("function bindChatMessageScrollSync()");
    expect(chatMessageScrollSyncSource).toContain('wrapRef.addEventListener?.("scroll", syncCurrentMessageAnchorId, { passive: true })');
    expect(chatMessageScrollSyncSource).toContain("function unbindChatMessageScrollSync()");
    expect(chatMessageNavigatorPanelSource).toContain("nextTick(bindChatMessageScrollSync)");
    expect(appShellSource).toContain("unbindChatMessageScrollSync();");
  });

  it("uses Element Plus anchor on desktop and drawer on mobile", () => {
    expect(appShellLayoutSource).toContain("<el-affix :offset=\"80\">");
    expect(appShellLayoutSource).toContain("<ChatMessageNavigator");
    expect(appShellSource).toContain(":mobile-chat-navigator-visible=\"mobileChatNavigatorVisible\"");
    expect(appShellSource).toContain("@update:mobile-chat-navigator-visible=\"mobileChatNavigatorVisible = $event\"");
    expect(appShellDrawersSource).toContain("class=\"chat-message-nav-drawer noobot-side-drawer\"");
    expect(chatMessageNavigatorStateSource).toContain("if (isMobile.value) {");
    expect(chatMessageNavigatorStateSource).toContain("mobileChatNavigatorVisible.value = false;");
  });

  it("reserves desktop navigator space only inside the chat content body", () => {
    expect(appShellLayoutSource).toContain('<main class="main-content">');
    expect(appShellLayoutSource).toContain("<ChatMainHeader");
    expect(appShellLayoutSource).toContain('<div class="chat-content-body">');
    expect(appShellLayoutSource).toContain('<div class="chat-composer-body">');
    expect(appShellLayoutSource.indexOf("<ChatMainHeader")).toBeLessThan(appShellLayoutSource.indexOf('<div class="chat-content-body">'));
    expect(appShellLayoutSource.indexOf('<div class="chat-content-body">')).toBeLessThan(appShellLayoutSource.indexOf('<div class="chat-composer-body">'));
    expect(appShellLayoutSource.indexOf('<div class="chat-composer-body">')).toBeLessThan(appShellLayoutSource.indexOf('<ChatComposer'));
    expect(appShellLayoutSource).toContain(".chat-content-body {\n  position: relative;");
    expect(appShellLayoutSource).toContain(".chat-content-body,\n  .chat-composer-body {\n    padding-right: 268px;");
    expect(appShellLayoutSource).toContain(".chat-composer-body {\n  flex-shrink: 0;");
    expect(appShellLayoutSource).not.toContain(".main-content {\n    padding-right: 268px;");
    expect(appShellLayoutSource).toContain("top: 18px;");
  });

  it("keeps the navigator polished and the mobile trigger reachable", () => {
    expect(appShellLayoutSource).toContain("chat-message-nav-title-group");
    expect(appShellLayoutSource).toContain("{{ chatMessageNavItems.length }}");
    expect(appShellLayoutSource).toContain("position: fixed;");
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION = { right: 16, bottom: 112 }",
    );
    expect(appShellLayoutSource).toContain(":style=\"mobileChatNavigatorTriggerStyle\"");
    expect(appShellLayoutSource).toContain("@pointerdown=\"emit('mobile-chat-navigator-trigger-pointer-down', $event)\"");
    expect(appShellLayoutSource).toContain("@pointermove=\"emit('mobile-chat-navigator-trigger-pointer-move', $event)\"");
    expect(appShellLayoutSource).toContain("touch-action: none;");
    expect(appShellLayoutSource).toContain("overscroll-behavior: none;");
    expect(appShellLayoutSource).toContain(":aria-label=\"translate('common.chatNavigator')\"");
  });

  it("uses Element Plus icons, theme variables, and pseudo route for the mobile navigator", () => {
    expect(appShellLayoutSource).toContain('import { Tickets } from "@element-plus/icons-vue"');
    expect(appShellLayoutSource).toContain("<el-icon><Tickets /></el-icon>");
    expect(appShellLayoutSource).toContain("<el-icon class=\"mobile-chat-message-nav-trigger-icon\"><Tickets /></el-icon>");
    expect(chatMessageNavigatorPanelSource).toContain("} from \"./state/chatMessageNavigatorState\";");
    expect(chatMessageNavigatorPanelSource).toContain("function openChatMessageNavigator()");
    expect(chatMessageNavigatorPanelSource).toContain("openChatMessageNavigatorState({");
    expect(appShellSource).toContain("chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR");
    expect(chatMessageNavigatorPanelSource).toContain("function handleMobileChatNavigatorClosed()");
    expect(chatMessageNavigatorPanelSource).toContain("closeChatMessageNavigator({");
    expect(appShellDrawersSource).toContain("@closed=\"emit('mobile-chat-navigator-closed')\"");
    expect(appShellSource).toContain("@mobile-chat-navigator-closed=\"handleMobileChatNavigatorClosed\"");
    expect(chatMessageNavigatorStateSource).toContain("replacePseudoRoute(buildChatMessageNavigatorCloseRoute({");
    expect(appShellLayoutSource).toContain("class=\"mobile-chat-message-nav-trigger noobot-floating-action-btn\"");
  });

  it("lets users drag and persist the mobile navigator trigger position", () => {
    expect(mobileChatNavigatorTriggerSource).toContain("} from \"./mobileChatNavigatorTriggerPosition\";");
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "function loadMobileChatNavigatorTriggerPosition()",
    );
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "noobot_mobile_chat_navigator_trigger_position",
    );
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "function clampMobileChatNavigatorTriggerPosition(left, top)",
    );
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "function persistMobileChatNavigatorTriggerPosition(position = {})",
    );
    expect(mobileChatNavigatorTriggerSource).toContain("function handleMobileChatNavigatorTriggerPointerDown(event)");
    expect(mobileChatNavigatorTriggerSource).toContain("function handleMobileChatNavigatorTriggerPointerMove(event)");
    expect(mobileChatNavigatorTriggerSource).toContain("function handleMobileChatNavigatorTriggerPointerUp(event)");
    expect(mobileChatNavigatorTriggerSource).toContain("function preventMobileChatNavigatorTriggerGesture(event)");
    expect(mobileChatNavigatorTriggerSource).toContain("if (event?.cancelable) event.preventDefault?.();");
    expect(mobileChatNavigatorTriggerSource).toContain("function preventMobileChatNavigatorDocumentTouch(event)");
    expect(mobileChatNavigatorTriggerSource).toContain("function setMobileChatNavigatorDragLock(locked)");
    expect(mobileChatNavigatorTriggerSource).toContain("window?.addEventListener?.(\"touchmove\", preventMobileChatNavigatorDocumentTouch, { passive: false })");
    expect(mobileChatNavigatorTriggerSource).toContain("setMobileChatNavigatorDragLock(true)");
    expect(mobileChatNavigatorTriggerSource).toContain("setMobileChatNavigatorDragLock(false)");
    expect(mobileChatNavigatorTriggerSource).toContain("function handleMobileChatNavigatorTriggerClick()");
    expect(appShellLayoutSource).toContain("@click=\"emit('mobile-chat-navigator-trigger-click')\"");
    expect(appShellLayoutSource).toContain("@pointercancel=\"emit('mobile-chat-navigator-trigger-pointer-cancel', $event)\"");
    expect(mobileChatNavigatorTriggerSource).toContain("openChatMessageNavigator?.();\n  }");
    expect(appShellLayoutSource).toContain("@touchstart.stop.prevent");
    expect(appShellLayoutSource).toContain("@touchmove.stop.prevent");
    expect(appShellLayoutSource).toContain("@touchend.stop.prevent");
    expect(appShellLayoutSource).toContain("@touchcancel.stop.prevent");
    expect(appShellLayoutSource).toContain(".mobile-chat-message-nav-trigger.is-dragging");
    expect(appShellLayoutSource).toContain(":global(html.noobot-mobile-chat-navigator-dragging)");
    expect(appShellLayoutSource).toContain("overscroll-behavior-y: none;");
    expect(appShellLayoutSource).toContain("overflow: hidden;");
    expect(appShellLayoutSource).toContain(".chat-content-body,\n.chat-composer-body {\n  overscroll-behavior: none;");
    expect(appShellLayoutSource).toContain(".main-content {\n  flex: 1;");
    expect(appShellLayoutSource).toContain("min-height: 0;\n  overscroll-behavior: none;");
    expect(appShellLayoutSource).toContain(":global(body.noobot-mobile-chat-navigator-dragging) .main-content");
    expect(appShellLayoutSource).toContain(":global(body.noobot-mobile-chat-navigator-dragging) .chat-content-body");
  });

});
