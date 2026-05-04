<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { MoreFilled, Plus } from "@element-plus/icons-vue";
import { getConfigParamsApi, putConfigParamsApi } from "../../services/api/chatApi";
import { useLocale } from "../../shared/i18n/useLocale";

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
const paramsJsonDraft = ref("");
const jsonParseError = ref("");
const { translate } = useLocale();
const activeScopeLabel = computed(() =>
  activeScope.value === "system" ? translate("settings.systemParams") : translate("settings.userParams"),
);
const activeScopeFilePath = computed(() =>
  activeScope.value === "system"
    ? "workspace/config-params.json"
    : `workspace/${String(props.userId || "").trim() || "<user>"}/config-params.json`,
);

function authHeaders(extra = {}) {
  return {
    ...extra,
    ...(props.apiKey ? { "x-api-key": props.apiKey } : {}),
  };
}

function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
}

function normalizeParams(input = []) {
  const source = Array.isArray(input) ? input : [];
  const map = new Map();
  for (const item of source) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    const value = String(item?.value ?? "").trim();
    map.set(key, value);
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function paramsListFromApi({ keys = [], values = {} } = {}) {
  const uniqueKeys = new Set(
    (Array.isArray(keys) ? keys : []).map((item) => String(item || "").trim()).filter(Boolean),
  );
  for (const key of Object.keys(values || {})) uniqueKeys.add(String(key || "").trim());
  return normalizeParams(
    Array.from(uniqueKeys).map((key) => ({
      key,
      value: String(values?.[key] ?? "").trim(),
    })),
  );
}

function toValuesObject(list = params.value) {
  return Object.fromEntries(
    normalizeParams(list).map((item) => [item.key, item.value]),
  );
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
  return normalizeParams(
    Object.entries(values).map(([key, value]) => ({
      key: String(key || "").trim(),
      value: String(value ?? "").trim(),
    })),
  );
}

function syncParamsFromJsonDraft() {
  try {
    params.value = parseParamsFromJsonText(paramsJsonDraft.value);
    jsonParseError.value = "";
    return true;
  } catch (error) {
    jsonParseError.value = error.message || translate("settings.fixJsonError");
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

function addParamRow() {
  params.value.push({ key: "", value: "" });
}

function removeParamRow(index) {
  params.value.splice(index, 1);
}

async function loadParams(scope = activeScope.value) {
  if (!props.connected || !props.apiKey) return;
  loading.value = true;
  try {
    const res = await getConfigParamsApi({ scope, fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.loadParamsFailed"));
    params.value = paramsListFromApi({
      keys: data.keys || [],
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
    params.value = paramsListFromApi({
      keys: data.keys || [],
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
    <el-tab-pane :label="translate('settings.userParams')" name="user">
      <div class="workspace-layout noobot-workspace-layout" v-loading="loading" element-loading-background="var(--noobot-mask-bg)">
        <div class="workspace-panel noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <span class="panel-title noobot-workspace-title">{{ translate("settings.paramsList", { label: activeScopeLabel }) }}</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addParamRow" :title="translate('settings.addParam')">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div
                  v-for="(item, idx) in params"
                  :key="idx"
                  class="user-row noobot-flat-card noobot-list-row"
                >
                  <div class="row-header">
                    <span class="user-idx">Param {{ idx + 1 }}</span>
                    <el-button
                      class="icon-btn danger-text"
                      size="small"
                      text
                      @click="removeParamRow(idx)"
                    >✕</el-button>
                  </div>
                  <el-input v-model="item.key" :placeholder="translate('settings.paramKey')" clearable class="row-input" />
                  <el-input v-model="item.value" :placeholder="translate('settings.paramValue')" clearable class="row-input" />
                </div>
                <div v-if="!params.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">🔐</div>
                  <p>{{ translate("settings.noParamsAdd") }}</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>

        <div class="workspace-panel workspace-editor noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <div class="file-info">
              <span class="active-file noobot-flat-chip" :title="activeScopeFilePath">{{ activeScopeFilePath }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button type="primary" class="primary-btn noobot-action-btn" size="small" @click="saveParams" :loading="saving">
                  {{ translate("settings.save") }}
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
                <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">{{ translate("settings.save") }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="paramsJsonText"
              type="textarea"
              resize="none"
              class="editor-input noobot-editor-textarea"
              spellcheck="false"
              placeholder='{"values":{"DASHSCOPE_API_KEY":"..."}}'
            />
          </div>
        </div>
      </div>
    </el-tab-pane>
    <el-tab-pane v-if="isSuperAdmin" :label="translate('settings.systemParams')" name="system">
      <div class="workspace-layout noobot-workspace-layout" v-loading="loading" element-loading-background="var(--noobot-mask-bg)">
        <div class="workspace-panel noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <span class="panel-title noobot-workspace-title">{{ translate("settings.paramsList", { label: activeScopeLabel }) }}</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addParamRow" :title="translate('settings.addParam')">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div
                  v-for="(item, idx) in params"
                  :key="idx"
                  class="user-row noobot-flat-card noobot-list-row"
                >
                  <div class="row-header">
                    <span class="user-idx">Param {{ idx + 1 }}</span>
                    <el-button class="icon-btn danger-text" size="small" text @click="removeParamRow(idx)">✕</el-button>
                  </div>
                  <el-input v-model="item.key" :placeholder="translate('settings.paramKey')" clearable class="row-input" />
                  <el-input v-model="item.value" :placeholder="translate('settings.paramValue')" clearable class="row-input" />
                </div>
                <div v-if="!params.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">🔐</div>
                  <p>{{ translate("settings.noParamsAdd") }}</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>
        <div class="workspace-panel workspace-editor noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <div class="file-info">
              <span class="active-file noobot-flat-chip" :title="activeScopeFilePath">{{ activeScopeFilePath }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button type="primary" class="primary-btn noobot-action-btn" size="small" @click="saveParams" :loading="saving">
                  {{ translate("settings.save") }}
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
                <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">{{ translate("settings.save") }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="paramsJsonText"
              type="textarea"
              resize="none"
              class="editor-input noobot-editor-textarea"
              spellcheck="false"
              placeholder='{"values":{"DASHSCOPE_API_KEY":"..."}}'
            />
          </div>
        </div>
      </div>
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
/* Tabs 样式适配 */
.settings-tabs {
  height: calc(100vh - 80px);
}

.settings-tabs :deep(.el-tabs__content) {
  height: calc(100% - 44px);
}

.settings-tabs :deep(.el-tab-pane) {
  height: 100%;
}

/* 面板通用样式 */
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

.json-error {
  background: var(--noobot-danger-soft);
  color: var(--noobot-status-error);
  font-size: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--noobot-status-error) 40%, transparent);
}

.list-empty-tip {
  position: static;
  padding: 40px 0;
}

/* 响应式适配 */
@media (max-width: 768px) {
}
</style>
