<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ChatDotRound,
  CircleCheckFilled,
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
let listWrapEl = null;

function resolveSessionListWrap() {
  return (
    sessionListRef.value?.wrapRef ||
    sessionListRef.value?.$el?.querySelector?.(".el-scrollbar__wrap") ||
    null
  );
}

function onSessionListScroll() {
  if (!listWrapEl) return;
  lastSessionListScrollTop.value = Number(listWrapEl.scrollTop || 0);
}

function bindSessionListScrollListener() {
  const nextWrap = resolveSessionListWrap();
  if (!nextWrap) return;
  if (listWrapEl && listWrapEl !== nextWrap) {
    listWrapEl.removeEventListener("scroll", onSessionListScroll);
  }
  listWrapEl = nextWrap;
  listWrapEl.addEventListener("scroll", onSessionListScroll, { passive: true });
}

async function restoreSessionListScrollTop() {
  await nextTick();
  bindSessionListScrollListener();
  if (!listWrapEl) return;
  const maxTop = Math.max(
    0,
    Number(listWrapEl.scrollHeight || 0) - Number(listWrapEl.clientHeight || 0),
  );
  listWrapEl.scrollTop = Math.min(lastSessionListScrollTop.value, maxTop);
}

function onUserIdChange(value) {
  emit("update:user-id", value);
}

function onConnectCodeChange(value) {
  emit("update:connect-code", value);
}

onMounted(() => {
  bindSessionListScrollListener();
});

onBeforeUnmount(() => {
  if (listWrapEl) listWrapEl.removeEventListener("scroll", onSessionListScroll);
});

watch(
  () => props.sessions,
  () => {
    restoreSessionListScrollTop();
  },
  { deep: true },
);
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
        size="default"
        placeholder="输入 User ID"
        class="custom-input"
        @update:model-value="onUserIdChange"
      >
        <template #prefix>
          <el-icon class="input-icon"><User /></el-icon>
        </template>
      </el-input>
      
      <div class="connect-row">
        <el-input
          :model-value="connectCode"
          size="default"
          placeholder="输入连接码"
          class="custom-input connect-input"
          show-password
          @update:model-value="onConnectCodeChange"
        >
          <template #prefix>
            <el-icon class="input-icon"><Key /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="connect-actions action-row">
        <el-button
          :type="connected ? 'success' : 'primary'"
          class="connect-btn noobot-action-btn"
          :loading="connecting"
          @click="emit('connect')"
        >
          {{ connecting ? "连接中" : "连接" }}
        </el-button>
        <button
          type="button"
          class="status-btn noobot-action-btn tail-btn"
          :class="{ connected }"
          :title="connected ? '已连接' : '未连接'"
        >
          <el-icon class="status-icon">
            <CircleCheckFilled v-if="connected" />
            <CircleCloseFilled v-else />
          </el-icon>
        </button>
      </div>

      <div class="sidebar-actions action-row">
        <el-button
          type="primary"
          class="new-chat-btn noobot-action-btn"
          @click="emit('new-session')"
          :disabled="sending || !connected"
        >
          <el-icon class="btn-icon"><Plus /></el-icon>
          新建会话
        </el-button>
        <el-button
          class="refresh-btn noobot-action-btn tail-btn"
          :loading="loadingSessions"
          @click="emit('refresh-sessions')"
          :disabled="!connected"
          title="刷新"
        >
          <el-icon><Refresh /></el-icon>
        </el-button>
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
/* 侧边栏主容器 */
.sidebar {
  width: 280px;
  min-width: 280px;
  background: var(--noobot-surface-sidebar); /* 更深邃的背景色 */
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
  height: 72px;
  box-sizing: border-box;
}

.brand-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-logo {
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.3));
}

.brand-logo-img {
  width: 28px;
  height: 28px;
  display: block;
}

.brand-text {
  font-size: 17px;
  font-weight: 700;
  color: var(--noobot-text-strong);
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.collapse-btn {
  border: 1px solid var(--noobot-btn-soft-border);
  background: var(--noobot-btn-soft-bg);
  color: var(--noobot-btn-soft-text);
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn:hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: var(--noobot-text-strong);
}

/* 顶部操作区 */
.sidebar-header {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-bottom: 1px solid var(--noobot-border-weak);
}

/* 自定义输入框样式覆盖 */
.custom-input :deep(.el-input__wrapper) {
  border-radius: 8px;
  background-color: var(--noobot-surface-soft);
  box-shadow: 0 0 0 1px var(--noobot-border-soft) inset;
  transition: all 0.2s ease;
}

.custom-input :deep(.el-input__wrapper.is-focus),
.custom-input :deep(.el-input__wrapper:hover) {
  background-color: var(--noobot-surface-soft-hover);
  box-shadow: 0 0 0 1px var(--noobot-border-primary) inset;
}

.custom-input :deep(.el-input__inner) {
  color: var(--noobot-text-main);
}

.input-icon {
  font-size: 14px;
  opacity: 0.7;
}

.btn-icon {
  margin-right: 4px;
}

.connect-row {
  display: flex;
}

.connect-input {
  width: 100%;
}

.connect-actions {
}

.connect-btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px 16px;
}

.action-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sidebar-actions {
  margin-top: 4px;
}

.new-chat-btn {
  flex: 1 1 0;
  min-width: 0;
  background: var(--noobot-btn-primary-bg);
  border: none;
  transition: opacity 0.2s ease, transform 0.1s ease;
}

.new-chat-btn:not(:disabled):hover {
  opacity: var(--noobot-btn-primary-hover-opacity);
}

.new-chat-btn:not(:disabled):active {
  transform: scale(0.98);
}

.refresh-btn {
  margin-left: 0 !important;
}

.tail-btn {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  background: var(--noobot-btn-soft-bg);
  border: 1px solid var(--noobot-btn-soft-border);
  color: var(--noobot-btn-soft-text);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.refresh-btn:not(:disabled):hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: #fff;
}

.status-btn {
  cursor: default;
  pointer-events: none;
  color: var(--noobot-text-muted);
}

.status-btn.connected {
  color: var(--noobot-status-success);
}

.status-icon {
  font-size: 14px;
}

/* 会话列表区 */
.session-list {
  flex: 1;
}

.session-list-inner {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-item:hover {
  background: var(--noobot-surface-item-hover);
}

.session-item.active {
  background: var(--noobot-surface-primary-soft);
  border-color: var(--noobot-surface-primary-soft-strong);
}

.session-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--noobot-surface-soft-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.session-item.active .session-icon-wrapper {
  background: var(--noobot-surface-primary-soft-strong);
}

.session-icon {
  font-size: 16px;
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-delete-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--noobot-btn-soft-border);
  background: var(--noobot-btn-soft-bg);
  color: var(--noobot-text-muted);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
}

.session-item:hover .session-delete-btn,
.session-item.active .session-delete-btn {
  opacity: 1;
}

.session-delete-btn:hover {
  color: #fecaca;
  border-color: #b91c1c;
  background: rgba(185, 28, 28, 0.16);
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
  color: var(--noobot-text-accent);
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
  padding: 20px 0;
}

.sidebar.collapsed .brand-left,
.sidebar.collapsed .sidebar-header,
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
  padding: 10px 0;
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
