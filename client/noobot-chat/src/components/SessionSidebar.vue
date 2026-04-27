<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  ChatDotRound,
  CircleCheckFilled,
  WarningFilled,
  CircleCloseFilled,
  Delete,
  Expand,
  Fold,
  Key,
  Plus,
  Refresh,
  User,
} from "@element-plus/icons-vue";
import noobotLogo from "../assets/noobot.svg";

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
  activeConnectorPanelState: { type: Object, default: () => ({}) },
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

const sessionListRef = ref(null);
const lastSessionListScrollTop = ref(0);
// 使用 shallowRef 避免跨实例污染，且不需要深度响应式
const listWrapEl = shallowRef(null);

function onSessionListScroll() {
  if (!listWrapEl.value) return;
  lastSessionListScrollTop.value = Number(listWrapEl.value.scrollTop || 0);
}

function bindSessionListScrollListener() {
  // 直接使用 Element Plus 暴露的 wrapRef
  const nextWrap = sessionListRef.value?.wrapRef;
  if (!nextWrap) return;
  
  if (listWrapEl.value && listWrapEl.value !== nextWrap) {
    listWrapEl.value.removeEventListener("scroll", onSessionListScroll);
  }
  
  listWrapEl.value = nextWrap;
  listWrapEl.value.addEventListener("scroll", onSessionListScroll, { passive: true });
}

async function restoreSessionListScrollTop() {
  await nextTick();
  bindSessionListScrollListener();
  if (!listWrapEl.value) return;
  
  const maxTop = Math.max(
    0,
    Number(listWrapEl.value.scrollHeight || 0) - Number(listWrapEl.value.clientHeight || 0)
  );
  listWrapEl.value.scrollTop = Math.min(lastSessionListScrollTop.value, maxTop);
}

onMounted(() => {
  bindSessionListScrollListener();
});

onBeforeUnmount(() => {
  if (listWrapEl.value) {
    listWrapEl.value.removeEventListener("scroll", onSessionListScroll);
  }
});

watch(
  () => props.sessions,
  () => restoreSessionListScrollTop(),
  { deep: true }
);

const connectorSummaryGroups = computed(() => {
  const panelState =
    props.activeConnectorPanelState &&
    typeof props.activeConnectorPanelState === "object"
      ? props.activeConnectorPanelState
      : {};
  const groups =
    panelState.groups && typeof panelState.groups === "object"
      ? panelState.groups
      : {};
  const selectedConnectors =
    panelState.selectedConnectors && typeof panelState.selectedConnectors === "object"
      ? panelState.selectedConnectors
      : {};
  const buildGroup = (groupKey = "", groupLabel = "") => {
    const items = Array.isArray(groups?.[groupKey]) ? groups[groupKey] : [];
    const selectedName = String(selectedConnectors?.[groupKey] || "").trim();
    const selectedItem =
      items.find(
        (connectorItem) =>
          String(connectorItem?.connectorName || "").trim() === selectedName,
      ) || null;
    return {
      key: groupKey,
      label: groupLabel,
      selectedName,
      status: String(selectedItem?.status || "unknown").trim(),
    };
  };
  return [
    buildGroup("database", "数据库"),
    buildGroup("terminal", "终端"),
    buildGroup("email", "邮件"),
  ];
});

function connectorStatusIcon(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return CircleCheckFilled;
  if (normalizedStatus === "error") return CircleCloseFilled;
  return WarningFilled;
}

function connectorStatusClass(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return "status-connected";
  if (normalizedStatus === "error") return "status-error";
  return "status-unknown";
}
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
        class="collapse-btn noobot-action-btn"
        type="button"
        @click="emit('toggle-sidebar')"
        :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
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
        placeholder="输入 User ID"
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
          placeholder="输入连接码"
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
          {{ connecting ? "连接中..." : "建立连接" }}
        </el-button>
        <button
          type="button"
          class="status-btn noobot-action-btn tail-btn"
          :class="{ connected }"
          :title="connected ? '已连接' : '未连接'"
          :aria-label="connected ? '已连接' : '未连接'"
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
          新建会话
        </el-button>
        
        <el-button
          class="refresh-btn noobot-action-btn tail-btn"
          :icon="Refresh"
          :loading="loadingSessions"
          @click="emit('refresh-sessions')"
          :disabled="!connected || sending"
          title="刷新"
          aria-label="刷新会话列表"
        />
      </div>
    </div>

    <div class="connector-summary">
      <div class="connector-summary-title">当前勾选连接器</div>
      <div class="connector-summary-list">
        <div
          v-for="connectorGroup in connectorSummaryGroups"
          :key="connectorGroup.key"
          class="connector-summary-item"
        >
          <span class="connector-summary-label">{{ connectorGroup.label }}</span>
          <span
            v-if="connectorGroup.selectedName"
            class="connector-summary-value"
          >
            <el-icon
              class="connector-summary-status"
              :class="connectorStatusClass(connectorGroup.status)"
            >
              <component :is="connectorStatusIcon(connectorGroup.status)" />
            </el-icon>
            <span class="connector-summary-name">{{
              connectorGroup.selectedName
            }}</span>
          </span>
          <span v-else class="connector-summary-empty">未勾选</span>
        </div>
      </div>
    </div>

    <el-scrollbar ref="sessionListRef" class="session-list">
      <div class="session-list-inner">
        <div
          v-for="sessionItem in sessions"
          :key="sessionItem.id"
          class="session-item"
          :class="{ active: sessionItem.id === activeSessionId }"
          @click="emit('select-session', sessionItem.id)"
        >
          <div class="session-icon-wrapper">
            <el-icon class="session-icon"><ChatDotRound /></el-icon>
          </div>
          <div class="session-info">
            <div class="title">{{ sessionItem.title }}</div>
            <div class="sid">
              <span class="status-dot" :class="sessionItem.currentTaskStatus"></span>
              #{{
                sessionItem.backendSessionId
                  ? sessionItem.backendSessionId.slice(0, 8)
                  : "未开始"
              }}
            </div>
          </div>
          <button
            type="button"
            class="session-delete-btn noobot-action-btn"
            title="删除会话"
            aria-label="删除会话"
            :disabled="sending"
            @click.stop="emit('delete-session', sessionItem.id)"
          >
            <el-icon><Delete /></el-icon>
          </button>
        </div>
      </div>
    </el-scrollbar>
  </aside>
</template>

<style scoped>
/* 定义内部美化变量，提供开箱即用的高级深色主题 */
.sidebar {
  --noobot-surface-sidebar: #0b0f19;
  --noobot-border-weak: rgba(255, 255, 255, 0.06);
  --noobot-text-strong: #f8fafc;
  --noobot-text-main: #cbd5e1;
  --noobot-text-weak: #94a3b8;
  --noobot-text-muted: #64748b;
  --noobot-text-accent: #60a5fa;
  --noobot-surface-soft: #141a29;
  --noobot-surface-soft-hover: #1e293b;
  --noobot-border-soft: rgba(255, 255, 255, 0.1);
  --noobot-border-primary: #3b82f6;
  --noobot-btn-primary-bg: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  --noobot-btn-primary-hover-opacity: 0.9;
  --noobot-btn-soft-bg: #1e293b;
  --noobot-btn-soft-bg-hover: #334155;
  --noobot-btn-soft-border: rgba(255, 255, 255, 0.08);
  --noobot-btn-soft-text: #cbd5e1;
  --noobot-surface-item-hover: rgba(255, 255, 255, 0.03);
  --noobot-surface-primary-soft: rgba(59, 130, 246, 0.12);
  --noobot-surface-primary-soft-strong: rgba(59, 130, 246, 0.25);
  --noobot-status-success: #10b981;
  --noobot-status-idle: #64748b;
  --noobot-status-running: #3b82f6;
  --noobot-status-done: #10b981;
  --noobot-status-error: #ef4444;

  width: 280px;
  min-width: 280px;
  background: var(--noobot-surface-sidebar);
  border-right: 1px solid var(--noobot-border-weak);
  display: flex;
  flex-direction: column;
  z-index: 10;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.2);
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
  filter: drop-shadow(0 2px 8px rgba(59, 130, 246, 0.4));
  transition: transform 0.3s ease;
}

.brand-logo:hover {
  transform: scale(1.05) rotate(-5deg);
}

.brand-logo-img {
  width: 30px;
  height: 30px;
  display: block;
}

.brand-text {
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(to right, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  color: transparent;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.collapse-btn {
  border: 1px solid var(--noobot-btn-soft-border);
  background: var(--noobot-btn-soft-bg);
  color: var(--noobot-btn-soft-text);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.collapse-btn:hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: var(--noobot-text-strong);
  transform: scale(1.05);
}

/* 顶部操作区 */
.sidebar-header {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid var(--noobot-border-weak);
}

/* 连接器面板 - 玻璃拟态风格 */
.connector-summary {
  margin: 16px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.connector-summary-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--noobot-text-weak);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.connector-summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connector-summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.connector-summary-label {
  color: var(--noobot-text-weak);
  flex-shrink: 0;
}

.connector-summary-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.connector-summary-status {
  font-size: 12px;
}

.connector-summary-status.status-connected { color: #34d399; }
.connector-summary-status.status-error { color: #f87171; }
.connector-summary-status.status-unknown { color: #fbbf24; }

.connector-summary-name {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--noobot-text-strong);
  font-weight: 500;
}

.connector-summary-empty {
  color: var(--noobot-text-muted);
  font-style: italic;
}

/* 自定义输入框样式覆盖 */
.custom-input :deep(.el-input__wrapper) {
  border-radius: 10px;
  background-color: var(--noobot-surface-soft);
  box-shadow: 0 0 0 1px var(--noobot-border-soft) inset;
  transition: all 0.2s ease;
  padding: 0 12px;
}

.custom-input :deep(.el-input__wrapper.is-focus),
.custom-input :deep(.el-input__wrapper:hover) {
  background-color: var(--noobot-surface-soft-hover);
  box-shadow: 0 0 0 1px var(--noobot-border-primary) inset;
}

.custom-input :deep(.el-input__inner) {
  color: var(--noobot-text-main);
  height: 40px;
}

.input-icon {
  font-size: 16px;
  opacity: 0.7;
  color: var(--noobot-text-weak);
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
  background: var(--noobot-btn-primary-bg);
  border: none;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
  transition: all 0.2s ease;
}

.new-chat-btn:not(:disabled):hover {
  opacity: var(--noobot-btn-primary-hover-opacity);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
  transform: translateY(-1px);
}

.new-chat-btn:not(:disabled):active {
  transform: scale(0.98);
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
  color: #fff;
  transform: rotate(15deg);
}

.status-btn {
  cursor: default;
  pointer-events: none;
  color: var(--noobot-text-muted);
  background: rgba(255, 255, 255, 0.02);
}

.status-btn.connected {
  color: var(--noobot-status-success);
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
}

.status-icon {
  font-size: 18px;
}

/* 会话列表区 */
.session-list {
  flex: 1;
}

.session-list-inner {
  padding: 5px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-item:hover {
  background: var(--noobot-surface-item-hover);
  transform: translateY(-1px);
}

.session-item.active {
  background: var(--noobot-surface-primary-soft);
  border-color: var(--noobot-surface-primary-soft-strong);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.session-icon-wrapper {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--noobot-surface-soft-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  color: var(--noobot-text-main);
}

.session-item.active .session-icon-wrapper {
  background: var(--noobot-btn-primary-bg);
  color: #fff;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
}

.session-icon {
  font-size: 18px;
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-delete-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--noobot-btn-soft-border);
  background: var(--noobot-btn-soft-bg);
  color: var(--noobot-text-muted);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.9);
  transition: all 0.2s ease;
}

.session-item:hover .session-delete-btn,
.session-item.active .session-delete-btn {
  opacity: 1;
  transform: scale(1);
}

.session-delete-btn:hover {
  color: #fca5a5;
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.session-delete-btn:disabled {
  opacity: 0.45 !important;
  cursor: not-allowed;
  pointer-events: none;
}

.title {
  font-size: 14px;
  font-weight: 500;
  color: var(--noobot-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}

.session-item.active .title {
  color: var(--noobot-text-strong);
  font-weight: 600;
}

.sid {
  font-size: 12px;
  color: var(--noobot-text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--noobot-status-idle);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.status-dot.running {
  background-color: var(--noobot-status-running);
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}

.status-dot.done {
  background-color: var(--noobot-status-done);
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}

.status-dot.error {
  background-color: var(--noobot-status-error);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
}

/* 折叠状态处理 */
.sidebar.collapsed .brand {
  justify-content: center;
  padding: 24px 0;
}

.sidebar.collapsed .brand-left,
.sidebar.collapsed .sidebar-header,
.sidebar.collapsed .connector-summary,
.sidebar.collapsed .title,
.sidebar.collapsed .sid,
.sidebar.collapsed .session-delete-btn {
  display: none;
  opacity: 0;
}

.sidebar.collapsed .session-item {
  display: grid;
  place-items: center;
  width: 100%;
  padding: 12px 0;
  gap: 0;
}

.sidebar.collapsed .session-list-inner {
  align-items: center;
}

.sidebar.collapsed .session-icon-wrapper {
  margin: 0;
}

/* 移动端处理 */
.sidebar.mobile {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px !important;
  min-width: 280px !important;
  transform: translateX(-100%);
  z-index: 100;
}

.sidebar.mobile.mobile-open {
  transform: translateX(0);
  box-shadow: 10px 0 30px rgba(0, 0, 0, 0.5);
}

@media (max-width: 768px) {
  .collapse-btn {
    display: none;
  }
}
</style>