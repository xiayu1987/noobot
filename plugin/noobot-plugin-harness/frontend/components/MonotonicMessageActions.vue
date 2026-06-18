<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { translateHarnessFallback, useHarnessLocale } from "../i18n";

const props = defineProps({
  visible: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  messageItem: { type: Object, default: () => ({}) },
  translate: { type: Function, default: (key = "") => key },
  onDelete: { type: Function, default: null },
  onResend: { type: Function, default: null },
});

const operating = ref(false);
const editing = ref(false);
const draftContent = ref("");
const textareaRef = ref(null);
const { translate: translateHarness } = useHarnessLocale();

function t(key) {
  const fallbackTranslated = translateHarnessFallback(key);
  const translated = props.translate(key, fallbackTranslated);
  if (translated && translated !== key) return translated;
  const localTranslated = translateHarness(key);
  return localTranslated && localTranslated !== key ? localTranslated : fallbackTranslated;
}

function markEditing(value) {
  editing.value = value;
  if (props.messageItem && typeof props.messageItem === "object") {
    props.messageItem.__monotonicEditing = value;
  }
}

async function runAction(action) {
  if (props.disabled || operating.value || typeof action !== "function") return;
  operating.value = true;
  try {
    await action();
  } catch (error) {
    ElMessage.error(error?.message || t("message.monotonicActionFailed"));
  } finally {
    operating.value = false;
  }
}

function handleEdit() {
  if (props.disabled || operating.value || typeof props.onResend !== "function") return;
  draftContent.value = String(props.messageItem?.content || "");
  markEditing(true);
  nextTick(() => {
    const input = textareaRef.value;
    input?.focus?.();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  });
}

function handleCancelEdit() {
  if (operating.value) return;
  markEditing(false);
  draftContent.value = "";
}

async function handleSendEdited() {
  const nextContent = String(draftContent.value || "").trim();
  if (!nextContent) {
    ElMessage.error(t("message.contentRequired"));
    return;
  }
  await runAction(async () => {
    await props.onResend(props.messageItem, nextContent);
    markEditing(false);
  });
}

async function handleDelete() {
  await runAction(async () => {
    await ElMessageBox.confirm(
      t("message.monotonicDeleteConfirm"),
      t("message.monotonicDeleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
      },
    );
    await props.onDelete(props.messageItem);
  });
}
</script>

<template>
  <div v-if="visible" class="monotonic-message-actions" :class="{ editing }">
    <template v-if="editing">
      <div class="monotonic-edit-card">
        <textarea
          ref="textareaRef"
          v-model="draftContent"
          class="monotonic-edit-textarea"
          :disabled="disabled || operating"
          :placeholder="t('message.monotonicEditPlaceholder')"
          rows="4"
          @keydown.ctrl.enter.prevent="handleSendEdited"
          @keydown.meta.enter.prevent="handleSendEdited"
          @keydown.esc.prevent="handleCancelEdit"
        />
        <div class="monotonic-edit-footer">
          <span class="monotonic-edit-tip">
            {{ t("message.monotonicEditTip") }}
          </span>
          <div class="monotonic-edit-buttons">
            <button
              type="button"
              class="monotonic-action-btn ghost"
              :disabled="operating"
              @click="handleCancelEdit"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              type="button"
              class="monotonic-action-btn primary"
              :disabled="disabled || operating || !String(draftContent || '').trim()"
              @click="handleSendEdited"
            >
              <span v-if="operating" class="monotonic-spinner" />
              {{ t("message.monotonicSendEdited") }}
            </button>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="monotonic-action-bar">
        <button
          v-if="onResend"
          type="button"
          class="monotonic-chip-btn edit"
          :disabled="disabled || operating"
          @click="handleEdit"
        >
          <span class="monotonic-btn-icon">✎</span>
          {{ t("message.monotonicEdit") }}
        </button>
        <button
          v-if="onDelete"
          type="button"
          class="monotonic-chip-btn delete"
          :disabled="disabled || operating"
          @click="handleDelete"
        >
          <span class="monotonic-btn-icon">⌫</span>
          {{ t("message.monotonicDelete") }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.monotonic-message-actions {
  width: 100%;
  margin-top: 10px;
}

.monotonic-action-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  opacity: 0.88;
}

.monotonic-chip-btn,
.monotonic-action-btn {
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.monotonic-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  color: color-mix(in srgb, var(--noobot-base-white) 86%, var(--noobot-base-blue-500));
  background: color-mix(in srgb, var(--noobot-base-white) 14%, transparent);
  border-color: color-mix(in srgb, var(--noobot-base-white) 22%, transparent);
}

.monotonic-chip-btn.edit:hover:not(:disabled) {
  background: color-mix(in srgb, var(--noobot-base-white) 22%, transparent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--noobot-base-black) 18%, transparent);
  transform: translateY(-1px);
}

.monotonic-chip-btn.delete {
  color: color-mix(in srgb, var(--noobot-base-red-500) 42%, var(--noobot-base-white));
}

.monotonic-chip-btn.delete:hover:not(:disabled) {
  background: color-mix(in srgb, var(--noobot-base-red-500) 18%, transparent);
  border-color: color-mix(in srgb, var(--noobot-base-red-500) 34%, transparent);
  transform: translateY(-1px);
}

.monotonic-chip-btn:disabled,
.monotonic-action-btn:disabled,
.monotonic-edit-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.monotonic-btn-icon {
  font-size: 13px;
  line-height: 1;
}

.monotonic-edit-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0 0;
}

.monotonic-edit-textarea {
  width: 100%;
  min-height: 104px;
  resize: vertical;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--noobot-base-white) 28%, transparent);
  color: var(--noobot-msg-user-text);
  background: color-mix(in srgb, var(--noobot-base-black) 10%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--noobot-base-white) 10%, transparent);
  padding: 12px 13px;
  font: inherit;
  line-height: 1.58;
  outline: none;
}

.monotonic-edit-textarea:focus {
  border-color: color-mix(in srgb, var(--noobot-base-white) 48%, var(--noobot-base-blue-500));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--noobot-base-white) 14%, transparent);
}

.monotonic-edit-textarea::placeholder {
  color: color-mix(in srgb, var(--noobot-msg-user-text) 58%, transparent);
}

.monotonic-edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.monotonic-edit-tip {
  min-width: 0;
  color: color-mix(in srgb, var(--noobot-msg-user-text) 68%, transparent);
  font-size: 12px;
  line-height: 1.35;
}

.monotonic-edit-buttons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.monotonic-action-btn {
  height: 32px;
  padding: 0 14px;
}

.monotonic-action-btn.ghost {
  color: color-mix(in srgb, var(--noobot-msg-user-text) 82%, transparent);
  background: color-mix(in srgb, var(--noobot-base-white) 10%, transparent);
  border-color: color-mix(in srgb, var(--noobot-base-white) 18%, transparent);
}

.monotonic-action-btn.primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--noobot-base-blue-600);
  background: color-mix(in srgb, var(--noobot-base-white) 92%, var(--noobot-base-blue-500));
  box-shadow: 0 8px 18px color-mix(in srgb, var(--noobot-base-black) 18%, transparent);
}

.monotonic-action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.monotonic-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--noobot-base-blue-600) 25%, transparent);
  border-top-color: var(--noobot-base-blue-600);
  animation: monotonic-spin 0.8s linear infinite;
}

@keyframes monotonic-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .monotonic-edit-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .monotonic-edit-buttons {
    justify-content: flex-end;
  }
}
</style>
