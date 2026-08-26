<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref } from "vue";
import {
  attachmentIcon,
  attachmentTypeLabel,
  formatAttachmentSize,
} from "../../../model/message-actions/attachmentFormat.js";

const props = defineProps({
  disabled: { type: Boolean, default: false },
  operating: { type: Boolean, default: false },
  editAttachments: { type: Array, default: () => [] },
  attachmentStats: { type: Object, default: () => ({ total: 0, history: 0, added: 0 }) },
  t: { type: Function, default: (key = "") => key },
});

const draftContent = defineModel({ type: String, default: "" });

const emit = defineEmits(["send", "cancel", "add-files", "remove-attachment"]);

const textareaRef = ref(null);
const fileInputRef = ref(null);

function focusTextarea() {
  const input = textareaRef.value;
  input?.focus?.();
  input?.setSelectionRange?.(input.value.length, input.value.length);
}

function handleChooseFiles() {
  if (props.disabled || props.operating) return;
  fileInputRef.value?.click?.();
}

function handleAttachmentInput(event) {
  const files = Array.from(event?.target?.files || []).filter(Boolean);
  if (event?.target) event.target.value = "";
  if (!files.length) return;
  emit("add-files", files);
}

defineExpose({ focusTextarea });
</script>

<template>
  <div class="monotonic-edit-card noobot-surface-card">
    <div class="monotonic-edit-heading">
      <div class="monotonic-edit-heading-copy">
        <div class="monotonic-edit-title">编辑并重发</div>
        <div class="monotonic-edit-subtitle">调整内容和附件后，将替换本轮消息并重新生成回复</div>
      </div>
      <el-tag type="primary" effect="light" round class="monotonic-mode-tag">
        <svg class="monotonic-mode-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"></polyline>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
        </svg>
        重发模式
      </el-tag>
    </div>

    <div class="monotonic-edit-body">
      <el-input
        ref="textareaRef"
        v-model="draftContent"
        class="monotonic-edit-textarea"
        type="textarea"
        :disabled="disabled || operating"
        :placeholder="t('message.monotonicEditPlaceholder')"
        :autosize="{ minRows: 4, maxRows: 10 }"
        @keydown.ctrl.enter.prevent="emit('send')"
        @keydown.meta.enter.prevent="emit('send')"
        @keydown.esc.prevent="emit('cancel')"
      />

      <div class="monotonic-edit-attachments">
        <div class="monotonic-attachment-header">
          <div class="monotonic-attachment-copy">
            <span class="monotonic-attachment-title">附件列表</span>
          </div>
          <div class="monotonic-attachment-stats">
            <el-tag size="small" effect="plain" round class="stat-tag noobot-soft-badge">{{ attachmentStats.total }} 个</el-tag>
            <el-tag v-if="attachmentStats.history" size="small" type="info" effect="light" round class="stat-tag noobot-soft-badge">原 {{ attachmentStats.history }}</el-tag>
            <el-tag v-if="attachmentStats.added" size="small" type="success" effect="light" round class="stat-tag noobot-soft-badge is-success">新 {{ attachmentStats.added }}</el-tag>
          </div>
        </div>

        <el-empty
          v-if="!editAttachments.length"
          class="monotonic-attachment-empty noobot-subtle-row"
          :image-size="48"
          description="暂无附件，可点击下方按钮添加"
        />

        <el-scrollbar v-else max-height="200px" class="monotonic-attachment-scroll">
          <div class="monotonic-attachment-list">
            <div
              v-for="(attachment, index) in editAttachments"
              :key="attachment.key || index"
              class="monotonic-attachment-item noobot-subtle-row"
            >
              <el-image
                v-if="attachment.previewUrl"
                class="monotonic-attachment-preview"
                :src="attachment.previewUrl"
                fit="cover"
                :preview-src-list="[attachment.previewUrl]"
                preview-teleported
              />
              <div v-else class="monotonic-attachment-icon">{{ attachmentIcon(attachment) }}</div>

              <div class="monotonic-attachment-meta">
                <div class="monotonic-attachment-name" :title="attachment.name">{{ attachment.name }}</div>
                <div class="monotonic-attachment-desc">
                  <el-tag size="small" :type="attachment.kind === 'new' ? 'success' : 'info'" effect="light" class="kind-tag">
                    {{ attachment.kind === 'new' ? '新增' : '原附件' }}
                  </el-tag>
                  <span class="dot" aria-hidden="true">·</span>
                  <span class="desc-text">{{ attachmentTypeLabel(attachment) }}</span>
                  <span class="dot" aria-hidden="true">·</span>
                  <span class="desc-text">{{ formatAttachmentSize(attachment.size) }}</span>
                </div>
              </div>

              <button
                class="monotonic-attachment-remove"
                :disabled="operating"
                @click="emit('remove-attachment', index)"
                title="移除附件"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        </el-scrollbar>

        <input
          ref="fileInputRef"
          class="monotonic-file-input"
          type="file"
          multiple
          :disabled="disabled || operating"
          @change="handleAttachmentInput"
        />
        <button
          class="monotonic-add-attachment-btn"
          :disabled="disabled || operating"
          @click="handleChooseFiles"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          添加附件
        </button>
      </div>
    </div>

    <div class="monotonic-edit-footer">
      <span class="monotonic-edit-tip">
        <svg class="monotonic-tip-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        {{ t("message.monotonicEditTip") }}
      </span>
      <div class="monotonic-edit-buttons">
        <el-button
          class="monotonic-footer-btn"
          :disabled="operating"
          @click="emit('cancel')"
          round
        >
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          class="monotonic-footer-btn"
          type="primary"
          :loading="operating"
          :disabled="disabled || operating || !String(draftContent || '').trim()"
          @click="emit('send')"
          round
        >
          <template #icon v-if="!operating">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </template>
          {{ t("message.monotonicSendEdited") }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monotonic-edit-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  transition: box-shadow 0.3s ease;
  background: var(--noobot-panel-bg);
  border-color: var(--noobot-panel-border);
}

.monotonic-edit-card:hover {
  box-shadow: none;
}

.monotonic-edit-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.monotonic-edit-title {
  color: var(--noobot-text-strong);
  font-size: var(--noobot-font-size-xl);
  font-weight: 600;
  line-height: 1.4;
}

.monotonic-edit-subtitle {
  margin-top: 4px;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-md);
  line-height: 1.4;
}

.monotonic-mode-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 4px;
  font-weight: 600;
  padding: 0 10px;
  height: 26px;
  line-height: 26px;
  white-space: nowrap;
  background: transparent;
  border-color: transparent;
}

.monotonic-mode-tag :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: 1;
}

.monotonic-mode-icon,
.monotonic-tip-icon,
.monotonic-add-attachment-btn svg,
.monotonic-footer-btn svg {
  display: block;
  flex-shrink: 0;
}

.monotonic-edit-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monotonic-edit-textarea :deep(.el-textarea__inner) {
  padding: 14px 16px;
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-text-main);
  background: var(--noobot-control-bg);
  border: none;
  font-size: var(--noobot-font-size-base);
  line-height: 1.6;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}

.monotonic-edit-textarea :deep(.el-textarea__inner:hover) {
  background: var(--noobot-surface-soft-hover);
}

.monotonic-edit-textarea :deep(.el-textarea__inner:focus) {
  background: var(--noobot-surface-soft-hover);
}

.monotonic-edit-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monotonic-attachment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.monotonic-attachment-title {
  font-size: var(--noobot-font-size-base);
  font-weight: 600;
  color: var(--noobot-text-main);
}

.monotonic-attachment-stats {
  display: flex;
  gap: 6px;
}

.stat-tag {
  border: none;
  background: transparent;
  font-weight: 500;
}

.monotonic-attachment-empty {
  padding: 16px;
  background: var(--noobot-control-bg);
  border-color: var(--noobot-panel-border);
}

.monotonic-attachment-empty :deep(.el-empty__description p) {
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-md);
}

.monotonic-attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
  padding-right: 8px;
}

.monotonic-attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
  position: relative;
  background: var(--noobot-control-bg);
  border-color: var(--noobot-panel-border);
}

.monotonic-attachment-item:hover {
  box-shadow: none;
  background: var(--noobot-attachment-hover-bg);
  border-color: var(--noobot-attachment-hover-border);
}

.monotonic-attachment-preview,
.monotonic-attachment-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
}

.monotonic-attachment-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--noobot-attachment-icon-text);
  background: transparent;
  font-size: var(--noobot-font-size-xs);
  font-weight: bold;
  border: 1px solid var(--noobot-attachment-icon-border);
}

.monotonic-attachment-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.monotonic-attachment-name {
  font-size: var(--noobot-font-size-md);
  font-weight: 600;
  color: var(--noobot-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.monotonic-attachment-desc {
  display: flex;
  align-items: center;
  font-size: var(--noobot-font-size-sm);
  color: var(--noobot-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind-tag {
  height: 18px;
  padding: 0 6px;
  font-size: var(--noobot-font-size-2xs);
  border: none;
  background: transparent;
}

.dot {
  margin: 0 4px;
  color: var(--noobot-text-muted);
}

.desc-text {
  flex-shrink: 0;
}

.monotonic-attachment-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--noobot-surface-soft);
  color: var(--noobot-text-secondary);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.9);
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}

.monotonic-attachment-item:hover .monotonic-attachment-remove {
  opacity: 1;
  transform: scale(1);
}

.monotonic-attachment-remove:hover {
  background: var(--noobot-status-error);
  color: var(--noobot-text-on-danger);
}

.monotonic-file-input {
  display: none;
}

.monotonic-add-attachment-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border-radius: var(--noobot-radius-sm);
  border: 1px dashed var(--noobot-panel-border);
  background: transparent;
  color: var(--noobot-text-main);
  font-size: var(--noobot-font-size-md);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}

.monotonic-add-attachment-btn:hover:not(:disabled) {
  border-color: var(--noobot-border-primary);
  color: var(--noobot-text-accent);
  background: var(--noobot-attachment-icon-bg);
}

.monotonic-add-attachment-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  border-color: var(--noobot-panel-border);
}

.monotonic-edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  border-top: 1px solid var(--noobot-panel-border);
}

.monotonic-edit-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-md);
}

.monotonic-edit-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.monotonic-footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px;
  font-weight: 500;
}

.monotonic-footer-btn :deep(.el-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1;
}

@media (max-width: 640px) {
  .monotonic-edit-card {
    padding: 12px;
  }

  .monotonic-edit-heading {
    flex-direction: column;
    gap: 10px;
  }

  .monotonic-edit-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .monotonic-edit-buttons {
    justify-content: flex-end;
  }

  .monotonic-attachment-list {
    grid-template-columns: 1fr;
  }

  .monotonic-attachment-remove {
    opacity: 1;
    transform: scale(1);
    background: var(--noobot-surface-soft-hover);
  }
}
</style>
