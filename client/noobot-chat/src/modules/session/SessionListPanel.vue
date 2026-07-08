<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { ChatDotRound, Delete, EditPen } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: "" },
  sending: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
});

const emit = defineEmits(["select-session", "delete-session", "rename-session"]);
const { translate } = useLocale();

const sessionListRef = ref(null);
const lastSessionListScrollTop = ref(0);
const listWrapEl = shallowRef(null);

function onSessionListScroll() {
  if (!listWrapEl.value) return;
  lastSessionListScrollTop.value = Number(listWrapEl.value.scrollTop || 0);
}

function bindSessionListScrollListener() {
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
    Number(listWrapEl.value.scrollHeight || 0) - Number(listWrapEl.value.clientHeight || 0),
  );
  listWrapEl.value.scrollTop = Math.min(lastSessionListScrollTop.value, maxTop);
}

onMounted(() => {
  bindSessionListScrollListener();
});

onBeforeUnmount(() => {
  if (listWrapEl.value) listWrapEl.value.removeEventListener("scroll", onSessionListScroll);
});

async function promptRenameSession(sessionItem = {}) {
  if (props.sending) return;
  const currentTitle = String(sessionItem?.title || "").trim();
  try {
    const { value } = await ElMessageBox.prompt(
      translate("common.renameSessionPlaceholder"),
      translate("common.renameSessionTitle"),
      {
        confirmButtonText: translate("infra.confirm"),
        cancelButtonText: translate("infra.cancel"),
        inputValue: currentTitle,
        inputValidator: (value) => {
          const nextTitle = String(value || "").trim();
          if (!nextTitle) return translate("common.sessionTitleRequired");
          if (nextTitle.length > 80) return translate("common.sessionTitleTooLong");
          if (nextTitle === currentTitle) return translate("common.sessionTitleUnchanged");
          return true;
        },
      },
    );
    emit("rename-session", { sessionId: sessionItem.id, title: String(value || "").trim() });
  } catch {
    // User cancelled.
  }
}

watch(
  () => props.sessions,
  () => restoreSessionListScrollTop(),
  { deep: true },
);
</script>

<template>
  <div class="session-list-panel" :class="{ collapsed }">
    <el-scrollbar ref="sessionListRef" class="session-list">
      <div class="session-list-inner">
        <div
          v-for="sessionItem in sessions"
          :key="sessionItem.id"
          class="session-item noobot-subtle-row"
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
              #{{ sessionItem.backendSessionId ? sessionItem.backendSessionId.slice(0, 8) : translate("common.notStarted") }}
            </div>
          </div>
          <div class="session-actions">
            <button
              type="button"
              class="session-rename-btn noobot-action-btn noobot-flat-icon-btn"
              :title="translate('common.renameSession')"
              :aria-label="translate('common.renameSession')"
              :disabled="sending"
              @click.stop="promptRenameSession(sessionItem)"
            >
              <el-icon><EditPen /></el-icon>
            </button>
            <button
            type="button"
            class="session-delete-btn noobot-action-btn noobot-flat-icon-btn"
            :title="translate('common.deleteSession')"
            :aria-label="translate('common.deleteSession')"
            :disabled="sending"
            @click.stop="emit('delete-session', sessionItem.id)"
          >
            <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<style scoped>
.session-list-panel {
  flex: 1;
  min-height: 0;
}

.session-list {
  height: 100%;
}

.session-list-inner {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.session-item:hover {
  transform: none;
}

.session-item.active {
}

.session-icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--noobot-surface-soft-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  color: var(--noobot-text-main);
}

.session-item.active .session-icon-wrapper {
  background: var(--noobot-btn-primary-bg);
  color: var(--noobot-text-strong);
  box-shadow: none;
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

.session-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.session-rename-btn,
.session-delete-btn {
  display: inline-flex;
  color: var(--noobot-text-muted);
  opacity: 0;
  transform: none;
  transition: opacity 0.2s ease, color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.session-item:hover .session-rename-btn,
.session-item:hover .session-delete-btn,
.session-item.active .session-rename-btn,
.session-item.active .session-delete-btn {
  opacity: 1;
  transform: none;
}

.session-rename-btn:hover {
  color: var(--noobot-text-strong);
  border-color: var(--noobot-panel-border);
  background: var(--noobot-surface-soft-hover);
}

.session-delete-btn:hover {
  color: color-mix(in srgb, var(--noobot-status-error) 70%, var(--noobot-text-strong));
  border-color: var(--noobot-status-error);
  background: var(--noobot-danger-soft);
}

.session-rename-btn:disabled,
.session-delete-btn:disabled {
  opacity: 0.45 !important;
  cursor: not-allowed;
  pointer-events: none;
}

.title {
  font-size: 13px;
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
  font-size: 11px;
  color: var(--noobot-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--noobot-status-idle);
  box-shadow: none;
}

.status-dot.running {
  background-color: var(--noobot-status-running);
  box-shadow: none;
}

.status-dot.done {
  background-color: var(--noobot-status-done);
  box-shadow: none;
}

.status-dot.error {
  background-color: var(--noobot-status-error);
  box-shadow: none;
}

.session-list-panel.collapsed .title,
.session-list-panel.collapsed .sid,
.session-list-panel.collapsed .session-actions {
  display: none;
}

.session-list-panel.collapsed .session-item {
  display: grid;
  place-items: center;
  width: 100%;
  padding: 8px 0;
  gap: 0;
}

.session-list-panel.collapsed .session-list-inner {
  align-items: center;
}

.session-list-panel.collapsed .session-icon-wrapper {
  margin: 0;
}
</style>
