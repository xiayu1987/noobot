<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  isOverlayDismissal,
  overlayMessageBox,
} from "../../../shared/composables/overlayMessageBox.js";
import { ChatDotRound, Delete, EditPen } from "@element-plus/icons-vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { selectSessionTurnRuntime } from "../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { text } from "@noobot/shared/value";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const props = defineProps({
  sessions: { type: Array, required: true },
  activeSessionId: { type: String, required: true },
  turnRuntimeRegistry: { type: Object, required: true },
  sending: { type: Boolean, required: true },
  collapsed: { type: Boolean, required: true },
  isMobile: { type: Boolean, required: true },
});

const emit = defineEmits(["select-session", "delete-session", "rename-session"]);
const { translate } = useLocale();

const sessionListRef = ref(null);
const lastSessionListScrollTop = ref(0);
const listWrapEl = shallowRef(null);
const expandedDateGroups = ref([]);
const sessionPanelRef = ref(null);
const expandedActionSessionId = ref("");
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
let pendingPress = null;
let suppressedClickSessionId = "";

function cancelLongPress() {
  if (pendingPress) clearTimeout(pendingPress.timer);
  pendingPress = null;
}

function startLongPress(event, sessionItem) {
  cancelLongPress();
  suppressedClickSessionId = "";
  if (
    !props.isMobile ||
    props.collapsed ||
    event.isPrimary === false ||
    event.pointerType === "mouse" ||
    event.target.closest("button")
  )
    return;
  pendingPress = {
    sessionId: sessionItem.sessionId,
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      expandedActionSessionId.value = sessionItem.sessionId;
      suppressedClickSessionId = sessionItem.sessionId;
      cancelLongPress();
    }, TIME_THRESHOLDS.client.sessionLongPressDelayMs),
  };
}

function moveLongPress(event) {
  if (!pendingPress) return;
  if (
    Math.hypot(event.clientX - pendingPress.x, event.clientY - pendingPress.y) >
    LONG_PRESS_MOVE_TOLERANCE_PX
  ) {
    suppressedClickSessionId = pendingPress.sessionId;
    cancelLongPress();
  }
}

function showSessionActions(event, sessionItem) {
  if (!props.isMobile || props.collapsed || event.target.closest("button")) return;
  event.preventDefault();
  cancelLongPress();
  suppressedClickSessionId = sessionItem.sessionId;
  expandedActionSessionId.value = sessionItem.sessionId;
}

function selectSession(sessionItem, event) {
  if (event?.type !== "keydown" && suppressedClickSessionId === sessionItem.sessionId) {
    suppressedClickSessionId = "";
    return;
  }
  expandedActionSessionId.value = "";
  emit("select-session", sessionItem.sessionId);
}

function closeSessionActions(event) {
  if (!sessionPanelRef.value?.contains(event.target)) {
    cancelLongPress();
    expandedActionSessionId.value = "";
  }
}

watch(
  () => [props.isMobile, props.collapsed, props.sessions],
  () => {
    cancelLongPress();
    suppressedClickSessionId = "";
    expandedActionSessionId.value = "";
  },
);

const RECENT_DAY_GROUP_COUNT = QUANTITY_THRESHOLDS.client.sessionListRecentDayGroupCount;
const OLDER_GROUP_KEY = "older";
const UNKNOWN_GROUP_KEY = "unknown";

function sessionTimeMs(sessionItem = {}) {
  const timeMs = Date.parse(sessionItem.updatedAt || sessionItem.createdAt || "");
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function olderGroupCutoffMs() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RECENT_DAY_GROUP_COUNT - 1));
  return cutoff.getTime();
}

function dateGroupKey(sessionItem, cutoffMs) {
  const timeMs = sessionTimeMs(sessionItem);
  if (!timeMs) return UNKNOWN_GROUP_KEY;
  if (timeMs < cutoffMs) return OLDER_GROUP_KEY;
  const date = new Date(timeMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const NAMED_GROUP_LABEL_KEYS = {
  [UNKNOWN_GROUP_KEY]: {
    label: "common.sessionDateUnknown",
    compactLabel: "common.sessionDateUnknownCompact",
  },
  [OLDER_GROUP_KEY]: {
    label: "common.sessionDateOlderThanWeek",
    compactLabel: "common.sessionDateOlderCompact",
  },
};

function dateGroupLabels(key) {
  const namedLabelKeys = NAMED_GROUP_LABEL_KEYS[key];
  if (namedLabelKeys) {
    return {
      label: translate(namedLabelKeys.label),
      compactLabel: translate(namedLabelKeys.compactLabel),
    };
  }

  return { label: key, compactLabel: key.slice(5) };
}

const groupedSessions = computed(() => {
  const groupsByDate = new Map();
  const cutoffMs = olderGroupCutoffMs();
  const sortedSessions = [...props.sessions].sort(
    (leftSession, rightSession) => sessionTimeMs(rightSession) - sessionTimeMs(leftSession),
  );
  for (const sessionItem of sortedSessions) {
    const key = dateGroupKey(sessionItem, cutoffMs);
    if (!groupsByDate.has(key)) groupsByDate.set(key, []);
    groupsByDate.get(key).push(sessionItem);
  }
  return [...groupsByDate].map(([key, items]) => ({
    key,
    ...dateGroupLabels(key),
    items,
  }));
});

watch(
  () => groupedSessions.value[0]?.key || "",
  (latestDateKey, previousLatestDateKey) => {
    if (latestDateKey && latestDateKey !== previousLatestDateKey) {
      expandedDateGroups.value = [latestDateKey];
    }
  },
  { immediate: true },
);

function onSessionListScroll() {
  if (pendingPress) suppressedClickSessionId = pendingPress.sessionId;
  cancelLongPress();
  expandedActionSessionId.value = "";
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
  document.addEventListener("pointerdown", closeSessionActions);
  document.addEventListener("pointerup", cancelLongPress);
  document.addEventListener("pointercancel", cancelLongPress);
});

onBeforeUnmount(() => {
  cancelLongPress();
  if (listWrapEl.value) listWrapEl.value.removeEventListener("scroll", onSessionListScroll);
  document.removeEventListener("pointerdown", closeSessionActions);
  document.removeEventListener("pointerup", cancelLongPress);
  document.removeEventListener("pointercancel", cancelLongPress);
});

const statusKeyMap = {
  idle: "common.statusIdle",
  running: "common.statusRunning",
  done: "common.statusDone",
  error: "common.statusError",
};

function formatSessionStatus(status = "") {
  const normalized = text(status).toLowerCase();
  return translate(statusKeyMap[normalized] || "common.statusIdle");
}

function sessionRuntimeStatus(sessionItem = {}) {
  const sessionId = text(sessionItem.sessionId);
  const sessionStatus = selectSessionTurnRuntime(props.turnRuntimeRegistry, sessionId);
  if (sessionStatus.terminal === "error") return "error";
  if (sessionStatus.terminal) return "done";
  if (sessionStatus.sending) return "running";
  return "idle";
}

function formatSessionTime(value = "") {
  const timeMs = Date.parse(value || "");
  if (!Number.isFinite(timeMs)) return "";
  return new Date(timeMs).toLocaleString();
}

async function promptRenameSession(sessionItem = {}) {
  const currentTitle = text(sessionItem?.title);
  try {
    const { value } = await overlayMessageBox.prompt(
      translate("common.renameSessionPlaceholder"),
      translate("common.renameSessionTitle"),
      {
        confirmButtonText: translate("infra.confirm"),
        cancelButtonText: translate("infra.cancel"),
        inputValue: currentTitle,
        inputValidator: (value) => {
          const nextTitle = text(value);
          if (!nextTitle) return translate("common.sessionTitleRequired");
          if (nextTitle.length > 80) return translate("common.sessionTitleTooLong");
          if (nextTitle === currentTitle) return translate("common.sessionTitleUnchanged");
          return true;
        },
      },
    );
    emit("rename-session", { sessionId: sessionItem.sessionId, title: text(value) });
  } catch (error) {
    if (!isOverlayDismissal(error)) throw error;
  }
}

watch(
  () =>
    props.sessions
      .map((sessionItem) =>
        [
          sessionItem?.sessionId,
          sessionItem?.title,
          sessionItem?.updatedAt,
          sessionItem?.createdAt,
        ].join("\u0000"),
      )
      .join("\u0001"),
  () => restoreSessionListScrollTop(),
);
</script>

<template>
  <div
    ref="sessionPanelRef"
    class="session-list-panel"
    :class="{ collapsed, mobile: isMobile }"
    @keydown.esc="expandedActionSessionId = ''"
  >
    <el-scrollbar ref="sessionListRef" class="session-list">
      <el-collapse v-model="expandedDateGroups" class="session-date-collapse">
        <el-collapse-item
          v-for="dateGroup in groupedSessions"
          :key="dateGroup.key"
          :name="dateGroup.key"
        >
          <template #title>
            <div class="session-date-header" :title="dateGroup.label">
              <span class="session-date-label">
                {{ collapsed ? dateGroup.compactLabel : dateGroup.label }}
              </span>
              <button
                v-if="!collapsed"
                type="button"
                class="session-group-delete-btn noobot-action-btn noobot-icon-button noobot-flat-icon-btn"
                :title="translate('common.deleteSessionGroup')"
                :aria-label="translate('common.deleteSessionGroup')"
                @click.stop="
                  emit(
                    'delete-session',
                    dateGroup.items.map((sessionItem) => sessionItem.sessionId),
                  )
                "
                @keydown.stop
              >
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </template>
          <div class="session-list-inner">
            <el-popover
              v-for="sessionItem in dateGroup.items"
              :key="sessionItem.sessionId"
              trigger="hover"
              :disabled="isMobile"
              placement="right"
              :width="264"
              :show-after="220"
              :hide-after="80"
              popper-class="session-hover-popover noobot-navigation-popover"
            >
              <template #reference>
                <div
                  class="session-item noobot-subtle-row"
                  :data-session-id="sessionItem.sessionId"
                  :data-session-local="sessionItem.isLocal === true ? 'true' : 'false'"
                  :class="{
                    active: sessionItem.sessionId === activeSessionId,
                    unavailable: sessionItem.isUnavailable === true,
                    'actions-expanded': expandedActionSessionId === sessionItem.sessionId,
                  }"
                  tabindex="0"
                  :aria-label="sessionItem.title"
                  :aria-disabled="sessionItem.isUnavailable === true ? 'true' : undefined"
                  @click="selectSession(sessionItem)"
                  @pointerdown="startLongPress($event, sessionItem)"
                  @pointermove="moveLongPress"
                  @pointerup="cancelLongPress"
                  @pointercancel="cancelLongPress"
                  @pointerleave="cancelLongPress"
                  @contextmenu="showSessionActions($event, sessionItem)"
                  @keydown.enter.self.prevent="selectSession(sessionItem, $event)"
                  @keydown.space.self.prevent="selectSession(sessionItem, $event)"
                >
                  <div v-if="collapsed" class="session-icon-wrapper">
                    <el-icon class="session-icon"><ChatDotRound /></el-icon>
                  </div>
                  <div class="session-info">
                    <div
                      class="title"
                      :class="
                        sessionItem.isUnavailable ? 'error' : sessionRuntimeStatus(sessionItem)
                      "
                      :aria-label="
                        sessionItem.isUnavailable
                          ? `${sessionItem.title}: ${translate('common.sessionUnavailableLegacyProtocol')}`
                          : `${sessionItem.title}: ${formatSessionStatus(sessionRuntimeStatus(sessionItem))}`
                      "
                    >
                      {{ sessionItem.title }}
                    </div>
                  </div>
                  <div v-if="!collapsed" class="session-actions">
                    <button
                      type="button"
                      class="session-rename-btn noobot-action-btn noobot-icon-button noobot-flat-icon-btn"
                      :title="translate('common.renameSession')"
                      :aria-label="translate('common.renameSession')"
                      :disabled="sessionItem.isUnavailable === true"
                      @click.stop="promptRenameSession(sessionItem)"
                    >
                      <el-icon><EditPen /></el-icon>
                    </button>
                    <button
                      type="button"
                      class="session-delete-btn noobot-action-btn noobot-icon-button noobot-flat-icon-btn"
                      :title="translate('common.deleteSession')"
                      :aria-label="translate('common.deleteSession')"
                      @click.stop="emit('delete-session', [sessionItem.sessionId])"
                    >
                      <el-icon><Delete /></el-icon>
                    </button>
                  </div>
                </div>
              </template>
              <div class="session-popover noobot-navigation-popover__body">
                <div class="session-popover__title">{{ sessionItem.title }}</div>
                <div v-if="sessionItem.isUnavailable" class="session-popover__reason">
                  {{ translate("common.sessionUnavailableLegacyProtocol") }}<br />
                  {{ sessionItem.unavailableReason?.message }}
                </div>
                <ul class="session-popover__meta">
                  <li>
                    <span class="k">{{ translate("common.sessionStatus") }}</span>
                    <span class="v">
                      <span class="status-dot" :class="sessionRuntimeStatus(sessionItem)"></span>
                      {{ formatSessionStatus(sessionRuntimeStatus(sessionItem)) }}
                    </span>
                  </li>
                  <li>
                    <span class="k">{{ translate("common.sessionId") }}</span>
                    <span class="v">{{
                      sessionItem.sessionId || translate("common.notStarted")
                    }}</span>
                  </li>
                  <li>
                    <span class="k">{{ translate("common.sessionMessageCount") }}</span>
                    <span class="v">{{ sessionItem.messageCount || 0 }}</span>
                  </li>
                  <li v-if="formatSessionTime(sessionItem.updatedAt)">
                    <span class="k">{{ translate("common.sessionUpdatedAt") }}</span>
                    <span class="v">{{ formatSessionTime(sessionItem.updatedAt) }}</span>
                  </li>
                  <li v-if="formatSessionTime(sessionItem.createdAt)">
                    <span class="k">{{ translate("common.sessionCreatedAt") }}</span>
                    <span class="v">{{ formatSessionTime(sessionItem.createdAt) }}</span>
                  </li>
                </ul>
              </div>
            </el-popover>
          </div>
        </el-collapse-item>
      </el-collapse>
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
  padding: var(--noobot-space-lg) var(--noobot-space-md) var(--noobot-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-sm);
}

.session-date-collapse {
  --el-collapse-border-color: transparent;
  border: 0;
}

.session-date-collapse :deep(.el-collapse-item__header) {
  height: var(--noobot-control-height-sm);
  padding: 0 var(--noobot-space-sm);
  border: 0;
  background: transparent;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
  font-weight: var(--noobot-font-weight-semibold);
}

.session-date-collapse :deep(.el-collapse-item__wrap) {
  border: 0;
  background: transparent;
}

.session-date-collapse :deep(.el-collapse-item__content) {
  padding: 0;
}

.session-date-header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-2xs);
  width: 100%;
  min-width: 0;
}

.session-date-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: var(--noobot-control-height-xl);
  gap: var(--noobot-space-sm);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
  cursor: pointer;
}

.session-item.unavailable {
  cursor: not-allowed;
  opacity: 0.72;
}

.session-item.unavailable .session-icon-wrapper {
  color: var(--noobot-status-error);
}

.session-icon-wrapper {
  width: var(--noobot-control-icon-size-sm);
  height: var(--noobot-control-icon-size-sm);
  flex: 0 0 var(--noobot-control-icon-size-sm);
  border-radius: var(--noobot-radius-xs);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--noobot-duration-normal) var(--noobot-ease-standard),
    background-color var(--noobot-duration-normal) var(--noobot-ease-standard);
  color: var(--noobot-text-main);
}

.session-item.active .session-icon-wrapper {
  background: var(--noobot-accent-soft);
  color: var(--noobot-text-strong);
}

.session-icon {
  font-size: var(--noobot-font-size-lg);
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
}

.session-actions {
  position: absolute;
  inset-inline-end: var(--noobot-space-sm);
  top: 50%;
  transform: translateY(-50%);
  display: none;
  align-items: center;
  gap: var(--noobot-space-2xs);
  padding-inline-start: var(--noobot-space-lg);
  background: linear-gradient(
    to right,
    transparent,
    var(--noobot-surface-sidebar) var(--noobot-space-lg)
  );
}

.session-list-panel.mobile .session-item {
  -webkit-touch-callout: none;
  user-select: none;
}

.session-list-panel:not(.mobile) .session-item:hover .session-actions,
.session-list-panel:not(.mobile) .session-item:focus-within .session-actions,
.session-list-panel.mobile .session-item.actions-expanded .session-actions {
  display: flex;
}

.session-rename-btn,
.session-delete-btn,
.session-group-delete-btn {
  display: inline-flex;
  color: var(--noobot-text-secondary);
  transform: none;
  transition:
    opacity var(--noobot-duration-normal) var(--noobot-ease-standard),
    color var(--noobot-duration-normal) var(--noobot-ease-standard),
    background-color var(--noobot-duration-normal) var(--noobot-ease-standard),
    border-color var(--noobot-duration-normal) var(--noobot-ease-standard);
}

.session-group-delete-btn {
  opacity: 0;
}

.session-date-header:hover .session-group-delete-btn,
.session-group-delete-btn:focus-visible {
  opacity: 1;
}

.session-rename-btn:hover {
  color: var(--noobot-text-strong);
  border-color: var(--noobot-panel-border);
  background: var(--noobot-surface-soft-hover);
}

.session-delete-btn:hover,
.session-group-delete-btn:hover {
  color: color-mix(in srgb, var(--noobot-status-error) 70%, var(--noobot-text-strong));
  border-color: var(--noobot-status-error);
  background: var(--noobot-danger-soft);
}

.session-rename-btn:disabled,
.session-delete-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: var(--noobot-font-size-md);
  font-weight: var(--noobot-font-weight-medium);
  color: var(--noobot-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--noobot-duration-normal) var(--noobot-ease-standard);
}

.session-item.active .title {
  font-weight: var(--noobot-font-weight-semibold);
}

.title.running {
  color: var(--noobot-status-running);
}

.title.done {
  color: var(--noobot-status-success);
}

.title.error {
  color: var(--noobot-status-error);
}

.session-list-panel.collapsed .session-info {
  display: none;
}

.session-list-panel.collapsed .session-item {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: var(--noobot-control-icon-size-lg);
  height: var(--noobot-control-icon-size-lg);
  padding: 0;
  gap: 0;
}

.session-list-panel.collapsed .session-list-inner {
  align-items: center;
  padding-inline: var(--noobot-space-sm);
}

.session-list-panel.collapsed .session-date-collapse :deep(.el-collapse-item__header) {
  justify-content: center;
  padding: 0 var(--noobot-space-sm);
  font-size: var(--noobot-font-size-xs);
}
</style>

<style>
.session-popover__title {
  font-weight: var(--noobot-font-weight-semibold);
  font-size: var(--noobot-font-size-md);
  margin-bottom: var(--noobot-space-xs);
  word-break: break-word;
  color: var(--noobot-text-strong);
}

.session-popover__meta {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-2xs);
}

.session-popover__meta li {
  display: flex;
  gap: var(--noobot-space-xs);
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-balanced);
}

.session-popover__meta .k {
  flex: 0 0 auto;
  min-width: 56px;
  color: var(--noobot-text-secondary);
}

.session-popover__meta .v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  display: inline-flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  color: var(--noobot-text-strong);
}

.session-popover__meta .status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--noobot-radius-circle);
  background-color: var(--noobot-status-idle);
  flex: 0 0 auto;
}

.session-popover__meta .status-dot.running {
  background-color: var(--noobot-status-running);
}

.session-popover__meta .status-dot.done {
  background-color: var(--noobot-status-success);
}

.session-popover__meta .status-dot.error {
  background-color: var(--noobot-status-error);
}
</style>
