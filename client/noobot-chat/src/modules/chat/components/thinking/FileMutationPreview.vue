<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { DocumentAdd, Download, EditPen } from "@element-plus/icons-vue";
import { BaseFileCardList } from "../../../../shared/public-api/ui.js";

const props = defineProps({
  userId: { type: String, default: "" },
  sessionId: { type: String, default: "" },
  mutations: { type: Array, default: () => [] },
  fetcher: { type: Function, default: null },
  service: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  previewKind: { type: String, default: "file" },
  translate: { type: Function, default: (key) => key },
});
const emit = defineEmits(["preview", "download"]);
const tabs = Object.freeze({ FILE: "file", DIFF: "diff", METADATA: "metadata" });
const activeTab = ref(tabs.FILE);
const selectedIndex = ref(0);
const fileContent = ref("");
const diff = ref(null);
const error = ref("");
const loading = ref(false);
let requestGeneration = 0;
const selectedMutation = computed(() => props.mutations[selectedIndex.value] || null);
const mutationId = computed(() => String(selectedMutation.value?.id || "").trim());
const mutationIcon = computed(() => (props.previewKind === "diff" ? EditPen : DocumentAdd));
const diffRows = computed(() => (diff.value?.lines || []).map((line) => ({
  old: line.type === "added" ? null : line,
  next: line.type === "removed" ? null : line,
})));
function translateOperation(operation = "") {
  const normalized = String(operation || "").trim().toLowerCase();
  return props.translate(`message.mutationOperationType.${normalized}`);
}
function mutationSummary(mutation = {}) {
  return `${translateOperation(mutation.operation)} · +${mutation.diff?.additions || 0} / -${mutation.diff?.deletions || 0}`;
}

async function loadTab(tab) {
  const mutation = selectedMutation.value;
  if (!mutation) return;
  const generation = ++requestGeneration;
  const requestedMutationId = String(mutation.id || "").trim();
  const requestedSessionId = props.sessionId;
  const requestedSessionScope = mutation.sessionScope;
  loading.value = true;
  error.value = "";
  try {
    if (tab === tabs.DIFF) {
      if (typeof props.service?.getDiff !== "function") {
        throw new Error(props.translate("message.mutationDiffServiceUnavailable"));
      }
      const payload = await props.service.getDiff({ userId: props.userId, sessionId: requestedSessionId, sessionScope: requestedSessionScope, mutationId: requestedMutationId });
      if (generation !== requestGeneration) return;
      diff.value = payload.diff || payload;
    } else if (tab === tabs.FILE) {
      if (typeof props.service?.getFile !== "function") {
        throw new Error(props.translate("message.mutationFileServiceUnavailable"));
      }
      const payload = await props.service.getFile({ userId: props.userId, sessionId: requestedSessionId, sessionScope: requestedSessionScope, mutationId: requestedMutationId });
      if (generation !== requestGeneration) return;
      fileContent.value = String(payload.content || "");
    }
  } catch (loadError) {
    if (generation !== requestGeneration) return;
    error.value = String(loadError?.message || loadError || props.translate("message.mutationLoadFailed"));
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}
function changeTab(tab) {
  activeTab.value = tab;
  if (tab === tabs.DIFF || tab === tabs.FILE) void loadTab(tab);
}
watch([selectedIndex, mutationId], () => {
  if (props.compact) return;
  fileContent.value = "";
  diff.value = null;
  error.value = "";
  void loadTab(activeTab.value);
}, { immediate: true });
async function openCompactPreview(mutation) {
  emit("preview", { mutation, kind: props.previewKind });
}
</script>

<template>
  <section v-if="mutations.length" class="file-mutation-preview" :class="{ 'is-compact': compact }">
    <BaseFileCardList v-if="compact">
      <div
        v-for="mutation in mutations"
        :key="mutation.id"
        class="mutation-file-item base-file-card noobot-flat-card"
        role="button"
        tabindex="0"
        @click="openCompactPreview(mutation)"
        @keydown.enter.prevent="openCompactPreview(mutation)"
        @keydown.space.prevent="openCompactPreview(mutation)"
      >
        <span class="mutation-file-icon file-icon">
          <el-icon><component :is="mutationIcon" /></el-icon>
        </span>
        <span class="file-meta">
          <span class="file-name-row">
            <span class="file-name" :title="mutation.path">{{ mutation.path }}</span>
          </span>
          <div class="file-size">{{ mutationSummary(mutation) }}</div>
        </span>
        <button
          type="button"
          class="attachment-download-btn noobot-flat-icon-btn"
          :title="translate('message.downloadFile', { name: mutation.path || '' })"
          @click.stop="emit('download', mutation)"
        >
          <el-icon><Download /></el-icon>
        </button>
      </div>
    </BaseFileCardList>
    <template v-if="!compact">
    <el-select v-if="mutations.length > 1" v-model="selectedIndex" class="mutation-select" size="small">
      <el-option v-for="(mutation, index) in mutations" :key="mutation.id" :label="mutation.path" :value="index" />
    </el-select>
    <el-tabs :model-value="activeTab" @tab-change="changeTab">
      <el-tab-pane :label="translate('message.mutationPreviewFile')" :name="tabs.FILE">
        <el-skeleton v-if="loading" :rows="5" animated />
        <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
        <pre v-else class="mutation-file-content">{{ fileContent }}</pre>
      </el-tab-pane>
      <el-tab-pane :label="translate('message.mutationPreviewDiff')" :name="tabs.DIFF">
        <el-skeleton v-if="loading" :rows="5" animated />
        <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
        <div v-else-if="diff" class="mutation-diff-split" role="table">
          <div class="mutation-diff-pane"><div class="mutation-diff-heading">{{ translate('message.mutationPreviewBefore') }}</div><div v-for="(row, index) in diffRows" :key="`old-${index}`" class="mutation-diff-line" :class="row.old ? `is-${row.old.type}` : 'is-empty'"><span class="mutation-line-number">{{ row.old?.oldLine || "" }}</span><span class="mutation-line-sign">{{ row.old?.type === "removed" ? "-" : "" }}</span><code>{{ row.old?.text || "" }}</code></div></div>
          <div class="mutation-diff-pane"><div class="mutation-diff-heading">{{ translate('message.mutationPreviewAfter') }}</div><div v-for="(row, index) in diffRows" :key="`new-${index}`" class="mutation-diff-line" :class="row.next ? `is-${row.next.type}` : 'is-empty'"><span class="mutation-line-number">{{ row.next?.newLine || "" }}</span><span class="mutation-line-sign">{{ row.next?.type === "added" ? "+" : "" }}</span><code>{{ row.next?.text || "" }}</code></div></div>
        </div>
        <el-empty v-else :description="translate('message.mutationNoDiff')" :image-size="64" />
      </el-tab-pane>
      <el-tab-pane :label="translate('message.mutationPreviewMetadata')" :name="tabs.METADATA">
        <el-descriptions v-if="selectedMutation" :column="1" border>
          <el-descriptions-item :label="translate('message.mutationId')">{{ selectedMutation.id }}</el-descriptions-item>
          <el-descriptions-item :label="translate('message.mutationPath')">{{ selectedMutation.path }}</el-descriptions-item>
          <el-descriptions-item :label="translate('message.mutationOperation')">{{ translateOperation(selectedMutation.operation) }}</el-descriptions-item>
          <el-descriptions-item :label="translate('message.mutationBeforeHash')">{{ selectedMutation.before?.sha256 || translate('message.mutationMissingFile') }}</el-descriptions-item>
          <el-descriptions-item :label="translate('message.mutationAfterHash')">{{ selectedMutation.after?.sha256 || "" }}</el-descriptions-item>
          <el-descriptions-item :label="translate('message.mutationChangedLines')">{{ selectedMutation.diff?.additions || 0 }} / {{ selectedMutation.diff?.deletions || 0 }}</el-descriptions-item>
        </el-descriptions>
      </el-tab-pane>
    </el-tabs>
    </template>
  </section>
</template>

<style src="../../../../shared/ui/file-card-common.css"></style>
<style src="../../../../shared/ui/file-mutation-preview-common.css"></style>

<style scoped>
.file-mutation-preview { margin-top: 1rem; border-top: 1px solid var(--noobot-border-color); padding-top: .75rem; }
.file-mutation-preview.is-compact { margin-top: 0; border-top: 0; padding-top: 0; }
.mutation-select { width: min(100%, 28rem); margin-bottom: .5rem; }
.mutation-file-item { color: inherit; text-align: left; cursor: pointer; }
.mutation-file-item:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
</style>
