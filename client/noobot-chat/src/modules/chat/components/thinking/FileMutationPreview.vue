<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  userId: { type: String, default: "" },
  mutations: { type: Array, default: () => [] },
  fetcher: { type: Function, default: null },
  service: { type: Object, default: null },
});
const tabs = Object.freeze({ FILE: "file", DIFF: "diff", METADATA: "metadata" });
const activeTab = ref(tabs.FILE);
const selectedIndex = ref(0);
const fileContent = ref("");
const diff = ref(null);
const error = ref("");
const loading = ref(false);
const selectedMutation = computed(() => props.mutations[selectedIndex.value] || null);
const mutationId = computed(() => String(selectedMutation.value?.id || "").trim());

async function loadTab(tab) {
  const mutation = selectedMutation.value;
  if (!mutation || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    if (tab === tabs.DIFF) {
      if (typeof props.service?.getDiff !== "function") throw new Error("文件变更预览服务不可用");
      const payload = await props.service.getDiff({ userId: props.userId, mutationId: mutationId.value });
      diff.value = payload.diff || payload;
    } else if (tab === tabs.FILE) {
      if (typeof props.service?.getFile !== "function") throw new Error("文件预览服务不可用");
      const payload = await props.service.getFile({ userId: props.userId, mutationId: mutationId.value });
      fileContent.value = String(payload.content || "");
    }
  } catch (loadError) {
    error.value = String(loadError?.message || loadError || "加载失败");
  } finally {
    loading.value = false;
  }
}
function changeTab(tab) {
  activeTab.value = tab;
  if (tab === tabs.DIFF || tab === tabs.FILE) void loadTab(tab);
}
watch([selectedIndex, mutationId], () => {
  fileContent.value = "";
  diff.value = null;
  error.value = "";
  void loadTab(activeTab.value);
}, { immediate: true });
</script>

<template>
  <section v-if="mutations.length" class="file-mutation-preview">
    <el-select v-if="mutations.length > 1" v-model="selectedIndex" class="mutation-select" size="small">
      <el-option v-for="(mutation, index) in mutations" :key="mutation.id" :label="mutation.path" :value="index" />
    </el-select>
    <el-tabs :model-value="activeTab" @tab-change="changeTab">
      <el-tab-pane label="文件" :name="tabs.FILE">
        <el-skeleton v-if="loading" :rows="5" animated />
        <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
        <pre v-else class="mutation-file-content">{{ fileContent }}</pre>
      </el-tab-pane>
      <el-tab-pane label="变更" :name="tabs.DIFF">
        <el-skeleton v-if="loading" :rows="5" animated />
        <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
        <div v-else-if="diff" class="mutation-diff" role="table">
          <div v-for="(line, index) in diff.lines || []" :key="`${index}-${line.type}`" class="mutation-diff-line" :class="`is-${line.type}`">
            <span class="mutation-line-number">{{ line.oldLine || "" }}</span>
            <span class="mutation-line-number">{{ line.newLine || "" }}</span>
            <span class="mutation-line-sign">{{ line.type === "added" ? "+" : line.type === "removed" ? "-" : " " }}</span>
            <code>{{ line.text }}</code>
          </div>
        </div>
        <el-empty v-else description="暂无变更" :image-size="64" />
      </el-tab-pane>
      <el-tab-pane label="元数据" :name="tabs.METADATA">
        <el-descriptions v-if="selectedMutation" :column="1" border>
          <el-descriptions-item label="mutationId">{{ selectedMutation.id }}</el-descriptions-item>
          <el-descriptions-item label="路径">{{ selectedMutation.path }}</el-descriptions-item>
          <el-descriptions-item label="操作">{{ selectedMutation.operation }}</el-descriptions-item>
          <el-descriptions-item label="更新前 hash">{{ selectedMutation.before?.sha256 || "不存在" }}</el-descriptions-item>
          <el-descriptions-item label="更新后 hash">{{ selectedMutation.after?.sha256 || "" }}</el-descriptions-item>
          <el-descriptions-item label="新增/删除">{{ selectedMutation.diff?.additions || 0 }} / {{ selectedMutation.diff?.deletions || 0 }}</el-descriptions-item>
        </el-descriptions>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.file-mutation-preview { margin-top: 1rem; border-top: 1px solid var(--noobot-border-color); padding-top: .75rem; }
.mutation-select { width: min(100%, 28rem); margin-bottom: .5rem; }
.mutation-file-content, .mutation-diff { overflow: auto; max-height: 26rem; margin: 0; font-family: var(--noobot-font-mono, monospace); }
.mutation-diff-line { display: grid; grid-template-columns: 4rem 4rem 1.5rem minmax(max-content, 1fr); white-space: pre; }
.mutation-line-number { color: var(--noobot-text-muted); text-align: right; padding-right: .5rem; user-select: none; }
.mutation-diff-line code { padding: 0 .5rem; }
.mutation-diff-line.is-added { background: color-mix(in srgb, var(--el-color-success) 16%, transparent); }
.mutation-diff-line.is-removed { background: color-mix(in srgb, var(--el-color-danger) 16%, transparent); }
</style>
