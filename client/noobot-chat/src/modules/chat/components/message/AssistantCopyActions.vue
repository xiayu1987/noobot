<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ArrowDown, CopyDocument, Memo } from "@element-plus/icons-vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  translate: { type: Function, default: (key = "") => key },
  onCopyRich: { type: Function, default: null },
  onCopyText: { type: Function, default: null },
  contentExpanded: { type: Boolean, default: true },
  onToggleContent: { type: Function, default: null },
});

function handleCopyRich() {
  if (typeof props.onCopyRich === "function") props.onCopyRich();
}

function handleCopyText() {
  if (typeof props.onCopyText === "function") props.onCopyText();
}

function handleToggleContent() {
  if (typeof props.onToggleContent === "function") props.onToggleContent();
}

function handleRowKeydown(event) {
  if (event.target !== event.currentTarget) return;
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  handleToggleContent();
}
</script>

<template>
  <div
    v-if="visible"
    class="assistant-copy-actions"
    role="button"
    tabindex="0"
    :aria-expanded="contentExpanded"
    :aria-label="translate(contentExpanded ? 'message.collapse' : 'message.expand')"
    @click="handleToggleContent"
    @keydown="handleRowKeydown"
  >
    <span
      class="assistant-copy-actions__toggle"
      :class="{ 'is-expanded': contentExpanded }"
      aria-hidden="true"
    >
      <el-icon><ArrowDown /></el-icon>
    </span>
    <span class="assistant-copy-actions__spacer" />
    <el-tooltip
      :content="translate('message.copyFormat')"
      placement="top"
      :show-after="300"
    >
      <el-button
        size="small"
        class="noobot-flat-inline-icon-btn"
        :aria-label="translate('message.copyFormat')"
        @click.stop="handleCopyRich"
      >
        <el-icon><CopyDocument /></el-icon>
      </el-button>
    </el-tooltip>
    <el-tooltip
      :content="translate('message.copyText')"
      placement="top"
      :show-after="300"
    >
      <el-button
        size="small"
        class="noobot-flat-inline-icon-btn"
        :aria-label="translate('message.copyText')"
        @click.stop="handleCopyText"
      >
        <el-icon><Memo /></el-icon>
      </el-button>
    </el-tooltip>
  </div>
</template>

<style scoped>
.assistant-copy-actions {
  box-sizing: border-box;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--noobot-space-xs);
  width: 100%;
  margin-bottom: 16px;
  padding: 0 0 12px var(--noobot-space-xs);
  border-bottom: 1px solid var(--noobot-divider);
  cursor: pointer;
}

.assistant-copy-actions__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-msg-disclosure-icon-size);
  transform: rotate(-90deg);
  transition: transform 0.18s ease;
}

.assistant-copy-actions__toggle.is-expanded {
  transform: rotate(0deg);
}

.assistant-copy-actions__spacer {
  flex: 1 1 auto;
}
</style>
