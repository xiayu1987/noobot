<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  getConfigParamsApi,
  putConfigParamsApi,
} from "../../../infrastructure/api/chat/chatApi.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { createApiKeyFetch } from "../../../shared/network/apiKeyFetch.js";
import { SettingsJsonListEditorLayout } from "../public-api.js";
import {
  assertConfigParamListMatchesCatalog,
  configParamsFromCatalog,
  normalizeConfigParamList,
} from "../state/configParamsState.js";

const props = defineProps({
  apiKey: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  userId: { type: String, default: "" },
  isSuperAdmin: { type: Boolean, default: false },
});

const activeScope = ref("user");
const loading = ref(false);
const saving = ref(false);
const params = ref([]);
const catalog = ref([]);
const paramsJsonDraft = ref("");
const jsonParseError = ref("");
const { translate } = useLocale();
const activeScopeLabel = computed(() =>
  activeScope.value === "system"
    ? translate("settings.systemParams")
    : translate("settings.userParams"),
);
const activeScopeFilePath = computed(() =>
  activeScope.value === "system"
    ? "workspace/config-params.json"
    : `workspace/${String(props.userId || "").trim() || "<user>"}/config-params.json`,
);
const visibleScopes = computed(() => [
  { name: "user", label: translate("settings.userParams") },
  ...(props.isSuperAdmin ? [{ name: "system", label: translate("settings.systemParams") }] : []),
]);
const editorActions = computed(() => [
  {
    command: "save",
    label: translate("settings.save"),
    type: "primary",
    className: "primary-btn",
    loading: saving.value,
  },
]);
const { authFetch } = createApiKeyFetch(() => props.apiKey);

function toValuesObject(list = params.value) {
  return Object.fromEntries(normalizeConfigParamList(list).map((item) => [item.key, item.value]));
}

function buildParamsJsonText(list = params.value) {
  return `${JSON.stringify({ values: toValuesObject(list) }, null, 2)}\n`;
}

function parseParamsFromJsonText(text = "") {
  let parsed = {};
  try {
    parsed = JSON.parse(String(text || "{}"));
  } catch (error) {
    throw new Error(`JSON parse error: ${error.message || String(error)}`);
  }
  const values = parsed?.values && typeof parsed.values === "object" ? parsed.values : {};
  return normalizeConfigParamList(
    Object.entries(values).map(([key, value]) => ({
      key: String(key || "").trim(),
      value: String(value ?? "").trim(),
    })),
  );
}

function syncParamsFromJsonDraft() {
  try {
    const parsedParams = parseParamsFromJsonText(paramsJsonDraft.value);
    assertConfigParamListMatchesCatalog(parsedParams, catalog.value);
    params.value = parsedParams;
    jsonParseError.value = "";
    return true;
  } catch (error) {
    jsonParseError.value =
      error?.code === "UNKNOWN_CONFIG_PARAM_KEY"
        ? translate("settings.unknownParamKey", { key: error.key })
        : error.message || translate("settings.fixJsonError");
    return false;
  }
}

const paramsJsonText = computed({
  get() {
    if (jsonParseError.value) return paramsJsonDraft.value;
    return buildParamsJsonText(params.value);
  },
  set(value) {
    paramsJsonDraft.value = String(value || "");
    syncParamsFromJsonDraft();
  },
});

async function loadParams(scope = activeScope.value) {
  if (!props.connected || !props.apiKey) return;
  loading.value = true;
  try {
    const res = await getConfigParamsApi({ scope, fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.loadParamsFailed"));
    catalog.value = Array.isArray(data.catalog) ? data.catalog : [];
    params.value = configParamsFromCatalog({
      catalog: catalog.value,
      values: data.values || {},
    });
    paramsJsonDraft.value = buildParamsJsonText(params.value);
    jsonParseError.value = "";
  } catch (error) {
    ElMessage.error(error.message || translate("settings.loadParamsFailed"));
  } finally {
    loading.value = false;
  }
}

async function saveParams() {
  if (!props.connected || !props.apiKey) return;
  if (activeScope.value === "system" && !props.isSuperAdmin) {
    ElMessage.warning(translate("settings.normalCannotSaveSystem"));
    return;
  }
  saving.value = true;
  try {
    if (!syncParamsFromJsonDraft()) {
      throw new Error(translate("settings.fixJsonError"));
    }
    const values = toValuesObject(params.value);
    const res = await putConfigParamsApi(
      { scope: activeScope.value, values },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.saveParamsFailed"));
    catalog.value = Array.isArray(data.catalog) ? data.catalog : catalog.value;
    params.value = configParamsFromCatalog({
      catalog: catalog.value,
      values: data.values || values,
    });
    paramsJsonDraft.value = buildParamsJsonText(params.value);
    jsonParseError.value = "";
    ElMessage.success(translate("settings.paramsSaved"));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.saveParamsFailed"));
  } finally {
    saving.value = false;
  }
}

function onScopeChanged(scope = "user") {
  activeScope.value = String(scope || "user") === "system" ? "system" : "user";
  loadParams(activeScope.value);
}

function handleEditorAction(command = "") {
  if (command === "save") saveParams();
}

watch(
  () => props.active,
  (visible) => {
    if (visible) loadParams(activeScope.value);
  },
  { immediate: true },
);

watch(
  () => props.apiKey,
  () => {
    if (props.active && props.connected) loadParams(activeScope.value);
  },
);

watch(
  () => props.connected,
  (isConnected) => {
    if (isConnected && props.active) loadParams(activeScope.value);
  },
);

watch(
  () => props.isSuperAdmin,
  (isSuperAdmin) => {
    if (!isSuperAdmin && activeScope.value === "system") {
      onScopeChanged("user");
    }
  },
);

watch(
  () => params.value,
  () => {
    if (!jsonParseError.value) {
      paramsJsonDraft.value = buildParamsJsonText(params.value);
    }
  },
  { deep: true },
);
</script>

<template>
  <el-tabs v-model="activeScope" class="settings-tabs" @tab-change="onScopeChanged">
    <el-tab-pane
      v-for="scopeItem in visibleScopes"
      :key="scopeItem.name"
      :label="scopeItem.label"
      :name="scopeItem.name"
    >
      <SettingsJsonListEditorLayout
        v-model="paramsJsonText"
        :loading="loading"
        :left-title="translate('settings.paramsList', { label: activeScopeLabel })"
        :editor-file-path="activeScopeFilePath"
        :editor-actions="editorActions"
        :parse-error="jsonParseError"
        placeholder='{"values":{"DASHSCOPE_API_KEY":"..."}}'
        @editor-command="handleEditorAction"
      >
        <template #list>
          <div class="users-list">
            <div
              v-for="(item, idx) in params"
              :key="idx"
              class="user-row param-row noobot-flat-card noobot-list-row"
            >
              <div class="row-header">
                <span class="user-idx param-index">Param {{ idx + 1 }}</span>
              </div>
              <el-input
                v-model="item.key"
                readonly
                class="row-input param-key-input"
              />
              <el-input
                v-model="item.value"
                :placeholder="translate('settings.paramValue')"
                clearable
                class="row-input param-value-input"
              />
            </div>
            <div v-if="!params.length" class="empty-tip list-empty-tip">
              <div class="empty-icon">🔐</div>
              <p>{{ translate("settings.noParams") }}</p>
            </div>
          </div>
        </template>
      </SettingsJsonListEditorLayout>
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dark-btn {
  background: var(--noobot-panel-bg);
  border: 1px solid var(--noobot-panel-border);
  color: var(--noobot-text-main);
}

.dark-btn:hover:not(:disabled) {
  background: var(--noobot-panel-muted);
  border-color: color-mix(in srgb, var(--noobot-cyber-cyan) 35%, var(--noobot-panel-border));
  color: var(--noobot-text-strong);
}

.param-row {
  gap: 10px;
}

.param-index {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
}

.param-key-input :deep(.el-input__inner) {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.param-value-input :deep(.el-input__inner) {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
}

.file-info {
  min-width: 0;
}

.active-file {
  border: none;
  background: color-mix(in srgb, var(--noobot-panel-muted) 58%, transparent);
  border-radius: var(--noobot-radius-pill);
}

.list-empty-tip {
  position: static;
  padding: 48px 16px;
}

.list-empty-tip .empty-icon {
  font-size: var(--noobot-font-size-lg);
  margin-bottom: 10px;
  opacity: 0.42;
}

.list-empty-tip p {
  margin: 0;
  color: var(--noobot-text-muted);
}
</style>
