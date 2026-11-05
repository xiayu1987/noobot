<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch } from "vue";
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Expand,
  Fold,
  Key,
  Plus,
  Refresh,
  Setting,
  User,
} from "@element-plus/icons-vue";
import noobotLogo from "../../../shared/assets/noobot.svg";
import SessionListPanel from "./SessionListPanel.vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { sharedSidebarProps } from "../model/sidebarProps.js";

const props = defineProps(sharedSidebarProps);
const connectionPanelOpen = ref(!props.connected);
const settingsButton = ref(null);

watch(
  () => props.connected,
  (connected) => {
    connectionPanelOpen.value = !connected;
  },
);

function closeConnectionPanel() {
  connectionPanelOpen.value = false;
  settingsButton.value?.focus();
}

const emit = defineEmits([
  "toggle-sidebar",
  "update:user-id",
  "update:connect-code",
  "connect",
  "new-session",
  "delete-session",
  "rename-session",
  "refresh-sessions",
  "select-session",
]);
const { translate } = useLocale();
</script>

<template>
  <aside
    class="sidebar"
    :class="{
      collapsed: sidebarCollapsed && !isMobile,
      mobile: isMobile,
      'mobile-open': mobileSidebarOpen && isMobile,
    }"
  >
    <div class="brand">
      <div class="brand-left">
        <div class="brand-logo">
          <img :src="noobotLogo" alt="Noobot Logo" class="brand-logo-img" />
        </div>
        <span class="brand-text">Noobot Console</span>
      </div>
      <button
        class="collapse-btn sidebar-icon-btn noobot-action-btn noobot-icon-button noobot-flat-soft-btn"
        type="button"
        @click="emit('toggle-sidebar')"
        :title="
          sidebarCollapsed ? translate('common.expandSidebar') : translate('common.collapseSidebar')
        "
        :aria-label="
          sidebarCollapsed ? translate('common.expandSidebar') : translate('common.collapseSidebar')
        "
      >
        <el-icon>
          <Expand v-if="sidebarCollapsed" />
          <Fold v-else />
        </el-icon>
      </button>
    </div>

    <div class="sidebar-header">
      <div class="action-row sidebar-actions">
        <el-button
          type="primary"
          class="new-chat-btn noobot-action-btn"
          :icon="Plus"
          @click="emit('new-session')"
          :disabled="!connected"
        >
          {{ translate("common.newSession") }}
        </el-button>
        <el-button
          class="refresh-btn sidebar-icon-btn noobot-action-btn noobot-icon-button noobot-tail-btn"
          :icon="Refresh"
          :loading="loadingSessions"
          @click="emit('refresh-sessions')"
          :disabled="!connected"
          :title="translate('common.refresh')"
          :aria-label="translate('common.refreshSessionList')"
        />
      </div>
    </div>

    <SessionListPanel
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :turn-runtime-registry="turnRuntimeRegistry"
      :sending="sending"
      :collapsed="sidebarCollapsed && !isMobile"
      :is-mobile="isMobile"
      @select-session="emit('select-session', $event)"
      @delete-session="emit('delete-session', $event)"
      @rename-session="emit('rename-session', $event)"
    />

    <div class="sidebar-footer" @keydown.esc.stop.prevent="closeConnectionPanel">
      <section
        v-if="connectionPanelOpen"
        id="sidebar-connection-panel"
        class="connection-panel"
        :aria-label="translate('common.connectionSettings')"
      >
        <div class="connection-panel-heading">
          <span>{{ translate("common.connectionSettings") }}</span>
          <button
            type="button"
            class="noobot-action-btn noobot-flat-soft-btn"
            @click="closeConnectionPanel"
          >
            {{ translate("common.collapse") }}
          </button>
        </div>
        <el-input
          :model-value="userId"
          :placeholder="translate('common.inputUserId')"
          :aria-label="translate('common.inputUserId')"
          @update:model-value="emit('update:user-id', $event)"
        >
          <template #prefix>
            <el-icon class="input-icon"><User /></el-icon>
          </template>
        </el-input>

        <el-input
          :model-value="connectCode"
          :placeholder="translate('common.inputConnectCode')"
          :aria-label="translate('common.inputConnectCode')"
          show-password
          @update:model-value="emit('update:connect-code', $event)"
        >
          <template #prefix>
            <el-icon class="input-icon"><Key /></el-icon>
          </template>
        </el-input>

        <div class="action-row">
          <el-button
            :type="connected ? 'success' : 'primary'"
            class="connect-btn noobot-action-btn"
            :loading="connecting"
            @click="emit('connect')"
          >
            {{ connecting ? translate("common.connecting") : translate("common.connect") }}
          </el-button>
          <span
            class="connection-status"
            :class="{ connected }"
            role="status"
            :title="connected ? translate('common.connected') : translate('common.disconnected')"
            :aria-label="
              connected ? translate('common.connected') : translate('common.disconnected')
            "
          >
            <el-icon>
              <CircleCheckFilled v-if="connected" />
              <CircleCloseFilled v-else />
            </el-icon>
          </span>
        </div>
      </section>
      <button
        ref="settingsButton"
        type="button"
        class="sidebar-settings-btn noobot-action-btn noobot-flat-soft-btn"
        :class="{ connected }"
        :data-connected="connected"
        :aria-expanded="connectionPanelOpen"
        aria-controls="sidebar-connection-panel"
        :aria-label="`${translate('common.connectionSettings')}: ${connected ? translate('common.connected') : translate('common.disconnected')}`"
        :title="`${translate('common.connectionSettings')}: ${connected ? translate('common.connected') : translate('common.disconnected')}`"
        @click="connectionPanelOpen = !connectionPanelOpen"
      >
        <el-icon class="sidebar-settings-icon">
          <CircleCheckFilled v-if="connected" />
          <Setting v-else />
        </el-icon>
        <span class="sidebar-settings-label">{{ translate("common.connectionSettings") }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  min-height: 0;
  width: var(--noobot-side-panel-width);
  min-width: var(--noobot-side-panel-width);
  background: var(--noobot-surface-sidebar);
  border-right: 1px solid var(--noobot-border-weak);
  display: flex;
  flex-direction: column;
  z-index: 10;
  transition:
    width var(--noobot-duration-slow) var(--noobot-ease-emphasized),
    min-width var(--noobot-duration-slow) var(--noobot-ease-emphasized),
    transform var(--noobot-duration-slow) var(--noobot-ease-emphasized);
}

.sidebar.collapsed {
  width: 56px;
  min-width: 56px;
}

.brand {
  flex-shrink: 0;
  padding: var(--noobot-space-sm) var(--noobot-space-xl);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--noobot-sidebar-header-height);
  box-sizing: border-box;
}

.brand-left {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-md);
  min-width: 0;
}

.brand-logo {
  width: var(--noobot-msg-avatar-size);
  height: var(--noobot-msg-avatar-size);
  border-radius: var(--noobot-radius-circle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--noobot-msg-avatar-size);
  background: var(--noobot-msg-avatar-bg);
}

.brand-logo-img {
  width: calc(var(--noobot-msg-avatar-size) * 0.72);
  height: calc(var(--noobot-msg-avatar-size) * 0.72);
  display: block;
}

.brand-text {
  font-size: var(--noobot-font-size-md);
  font-weight: var(--noobot-font-weight-semibold);
  color: var(--noobot-text-strong);
  letter-spacing: var(--noobot-letter-spacing-none);
  white-space: nowrap;
}

.sidebar-icon-btn {
  width: var(--noobot-control-icon-size-lg);
  height: var(--noobot-control-icon-size-lg);
  min-width: var(--noobot-control-icon-size-lg);
  min-height: var(--noobot-control-icon-size-lg);
  flex: 0 0 var(--noobot-control-icon-size-lg);
  margin-left: 0;
}

.sidebar-header {
  flex-shrink: 0;
  padding: var(--noobot-space-2xs) var(--noobot-space-lg) var(--noobot-space-xl);
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-lg);
  border-bottom: 1px solid var(--noobot-border-weak);
}

.input-icon {
  font-size: var(--noobot-font-size-lg);
  color: var(--noobot-text-secondary);
}

.action-row {
  display: flex;
  gap: var(--noobot-space-sm);
  align-items: center;
}

.sidebar-actions {
  margin-top: var(--noobot-space-2xs);
}

.connect-btn,
.new-chat-btn {
  flex: 1 1 0;
  min-width: 0;
  height: var(--noobot-control-height-md);
}

.connection-status {
  display: inline-flex;
  align-items: center;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-lg);
  flex-shrink: 0;
}

.connection-status.connected,
.sidebar-settings-btn.connected .sidebar-settings-icon {
  color: var(--noobot-status-success);
}

.sidebar-footer {
  position: relative;
  flex-shrink: 0;
  margin-top: auto;
  padding: var(--noobot-space-sm);
  border-top: 1px solid var(--noobot-border-weak);
}

.sidebar-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--noobot-space-sm);
  width: 100%;
  min-height: var(--noobot-control-height-md);
}

.connection-panel {
  position: absolute;
  bottom: 100%;
  left: var(--noobot-space-sm);
  z-index: 1;
  box-sizing: border-box;
  width: min(var(--noobot-side-panel-width), calc(100vw - 2 * var(--noobot-space-sm)));
  max-height: calc(100dvh - var(--noobot-control-height-md) - 4 * var(--noobot-space-sm));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
  padding: var(--noobot-space-lg);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-xs);
  background: var(--noobot-panel-bg);
  color: var(--noobot-text-strong);
}

.connection-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-sm);
  font-weight: var(--noobot-font-weight-semibold);
}

.sidebar.collapsed .sidebar-settings-label {
  display: none;
}

.sidebar.collapsed .brand {
  justify-content: center;
  padding: var(--noobot-space-xl) 0;
}

.sidebar.collapsed .brand-left,
.sidebar.collapsed .sidebar-header {
  display: none;
  opacity: 0;
}

.sidebar.mobile {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 100vw;
  min-width: 100vw;
  transform: translateX(-100%);
  z-index: var(--noobot-layer-mobile-sidebar);
}

.sidebar.mobile.mobile-open {
  transform: translateX(0);
}

@media (max-width: 768px) {
  .collapse-btn {
    display: none;
  }
}
</style>
