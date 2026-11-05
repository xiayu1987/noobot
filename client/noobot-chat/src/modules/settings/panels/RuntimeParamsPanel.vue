<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { RUNTIME_PARAMS_API } from "@noobot/shared/runtime-params";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { SettingsActionGroup, SettingsTreeWorkspace } from "../public-api.js";

const props = defineProps({
  fetcher: { type: Function, required: true },
  active: { type: Boolean, required: true },
  connected: { type: Boolean, required: true },
});
const { translate } = useLocale();
const state = ref(null);
const draft = ref({});
const search = ref("");
const scope = ref("");
const busy = ref(false);

const catalog = computed(() => state.value?.catalog || []);
const changes = computed(() =>
  catalog.value.filter((item) => draft.value[item.key] !== item.savedValue),
);
const navTree = computed(() => {
  const categories = new Map();
  for (const item of catalog.value) {
    if (!categories.has(item.category)) categories.set(item.category, new Map());
    const modules = categories.get(item.category);
    modules.set(item.module, (modules.get(item.module) || 0) + 1);
  }
  return [...categories].map(([category, modules]) => ({
    path: category,
    label: translate(`runtimeParams.categories.${category}`),
    count: [...modules.values()].reduce((sum, count) => sum + count, 0),
    children: [...modules].map(([module, count]) => ({
      path: `${category}.${module}`,
      label: translate(`runtimeParams.modules.${module}`),
      count,
    })),
  }));
});
const scopeLabel = computed(() => {
  if (!scope.value) return translate("runtimeParams.allParameters");
  const [category, module] = scope.value.split(".");
  const categoryLabel = translate(`runtimeParams.categories.${category}`);
  return module
    ? `${categoryLabel} / ${translate(`runtimeParams.modules.${module}`)}`
    : categoryLabel;
});
const rows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return catalog.value.filter(
    (item) =>
      (!scope.value || item.key.startsWith(`${scope.value}.`)) &&
      `${item.key} ${translate(item.nameKey)} ${translate(item.descriptionKey)}`
        .toLowerCase()
        .includes(keyword),
  );
});
const actions = computed(() => [
  { command: "reload", label: translate("runtimeParams.reload"), disabled: busy.value },
  {
    command: "restoreAll",
    label: translate("runtimeParams.restoreAll"),
    disabled: busy.value || !state.value,
  },
  {
    command: "save",
    label: translate("runtimeParams.save", { count: changes.value.length }),
    type: "primary",
    className: "primary-btn",
    loading: busy.value,
    disabled: !changes.value.length || !props.connected,
  },
]);

function overridesFromDraft() {
  return Object.fromEntries(
    catalog.value
      .filter((item) => item.editable && draft.value[item.key] !== item.defaultValue)
      .map((item) => [item.key, draft.value[item.key]]),
  );
}

async function request(method) {
  busy.value = true;
  try {
    const response = await props.fetcher(`/api${RUNTIME_PARAMS_API}`, {
      method,
      ...(method === "PUT"
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              revision: state.value.revision,
              overrides: overridesFromDraft(),
            }),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(
        result.code ? translate(`runtimeParams.errors.${result.code}`) : result.error,
      );
    }
    state.value = result;
    draft.value = Object.fromEntries(result.catalog.map((item) => [item.key, item.savedValue]));
    if (method === "PUT") ElMessage.success(translate("runtimeParams.saved"));
  } catch (cause) {
    ElMessage.error(cause.message);
  } finally {
    busy.value = false;
  }
}

function restore(item) {
  draft.value[item.key] = item.defaultValue;
}

function restoreAll() {
  for (const item of catalog.value) if (item.editable) restore(item);
}

function handleAction(command) {
  if (command === "reload") request("GET");
  else if (command === "restoreAll") restoreAll();
  else if (command === "save") request("PUT");
}

function selectScope(node) {
  scope.value = scope.value === node.path ? "" : node.path;
}

watch(
  () => [props.active, props.connected],
  ([active, connected]) => {
    if (active && connected) request("GET");
  },
  { immediate: true },
);
</script>

<template>
  <SettingsTreeWorkspace
    class="runtime-params-workspace"
    :loading="busy && !state"
    :tree-title="translate('runtimeParams.title')"
    :nodes="navTree"
    label-key="label"
    @node-click="selectScope"
  >
    <template #tree-top>
      <el-input
        v-model="search"
        class="row-input runtime-search"
        :placeholder="translate('runtimeParams.search')"
        clearable
      />
    </template>
    <template #node="{ node }">
      <span class="node-label">{{ node.label }}</span>
      <span class="node-count">{{ node.count }}</span>
    </template>
    <template #editor-left>
      <span class="active-file noobot-flat-chip">{{ scopeLabel }}</span>
      <span
        v-if="state?.restartRequired"
        class="noobot-flat-chip runtime-pending"
        data-test="runtime-pending"
        >{{
          translate("runtimeParams.pending", {
            saved: state.revision,
            active: state.activeRevision,
          })
        }}</span
      >
    </template>
    <template #editor-right>
      <SettingsActionGroup :actions="actions" @command="handleAction" />
    </template>
    <el-scrollbar class="tree-scroll">
      <div class="users-list">
        <p class="runtime-hint">{{ translate("runtimeParams.activation") }}</p>
        <div
          v-if="changes.length"
          class="user-row noobot-flat-card noobot-list-row"
          data-test="runtime-changes"
        >
          <div class="row-header">
            <span class="user-idx">{{ translate("runtimeParams.changes") }}</span>
          </div>
          <div v-for="item in changes" :key="item.key" class="runtime-change">
            <span>{{ translate(item.nameKey) }}</span>
            <code>{{ item.savedValue }} → {{ draft[item.key] }}</code>
          </div>
        </div>
        <div
          v-for="row in rows"
          :key="row.key"
          class="user-row noobot-flat-card noobot-list-row"
          data-test="runtime-param-row"
          :data-key="row.key"
        >
          <div class="row-header">
            <span class="runtime-name">{{ translate(row.nameKey) }}</span>
            <el-button
              v-if="row.editable"
              class="icon-btn noobot-icon-button noobot-flat-inline-icon-btn"
              size="small"
              text
              :disabled="busy || draft[row.key] === row.defaultValue"
              :title="translate('runtimeParams.restore')"
              :aria-label="translate('runtimeParams.restore')"
              @click="restore(row)"
              >↺</el-button
            >
          </div>
          <p class="runtime-description">{{ translate(row.descriptionKey) }}</p>
          <div class="runtime-meta">
            <code class="noobot-flat-chip">{{ row.key }}</code>
            <span class="noobot-flat-chip"
              >{{ translate(`runtimeParams.units.${row.unit}`) }} · {{ row.minimum }}–{{
                row.maximum
              }}</span
            >
            <span v-if="!row.editable" class="noobot-flat-chip">{{
              translate(`runtimeParams.fixed.${row.fixedReason}`)
            }}</span>
          </div>
          <div class="runtime-values">
            <span
              >{{ translate("runtimeParams.default") }}: <code>{{ row.defaultValue }}</code></span
            >
            <span
              >{{ translate("runtimeParams.active") }}: <code>{{ row.activeValue }}</code></span
            >
          </div>
          <el-input-number
            v-if="row.editable"
            v-model="draft[row.key]"
            class="row-input runtime-input"
            :min="row.minimum"
            :max="row.maximum"
            :precision="0"
            :disabled="busy"
            :aria-label="translate(row.nameKey)"
            controls-position="right"
          />
        </div>
        <div v-if="state && !rows.length" class="empty-tip list-empty-tip">
          <div class="empty-icon">🔍</div>
          <p>{{ translate("runtimeParams.noMatch") }}</p>
        </div>
      </div>
    </el-scrollbar>
  </SettingsTreeWorkspace>
</template>

<style scoped>
.runtime-search {
  padding: var(--noobot-space-sm) var(--noobot-space-md) 0;
  box-sizing: border-box;
}
.node-count {
  margin-left: auto;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
}
.runtime-pending {
  color: var(--noobot-status-warning);
  white-space: normal;
  overflow-wrap: anywhere;
}
.runtime-hint,
.runtime-description {
  margin: 0;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
}
.runtime-name {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--noobot-text-main);
  font-weight: var(--noobot-font-weight-bold);
}
.runtime-meta,
.runtime-values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-text-secondary);
}
.runtime-meta > .noobot-flat-chip {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.runtime-params-workspace :deep(.file-info) {
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
}
.runtime-change {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--noobot-space-sm);
  font-size: var(--noobot-font-size-sm);
}
.runtime-input {
  width: 100%;
}
</style>
