import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShell.vue"),
  "utf8",
);
const mobileChatNavigatorTriggerPositionSource = readFileSync(
  resolve(__dirname, "../../../src/app/mobileChatNavigatorTriggerPosition.js"),
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
    expect(appShellSource).toContain("const chatMessageNavItems = computed(() =>");
    expect(appShellSource).toContain("buildChatMessageNavItems({");
    expect(appShellSource).toContain("messages: activeSession.value?.messages || []");
    expect(appShellSource).toContain("getMessageAnchorId: messageListPanelRef.value?.getMessageAnchorId");
    expect(chatMessageNavItemsStateSource).toContain("export function buildChatMessageNavItems({");
    expect(chatMessageNavItemsStateSource).toContain("shouldRenderMessageInChat");
    expect(chatMessageNavItemsStateSource).toContain("getMessageAnchorId(messageItem, messageIndex)");
    expect(chatMessageNavItemsStateSource).toContain("content.slice(0, 28)");
    expect(appShellSource).toContain("function handleSelectChatMessageNavItem(item = {})");
    expect(appShellSource).toContain("selectChatMessageNavigatorItem({");
    expect(chatMessageNavigatorStateSource).toContain("function normalizeChatMessageNavigatorAnchor(item = {})");
    expect(chatMessageNavigatorStateSource).toContain("return String(item?.id || \"\").trim();");
    expect(chatMessageNavigatorStateSource).toContain("messageListPanelRef.value?.scrollToMessageAnchor?.(anchor)");
  });

  it("syncs the highlighted navigator item from scroll position", () => {
    expect(appShellSource).toContain('import { createChatMessageScrollSync } from "./chatMessageScrollSync";');
    expect(appShellSource).toContain("} = createChatMessageScrollSync({");
    expect(appShellSource).toContain("currentMessageAnchorId,");
    expect(appShellSource).toContain("messageListPanelRef,");
    expect(chatMessageScrollSyncSource).toContain("function syncCurrentMessageAnchorId()");
    expect(chatMessageScrollSyncSource).toContain('querySelectorAll?.("[data-chat-message-anchor]")');
    expect(chatMessageScrollSyncSource).toContain("const nextAnchorId = getAnchorId(currentAnchor);");
    expect(chatMessageScrollSyncSource).toContain("if (shouldKeepNavigatorScrollLock(wrapRef, nextAnchorId)) return;");
    expect(chatMessageScrollSyncSource).toContain("currentMessageAnchorId.value = nextAnchorId;");
    expect(chatMessageScrollSyncSource).toContain("function bindChatMessageScrollSync()");
    expect(chatMessageScrollSyncSource).toContain('wrapRef.addEventListener?.("scroll", syncCurrentMessageAnchorId, { passive: true })');
    expect(chatMessageScrollSyncSource).toContain("function unbindChatMessageScrollSync()");
    expect(appShellSource).toContain("nextTick(bindChatMessageScrollSync)");
    expect(appShellSource).toContain("unbindChatMessageScrollSync();");
  });

  it("uses Element Plus anchor on desktop and drawer on mobile", () => {
    expect(appShellSource).toContain("<el-affix :offset=\"80\">");
    expect(appShellSource).toContain("<ChatMessageNavigator");
    expect(appShellSource).toContain("v-model=\"mobileChatNavigatorVisible\"");
    expect(appShellSource).toContain("class=\"chat-message-nav-drawer noobot-side-drawer\"");
    expect(appShellSource).toContain("if (isMobile.value) {");
    expect(appShellSource).toContain("mobileChatNavigatorVisible.value = false;");
  });

  it("reserves desktop navigator space only inside the chat content body", () => {
    expect(appShellSource).toContain('<main class="main-content">');
    expect(appShellSource).toContain("<ChatMainHeader");
    expect(appShellSource).toContain('<div class="chat-content-body">');
    expect(appShellSource).toContain('<div class="chat-composer-body">');
    expect(appShellSource.indexOf("<ChatMainHeader")).toBeLessThan(appShellSource.indexOf('<div class="chat-content-body">'));
    expect(appShellSource.indexOf('<div class="chat-content-body">')).toBeLessThan(appShellSource.indexOf('<div class="chat-composer-body">'));
    expect(appShellSource.indexOf('<div class="chat-composer-body">')).toBeLessThan(appShellSource.indexOf('<ChatComposer'));
    expect(appShellSource).toContain(".chat-content-body {\n  position: relative;");
    expect(appShellSource).toContain(".chat-content-body,\n  .chat-composer-body {\n    padding-right: 268px;");
    expect(appShellSource).toContain(".chat-composer-body {\n  flex-shrink: 0;");
    expect(appShellSource).not.toContain(".main-content {\n    padding-right: 268px;");
    expect(appShellSource).toContain("top: 18px;");
  });

  it("keeps the navigator polished and the mobile trigger reachable", () => {
    expect(appShellSource).toContain("chat-message-nav-title-group");
    expect(appShellSource).toContain("{{ chatMessageNavItems.length }}");
    expect(appShellSource).toContain("position: fixed;");
    expect(mobileChatNavigatorTriggerPositionSource).toContain(
      "DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION = { right: 16, bottom: 112 }",
    );
    expect(appShellSource).toContain(":style=\"mobileChatNavigatorTriggerStyle\"");
    expect(appShellSource).toContain("@pointerdown=\"handleMobileChatNavigatorTriggerPointerDown\"");
    expect(appShellSource).toContain("@pointermove=\"handleMobileChatNavigatorTriggerPointerMove\"");
    expect(appShellSource).toContain("touch-action: none;");
    expect(appShellSource).toContain("overscroll-behavior: none;");
    expect(appShellSource).toContain(":aria-label=\"translate('common.chatNavigator')\"");
  });

  it("uses Element Plus icons, theme variables, and pseudo route for the mobile navigator", () => {
    expect(appShellSource).toContain('import { Tickets } from "@element-plus/icons-vue"');
    expect(appShellSource).toContain("<el-icon><Tickets /></el-icon>");
    expect(appShellSource).toContain("<el-icon class=\"mobile-chat-message-nav-trigger-icon\"><Tickets /></el-icon>");
    expect(appShellSource).toContain("} from \"./state/chatMessageNavigatorState\";");
    expect(appShellSource).toContain("function openChatMessageNavigator()");
    expect(appShellSource).toContain("openChatMessageNavigatorState({");
    expect(appShellSource).toContain("chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR");
    expect(appShellSource).toContain("function handleMobileChatNavigatorClosed()");
    expect(appShellSource).toContain("closeChatMessageNavigator({");
    expect(appShellSource).toContain("@closed=\"handleMobileChatNavigatorClosed\"");
    expect(chatMessageNavigatorStateSource).toContain("replacePseudoRoute(buildChatMessageNavigatorCloseRoute({");
    expect(appShellSource).toContain("background: var(--noobot-panel-bg);");
    expect(appShellSource).toContain("border: 1px solid var(--noobot-border-soft);");
  });

  it("lets users drag and persist the mobile navigator trigger position", () => {
    expect(appShellSource).toContain("} from \"./mobileChatNavigatorTriggerPosition\";");
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
    expect(appShellSource).toContain("function handleMobileChatNavigatorTriggerPointerDown(event)");
    expect(appShellSource).toContain("function handleMobileChatNavigatorTriggerPointerMove(event)");
    expect(appShellSource).toContain("function handleMobileChatNavigatorTriggerPointerUp(event)");
    expect(appShellSource).toContain("function preventMobileChatNavigatorTriggerGesture(event)");
    expect(appShellSource).toContain("if (event?.cancelable) event.preventDefault?.();");
    expect(appShellSource).toContain("function preventMobileChatNavigatorDocumentTouch(event)");
    expect(appShellSource).toContain("function setMobileChatNavigatorDragLock(locked)");
    expect(appShellSource).toContain("window?.addEventListener?.(\"touchmove\", preventMobileChatNavigatorDocumentTouch, { passive: false })");
    expect(appShellSource).toContain("setMobileChatNavigatorDragLock(true)");
    expect(appShellSource).toContain("setMobileChatNavigatorDragLock(false)");
    expect(appShellSource).toContain("function handleMobileChatNavigatorTriggerClick()");
    expect(appShellSource).toContain("@click=\"handleMobileChatNavigatorTriggerClick\"");
    expect(appShellSource).toContain("@pointercancel=\"handleMobileChatNavigatorTriggerPointerUp\"");
    expect(appShellSource).toContain("openChatMessageNavigator();\n}");
    expect(appShellSource).toContain("@touchstart.stop.prevent");
    expect(appShellSource).toContain("@touchmove.stop.prevent");
    expect(appShellSource).toContain("@touchend.stop.prevent");
    expect(appShellSource).toContain("@touchcancel.stop.prevent");
    expect(appShellSource).toContain(".mobile-chat-message-nav-trigger.is-dragging");
    expect(appShellSource).toContain(":global(html.noobot-mobile-chat-navigator-dragging)");
    expect(appShellSource).toContain("overscroll-behavior-y: none;");
    expect(appShellSource).toContain("overflow: hidden;");
    expect(appShellSource).toContain(".app-shell-root,\n.chat-content-body,\n.chat-composer-body {\n  overscroll-behavior: none;");
    expect(appShellSource).toContain(".main-content {\n  flex: 1;");
    expect(appShellSource).toContain("min-height: 0;\n  overscroll-behavior: none;");
    expect(appShellSource).toContain(":global(body.noobot-mobile-chat-navigator-dragging) .main-content");
    expect(appShellSource).toContain(":global(body.noobot-mobile-chat-navigator-dragging) .chat-content-body");
  });

});
