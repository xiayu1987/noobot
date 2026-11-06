<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { DocumentAdd, Download, EditPen } from "@element-plus/icons-vue";
import { BaseFileCardList } from "../../../../shared/public-api/ui.js";
import MutationDiffSplit from "./MutationDiffSplit.vue";
import MutationFileContent from "./MutationFileContent.vue";
import { text, isFunction } from "@noobot/shared/value";
import { locatorDisplayPath } from "@noobot/shared/locator";
import "../../../../shared/ui/file-card-common.css";
import "../../../../shared/ui/file-mutation-preview-common.css";

const props = defineProps({
  userId: { type: String, default: "" },
  sessionId: { type: String, default: "" },
  mutations: { type: Array, default: () => [] },
  service: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  previewKind: { type: String, default: "file" },
  translate: { type: Function, default: (key) => key },
});
const emit = defineEmits(["preview", "download"]);
const tabs = Object.freeze({ FILE: "file", DIFF: "diff", METADATA: "metadata" });
const activeTab = ref(tabs.FILE);
const selectedIndex = ref(0);
const diff = ref(null);
const error = ref("");
const loading = ref(false);
let requestGeneration = 0;
let requestController = null;
function cancelRequest() {
  requestGeneration += 1;
  requestController?.abort();
  requestController = null;
}
onBeforeUnmount(cancelRequest);

const selectedMutation = computed(() => props.mutations[selectedIndex.value] || null);
const mutationId = computed(() => text(selectedMutation.value?.mutationId));
const mutationIcon = computed(() => (props.previewKind === "diff" ? EditPen : DocumentAdd));
function translateOperation(operation = "") {
  const normalized = text(operation).toLowerCase();
  return props.translate(`message.mutationOperationType.${normalized}`);
}

function mutationLineCounts(mutation) {
  if (mutation.additions === null) return props.translate("message.mutationBinaryDiff");
  return `+${mutation.additions} / -${mutation.deletions}`;
}
function mutationSummary(mutation) {
  return `${translateOperation(mutation.operation)} · ${mutationLineCounts(mutation)}`;
}

const tabLoaders = Object.freeze({
  [tabs.DIFF]: {
    method: "getDiff",
    unavailableKey: "message.mutationDiffServiceUnavailable",
    apply(payload) {
      diff.value = payload.diff;
    },
  },
});

async function loadTab(tab) {
  cancelRequest();
  const mutation = selectedMutation.value;
  const generation = requestGeneration;
  const loader = tabLoaders[tab];
  loading.value = Boolean(loader && mutation);
  error.value = "";
  if (!loader || !mutation) return;
  const controller = new AbortController();
  requestController = controller;
  try {
    const fetchPayload = props.service?.[loader.method];
    if (!isFunction(fetchPayload)) throw new Error(props.translate(loader.unavailableKey));
    const payload = await fetchPayload.call(props.service, {
      userId: props.userId,
      sessionId: props.sessionId,
      sessionScope: mutation.sessionScope,
      mutationId: mutation.mutationId,
      signal: controller.signal,
    });
    if (generation !== requestGeneration) return;
    loader.apply(payload);
  } catch (loadError) {
    if (generation !== requestGeneration) return;
    error.value = String(
      loadError?.message || loadError || props.translate("message.mutationLoadFailed"),
    );
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}
function changeTab(tab) {
  activeTab.value = tab;
  void loadTab(tab);
}
watch(
  [selectedIndex, mutationId],
  () => {
    if (props.compact) return;
    diff.value = null;
    error.value = "";
    void loadTab(activeTab.value);
  },
  { immediate: true },
);
async function openCompactPreview(mutation) {
  emit("preview", { mutation, kind: props.previewKind });
}
</script>

<template>
  <section v-if="mutations.length" class="file-mutation-preview" :class="{ 'is-compact': compact }">
    <BaseFileCardList v-if="compact" embedded>
      <div
        v-for="mutation in mutations"
        :key="mutation.mutationId"
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
            <span class="file-name" :title="locatorDisplayPath(mutation.locator)">{{
              mutation.fileName
            }}</span>
          </span>
          <div class="file-size">{{ mutationSummary(mutation) }}</div>
        </span>
        <button
          type="button"
          class="attachment-download-btn noobot-icon-button noobot-flat-icon-btn"
          :title="translate('message.downloadFile', { name: mutation.fileName })"
          :disabled="mutation.snapshot !== 'available'"
          @click.stop="emit('download', mutation)"
        >
          <el-icon><Download /></el-icon>
        </button>
      </div>
    </BaseFileCardList>
    <template v-if="!compact">
      <el-select
        v-if="mutations.length > 1"
        v-model="selectedIndex"
        class="mutation-select"
        size="small"
        popper-class="noobot-select-popper"
      >
        <el-option
          v-for="(mutation, index) in mutations"
          :key="mutation.mutationId"
          :label="locatorDisplayPath(mutation.locator)"
          :value="index"
        />
      </el-select>
      <el-tabs :model-value="activeTab" class="noobot-tabs" @tab-change="changeTab">
        <el-tab-pane :label="translate('message.mutationPreviewFile')" :name="tabs.FILE">
          <MutationFileContent
            v-if="activeTab === tabs.FILE && selectedMutation"
            :mutation="selectedMutation"
            :user-id="userId"
            :session-id="sessionId"
            :service="service"
            :translate="translate"
          />
        </el-tab-pane>
        <el-tab-pane :label="translate('message.mutationPreviewDiff')" :name="tabs.DIFF">
          <el-skeleton v-if="loading" :rows="5" animated />
          <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
          <MutationDiffSplit v-else-if="diff" :diff="diff" :translate="translate" />
          <el-empty
            v-else
            :description="translate('message.mutationBinaryDiff')"
            :image-size="64"
          />
        </el-tab-pane>
        <el-tab-pane :label="translate('message.mutationPreviewMetadata')" :name="tabs.METADATA">
          <el-descriptions v-if="selectedMutation" :column="1" border>
            <el-descriptions-item :label="translate('message.mutationId')">{{
              selectedMutation.mutationId
            }}</el-descriptions-item>
            <el-descriptions-item :label="translate('message.mutationPath')">{{
              locatorDisplayPath(selectedMutation.locator)
            }}</el-descriptions-item>
            <el-descriptions-item :label="translate('message.mutationOperation')">{{
              translateOperation(selectedMutation.operation)
            }}</el-descriptions-item>
            <el-descriptions-item :label="translate('message.mutationBeforeHash')">{{
              selectedMutation.beforeSha256 ?? translate("message.mutationMissingFile")
            }}</el-descriptions-item>
            <el-descriptions-item :label="translate('message.mutationAfterHash')">{{
              selectedMutation.afterSha256 ?? translate("message.mutationSnapshotState.deleted")
            }}</el-descriptions-item>
            <el-descriptions-item :label="translate('message.mutationChangedLines')">{{
              mutationLineCounts(selectedMutation)
            }}</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>
      </el-tabs>
    </template>
  </section>
</template>

<style scoped>
.file-mutation-preview {
  margin-top: var(--noobot-space-xl);
  border-top: 1px solid var(--noobot-panel-border);
  padding-top: var(--noobot-space-sm);
}
.file-mutation-preview.is-compact {
  margin-top: 0;
  border-top: 0;
  padding-top: 0;
}
.file-mutation-preview:not(.is-compact) {
  display: flex;
  flex-direction: column;
  height: min(26rem, 70dvh);
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.file-mutation-preview > .noobot-tabs {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.file-mutation-preview :deep(.el-tabs__header) {
  flex-shrink: 0;
}
.file-mutation-preview :deep(.el-tabs__content) {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.file-mutation-preview :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.mutation-select {
  width: min(100%, 28rem);
  margin-bottom: var(--noobot-space-sm);
}
.mutation-file-item {
  color: inherit;
  text-align: left;
  cursor: pointer;
}
</style>
