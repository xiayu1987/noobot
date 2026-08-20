<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref } from "vue";
import { Tickets } from "@element-plus/icons-vue";
import ChatMainHeader from "./ChatMainHeader.vue";
import ChatMessageNavigator from "../../modules/chat/components/navigation/ChatMessageNavigator.vue";
import ConnectorManager from "../../modules/connectors/components/ConnectorManager.vue";
import { sharedSidebarProps } from "../../modules/session/model/sidebarProps.js";
import { sharedComposerOptionProps } from "../../modules/composer/model/composerOptionProps.js";
import {
  ChatComposer,
  ChatMessageListPanel,
  ConversationStateDebugPanel,
  SessionSidebar,
  UserInteractionForm,
} from "../entrypoints.js";

defineProps({
  ...sharedSidebarProps,
  composerActionState: { type: Object, default: () => ({}) },
  activeSession: { type: Object, default: () => ({}) },
  title: { type: String, default: "" },
  isSuperAdmin: { type: Boolean, default: false },
  canUseIDE: { type: Boolean, default: false },
  loadingSessionDetail: { type: Boolean, default: false },
  shouldRenderMessageInChat: { type: Function, required: true },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  emptyLogoSrc: { type: String, default: "" },
  deleteMonotonicMessage: { type: Function, required: true },
  resendMonotonicMessage: { type: Function, required: true },
  stopExecution: { type: Function, default: null },
  chatMessageNavItems: { type: Array, default: () => [] },
  chatNavigatorVisible: { type: Boolean, default: true },
  currentMessageAnchorId: { type: String, default: "" },
  input: { type: String, default: "" },
  composerMorePanelVisible: { type: Boolean, default: false },
  uploadFiles: { type: Array, default: () => [] },
  canStop: { type: Boolean, default: false },
  ...sharedComposerOptionProps,
  allowUserInteraction: { type: Boolean, default: false },
  availableModelOptions: { type: Array, default: () => [] },
  availableBotScenarios: { type: Array, default: () => [] },
  availablePlugins: { type: Array, default: () => [] },
  selectedPlugins: { type: Array, default: () => [] },
  pendingInteractionRequest: { type: Object, default: null },
  interactionSubmitting: { type: Boolean, default: false },
  showConversationStateDebugPanel: { type: Boolean, default: false },
  conversationStateSnapshot: { type: Object, default: () => ({}) },
  conversationStateTimeline: { type: Array, default: () => [] },
  translate: { type: Function, required: true },
  authFetch: { type: Function, required: true },
});

const emit = defineEmits([
  "append-uploads",
  "clear-uploads",
  "remove-upload",
  "connect",
  "connector-selected",
  "connector-registry-changed",
  "delete-session",
  "rename-session",
  "mobile-chat-navigator-trigger-click",
  "new-session",
  "open-config-params",
  "open-openvscode",
  "open-thinking-details",
  "open-user-settings",
  "open-workspace",
  "close-mobile-sidebar",
  "refresh-sessions",
  "select-chat-message-nav-item",
  "select-session",
  "stop",
  "toggle-chat-navigator-visible",
  "toggle-sidebar",
  "update:allowUserInteraction",
  "update:botScenario",
  "update:connect-code",
  "update:safeConfirm",
  "update:safeConfirmLevel",
  "update:sanitizeOutput",
  "update:input",
  "update:morePanelVisible",
  "update:pluginModelConfig",
  "update:frontendThresholdsEnabled",
  "update:summaryPolicy",
  "update:selectedModel",
  "update:memoryModel",
  "update:selectedPlugins",
  "update:streamOutput",
  "update:user-id",
  "interaction-confirm",
  "interaction-cancel",
  "send",
]);

const composerRef = ref();
const messageListPanelRef = ref();

defineExpose({
  composerRef,
  messageListPanelRef,
});
</script>

<template>
  <div
    class="chat-page"
    :class="{
      'sidebar-collapsed': sidebarCollapsed,
      'mobile-sidebar-open': mobileSidebarOpen,
    }"
  >
    <div
      v-if="mobileSidebarOpen && isMobile"
      class="mobile-mask"
      @click="emit('close-mobile-sidebar')"
    ></div>
    <SessionSidebar
      :sidebar-collapsed="sidebarCollapsed"
      :is-mobile="isMobile"
      :mobile-sidebar-open="mobileSidebarOpen"
      :user-id="userId"
      :connect-code="connectCode"
      :connecting="connecting"
      :connected="connected"
      :sending="sending"
      :loading-sessions="loadingSessions"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :turn-runtime-registry="turnRuntimeRegistry"
      @toggle-sidebar="emit('toggle-sidebar')"
      @update:user-id="emit('update:user-id', $event)"
      @update:connect-code="emit('update:connect-code', $event)"
      @connect="emit('connect')"
      @new-session="emit('new-session')"
      @delete-session="emit('delete-session', $event)"
      @rename-session="emit('rename-session', $event)"
      @refresh-sessions="emit('refresh-sessions')"
      @select-session="emit('select-session', $event)"
    />

    <main class="main-content">
      <ChatMainHeader
        :title="title"
        :user-id="userId"
        :is-super-admin="isSuperAdmin"
        :can-use-ide="canUseIDE"
        @toggle-sidebar="emit('toggle-sidebar')"
        @open-openvscode="emit('open-openvscode')"
        @open-workspace="emit('open-workspace')"
        @open-user-settings="emit('open-user-settings')"
        @open-config-params="emit('open-config-params')"
      />

      <div
        class="chat-content-body"
        :class="{ 'chat-navigator-open': chatNavigatorVisible && !isMobile }"
      >
        <ChatMessageListPanel
          ref="messageListPanelRef"
          :loading-session-detail="loadingSessionDetail"
          :active-session="activeSession || {}"
          :should-render-message-in-chat="shouldRenderMessageInChat"
          :user-id="userId"
          :render-markdown="renderMarkdown"
          :format-time="formatTime"
          :format-file-size="formatFileSize"
          :is-image-mime="isImageMime"
          :empty-logo-src="emptyLogoSrc"
          :sending="sending"
          :delete-monotonic-message="deleteMonotonicMessage"
          :resend-monotonic-message="resendMonotonicMessage"
          :stop-execution="stopExecution"
          @open-thinking-details="emit('open-thinking-details', $event)"
        />

        <aside
          v-if="!isMobile"
          class="chat-message-nav-panel noobot-panel-card"
          :class="{ 'is-collapsed': !chatNavigatorVisible }"
        >
          <div class="chat-message-nav-header">
            <button
              type="button"
              class="chat-message-nav-icon chat-message-nav-icon-button"
              :aria-label="
                chatNavigatorVisible
                  ? translate('common.hideChatNavigator')
                  : translate('common.showChatNavigator')
              "
              @click="emit('toggle-chat-navigator-visible')"
            >
              <el-icon><Tickets /></el-icon>
            </button>
            <div v-show="chatNavigatorVisible" class="chat-message-nav-title-group">
              <div>
                <span class="chat-message-nav-title">{{ translate("common.chatNavigator") }}</span>
                <span class="chat-message-nav-count">{{ chatMessageNavItems.length }}</span>
              </div>
            </div>
            <el-button
              text
              size="small"
              class="chat-message-nav-toggle"
              v-show="chatNavigatorVisible"
              @click="emit('toggle-chat-navigator-visible')"
            >
              {{ translate("common.hideChatNavigator") }}
            </el-button>
          </div>
          <el-affix :offset="80">
            <ChatMessageNavigator
              v-show="chatNavigatorVisible"
              :items="chatMessageNavItems"
              :current-id="currentMessageAnchorId"
              :is-mobile="isMobile"
              @select="emit('select-chat-message-nav-item', $event)"
            />
          </el-affix>
          <ConnectorManager
            v-show="chatNavigatorVisible"
            compact
            :user-id="userId"
            :connected="connected"
            :fetcher="authFetch"
            @changed="emit('connector-registry-changed')"
          />
        </aside>
      </div>

      <Teleport to="body">
        <el-button
          v-if="isMobile"
          class="mobile-chat-message-nav-trigger noobot-floating-action-btn"
          type="primary"
          circle
          size="large"
          :aria-label="translate('common.chatNavigator')"
          @click="emit('mobile-chat-navigator-trigger-click')"
        >
          <el-icon class="mobile-chat-message-nav-trigger-icon"><Tickets /></el-icon>
        </el-button>
      </Teleport>

      <div
        class="chat-composer-body"
        :class="{ 'chat-navigator-open': chatNavigatorVisible && !isMobile }"
      >
        <UserInteractionForm
          v-if="pendingInteractionRequest"
          :request="pendingInteractionRequest"
          :submitting="interactionSubmitting"
          @confirm="emit('interaction-confirm', $event)"
          @cancel="emit('interaction-cancel')"
        />

        <ChatComposer
          ref="composerRef"
          :model-value="input"
          :more-panel-visible="composerMorePanelVisible"
          :upload-files="uploadFiles"
          :connector-panel-state="activeSession?.connectorPanelState || {}"
          :sending="sending"
          :composer-action-state="composerActionState"
          :can-stop="canStop"
          :connected="connected"
          :session-ready="activeSession?.loaded === true && !loadingSessionDetail"
          :allow-user-interaction="allowUserInteraction"
          :safe-confirm="safeConfirm"
          :safe-confirm-level="safeConfirmLevel"
          :sanitize-output="sanitizeOutput"
          :stream-output="streamOutput"
          :bot-scenario="botScenario"
          :selected-model="selectedModel"
          :memory-model="memoryModel"
          :model-options="availableModelOptions"
          :plugin-model-config="pluginModelConfig"
          :frontend-thresholds-enabled="frontendThresholdsEnabled"
          :summary-policy="summaryPolicy"
          :scenario-options="availableBotScenarios"
          :available-plugins="availablePlugins"
          :selected-plugins="selectedPlugins"
          :interaction-active="Boolean(pendingInteractionRequest)"
          @update:model-value="emit('update:input', $event)"
          @append-uploads="emit('append-uploads', $event)"
          @remove-upload="emit('remove-upload', $event)"
          @update:allow-user-interaction="emit('update:allowUserInteraction', $event)"
          @update:safe-confirm="emit('update:safeConfirm', $event)"
          @update:safe-confirm-level="emit('update:safeConfirmLevel', $event)"
          @update:sanitize-output="emit('update:sanitizeOutput', $event)"
          @update:stream-output="emit('update:streamOutput', $event)"
          @update:bot-scenario="emit('update:botScenario', $event)"
          @update:selected-model="emit('update:selectedModel', $event)"
          @update:memory-model="emit('update:memoryModel', $event)"
          @update:plugin-model-config="emit('update:pluginModelConfig', $event)"
          @update:frontend-thresholds-enabled="emit('update:frontendThresholdsEnabled', $event)"
          @update:summary-policy="emit('update:summaryPolicy', $event)"
          @update:selected-plugins="emit('update:selectedPlugins', $event)"
          @update:more-panel-visible="emit('update:morePanelVisible', $event)"
          @clear-uploads="emit('clear-uploads')"
          @connector-selected="emit('connector-selected', $event)"
          @send="emit('send')"
          @stop="emit('stop')"
        />
      </div>
      <ConversationStateDebugPanel
        v-if="showConversationStateDebugPanel"
        :sending="sending"
        :interaction-submitting="interactionSubmitting"
        :pending-interaction-request="pendingInteractionRequest"
        :conversation-state-snapshot="conversationStateSnapshot"
        :conversation-state-timeline="conversationStateTimeline"
      />
    </main>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  background-color: var(--noobot-surface-sidebar);
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow: hidden;
  color: var(--noobot-text-main);
  position: relative;
  overscroll-behavior: none;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--noobot-panel-bg);
  min-width: 0;
  min-height: 0;
  overscroll-behavior: none;
}

.chat-content-body,
.chat-composer-body {
  overscroll-behavior: none;
}

@media (min-width: 961px) {
  .chat-content-body.chat-navigator-open,
  .chat-composer-body.chat-navigator-open {
    padding-right: 268px;
  }
}

.chat-content-body {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}

.chat-composer-body {
  flex-shrink: 0;
  background: var(--noobot-panel-bg);
  box-sizing: border-box;
}

.chat-message-nav-panel {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 8;
  width: 236px;
  max-width: 24vw;
  padding: 12px;
  backdrop-filter: blur(14px);
  transition:
    width 0.18s ease,
    padding 0.18s ease,
    max-width 0.18s ease;
}

.chat-message-nav-panel.is-collapsed {
  width: 44px;
  max-width: 44px;
  padding: 8px;
}

.chat-message-nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--noobot-text-main);
}

.chat-message-nav-panel.is-collapsed .chat-message-nav-header {
  justify-content: center;
  margin-bottom: 0;
}

.chat-message-nav-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-message-nav-icon {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: var(--noobot-radius-sm);
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  font-weight: 700;
}

.chat-message-nav-icon-button {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  cursor: pointer;
  font: inherit;
}

.chat-message-nav-icon-button:hover,
.chat-message-nav-icon-button:focus-visible {
  background: color-mix(in srgb, var(--el-color-primary) 18%, transparent);
  outline: none;
}

.chat-message-nav-title {
  display: inline-flex;
  font-size: var(--noobot-font-size-md);
  font-weight: 700;
  line-height: 1.2;
}

.chat-message-nav-count {
  display: block;
  margin-top: 2px;
  font-size: var(--noobot-font-size-xs);
  font-weight: 600;
  color: var(--noobot-text-secondary);
}

.chat-message-nav-toggle {
  flex: 0 0 auto;
}

.mobile-chat-message-nav-trigger {
  position: fixed;
  top: calc(56px + 16px + env(safe-area-inset-top));
  right: calc(16px + env(safe-area-inset-right));
  z-index: 2001;
  width: 44px;
  height: 44px;
  pointer-events: auto;
  user-select: none;
}

.mobile-chat-message-nav-trigger-icon {
  font-size: var(--noobot-font-size-lg);
  font-weight: 800;
  line-height: 1;
}

@media (max-width: 960px) {
  .chat-message-nav-panel {
    display: none;
  }
}

.mobile-mask {
  display: none;
}

@media (max-width: 720px) {
  .mobile-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--noobot-mask-bg);
    z-index: 18;
  }
}
</style>
