<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Expand,
  Fold,
  Key,
  Plus,
  Refresh,
  User,
} from "@element-plus/icons-vue";
import noobotLogo from "../../shared/assets/noobot.svg";
import SessionListPanel from "./SessionListPanel.vue";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  sidebarCollapsed: { type: Boolean, default: false },
  isMobile: { type: Boolean, default: false },
  mobileSidebarOpen: { type: Boolean, default: false },
  userId: { type: String, default: "" },
  connectCode: { type: String, default: "" },
  connecting: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  sending: { type: Boolean, default: false },
  loadingSessions: { type: Boolean, default: false },
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: "" },
});

const emit = defineEmits([
  "toggle-sidebar",
  "update:user-id",
  "update:connect-code",
  "connect",
  "new-session",
  "delete-session",
  "refresh-sessions",
  "select-session",
]);
const { t } = useLocale();
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
        class="collapse-btn noobot-action-btn noobot-flat-soft-btn"
        type="button"
        @click="emit('toggle-sidebar')"
        :title="sidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')"
        :aria-label="sidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')"
      >
        <el-icon>
          <Expand v-if="sidebarCollapsed" />
          <Fold v-else />
        </el-icon>
      </button>
    </div>

    <div class="sidebar-header">
      <el-input
        :model-value="userId"
        size="large"
        :placeholder="t('common.inputUserId')"
        class="custom-input"
        @update:model-value="emit('update:user-id', $event)"
      >
        <template #prefix>
          <el-icon class="input-icon"><User /></el-icon>
        </template>
      </el-input>
      
      <div class="connect-row">
        <el-input
          :model-value="connectCode"
          size="large"
          :placeholder="t('common.inputConnectCode')"
          class="custom-input connect-input"
          show-password
          @update:model-value="emit('update:connect-code', $event)"
        >
          <template #prefix>
            <el-icon class="input-icon"><Key /></el-icon>
          </template>
        </el-input>
      </div>
      
      <div class="action-row">
        <el-button
          :type="connected ? 'success' : 'primary'"
          class="connect-btn noobot-action-btn"
          :loading="connecting"
          @click="emit('connect')"
        >
          {{ connecting ? t("common.connecting") : t("common.connect") }}
        </el-button>
        <button
          type="button"
          class="status-btn noobot-action-btn noobot-flat-soft-btn tail-btn"
          :class="{ connected }"
          :title="connected ? t('common.connected') : t('common.disconnected')"
          :aria-label="connected ? t('common.connected') : t('common.disconnected')"
        >
          <el-icon class="status-icon">
            <CircleCheckFilled v-if="connected" />
            <CircleCloseFilled v-else />
          </el-icon>
        </button>
      </div>

      <div class="action-row sidebar-actions">
        <el-button
          type="primary"
          class="new-chat-btn noobot-action-btn"
          :icon="Plus"
          @click="emit('new-session')"
          :disabled="sending || !connected"
        >
          {{ t("common.newSession") }}
        </el-button>
        
        <el-button
          class="refresh-btn noobot-action-btn tail-btn"
          :icon="Refresh"
          :loading="loadingSessions"
          @click="emit('refresh-sessions')"
          :disabled="!connected || sending"
          :title="t('common.refresh')"
          :aria-label="t('common.refreshSessionList')"
        />
      </div>
    </div>

    <SessionListPanel
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :sending="sending"
      :collapsed="sidebarCollapsed && !isMobile"
      @select-session="emit('select-session', $event)"
      @delete-session="emit('delete-session', $event)"
    />
  </aside>
</template>

<style scoped>
/* 定义内部美化变量，提供开箱即用的高级深色主题 */
.sidebar {
  width: 280px;
  min-width: 280px;
  background: var(--noobot-surface-sidebar);
  border-right: 1px solid var(--noobot-border-weak);
  display: flex;
  flex-direction: column;
  z-index: 10;
  box-shadow: none;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar.collapsed {
  width: 80px;
  min-width: 80px;
}

/* 品牌 Logo 区域 */
.brand {
  padding: 24px 20px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 76px;
  box-sizing: border-box;
}

.brand-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-logo {
  filter: none;
  transition: transform 0.3s ease;
}

.brand-logo:hover {
  transform: none;
}

.brand-logo-img {
  width: 30px;
  height: 30px;
  display: block;
}

.brand-text {
  font-size: 18px;
  font-weight: 800;
  background: var(--noobot-cyber-gradient);
  -webkit-background-clip: text;
  color: transparent;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.collapse-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  max-width: 32px;
  max-height: 32px;
  flex: 0 0 32px;
  padding: 0;
  line-height: 1;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.collapse-btn :deep(.el-icon) {
  margin: 0 !important;
}

.collapse-btn:hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: var(--noobot-text-strong);
  transform: none;
}

/* 顶部操作区 */
.sidebar-header {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid var(--noobot-border-weak);
}

/* 自定义输入框样式覆盖 */
.custom-input :deep(.el-input__wrapper) {
  border-radius: 10px;
  background-color: transparent;
  box-shadow: 0 0 0 1px var(--noobot-border-soft) inset;
  transition: all 0.2s ease;
  padding: 0 12px;
}

.custom-input :deep(.el-input__wrapper.is-focus),
.custom-input :deep(.el-input__wrapper:hover) {
  background-color: transparent;
  box-shadow: 0 0 0 1px var(--noobot-border-primary) inset;
}

.custom-input :deep(.el-input__inner) {
  color: var(--noobot-text-main);
  height: 40px;
}

.input-icon {
  font-size: 16px;
  opacity: 0.7;
  color: var(--noobot-text-secondary);
}

.connect-row {
  display: flex;
}

.connect-input {
  width: 100%;
}

.action-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.sidebar-actions {
  margin-top: 4px;
}

.connect-btn,
.new-chat-btn {
  flex: 1 1 0;
  min-width: 0;
  height: 40px;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.new-chat-btn {
  background: color-mix(in srgb, var(--noobot-btn-primary-bg) 88%, var(--noobot-panel-bg));
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 22%, transparent);
  box-shadow: none;
  color: var(--noobot-base-white);
  transition: all 0.2s ease;
}

.new-chat-btn:not(:disabled):hover {
  opacity: 1;
  box-shadow: none;
  transform: none;
  background: color-mix(in srgb, var(--noobot-btn-primary-bg) 94%, var(--noobot-panel-bg));
  border-color: color-mix(in srgb, var(--noobot-panel-border) 30%, transparent);
}

.new-chat-btn:not(:disabled):active {
  transform: none;
}

/* 方形尾部按钮通用样式 */
.tail-btn {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--noobot-btn-soft-bg);
  border: 1px solid var(--noobot-btn-soft-border);
  color: var(--noobot-btn-soft-text);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  margin-left: 0 !important;
  transition: all 0.2s ease;
}

.tail-btn :deep(.el-icon) {
  margin: 0 !important;
}

.refresh-btn:not(:disabled):hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: var(--noobot-text-strong);
  transform: none;
}

.status-btn {
  cursor: default;
  pointer-events: none;
  color: var(--noobot-text-muted);
  background: var(--noobot-panel-muted);
}

.status-btn.connected {
  color: var(--noobot-status-success);
  background: color-mix(in srgb, var(--noobot-status-success) 15%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-success) 30%, transparent);
}

.status-icon {
  font-size: 18px;
}

/* 折叠状态处理 */
.sidebar.collapsed .brand {
  justify-content: center;
  padding: 24px 0;
}

.sidebar.collapsed .brand-left,
.sidebar.collapsed .sidebar-header,
.sidebar.collapsed .connector-summary-wrap {
  display: none;
  opacity: 0;
}

/* 移动端处理 */
.sidebar.mobile {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(86vw, 320px) !important;
  min-width: min(86vw, 320px) !important;
  transform: translateX(-100%);
  z-index: 100;
}

.sidebar.mobile.mobile-open {
  transform: translateX(0);
  box-shadow: none;
}

@media (max-width: 768px) {
  .collapse-btn {
    display: none;
  }
}
</style>
