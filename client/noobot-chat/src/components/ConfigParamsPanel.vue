<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { MoreFilled, Plus } from "@element-plus/icons-vue";
import { getConfigParamsApi, putConfigParamsApi } from "../api/chatApi";

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
const activeScopeLabel = computed(() =>
  activeScope.value === "system" ? "系统参数" : "用户参数",
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
    throw new Error(`JSON 格式错误: ${error.message || String(error)}`);
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
    jsonParseError.value = error.message || "JSON 格式错误";
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
    if (!res.ok || !data.ok) throw new Error(data.error || "加载参数失败");
    params.value = paramsListFromApi({
      keys: data.keys || [],
      values: data.values || {},
    });
    paramsJsonDraft.value = buildParamsJsonText(params.value);
    jsonParseError.value = "";
  } catch (error) {
    ElMessage.error(error.message || "加载参数失败");
  } finally {
    loading.value = false;
  }
}

async function saveParams() {
  if (!props.connected || !props.apiKey) return;
  if (activeScope.value === "system" && !props.isSuperAdmin) {
    ElMessage.warning("普通用户不能保存系统参数");
    return;
  }
  saving.value = true;
  try {
    if (!syncParamsFromJsonDraft()) {
      throw new Error("请先修正右侧 JSON 格式错误");
    }
    const values = toValuesObject(params.value);
    const res = await putConfigParamsApi(
      { scope: activeScope.value, values },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "保存参数失败");
    params.value = paramsListFromApi({
      keys: data.keys || [],
      values: data.values || values,
    });
    paramsJsonDraft.value = buildParamsJsonText(params.value);
    jsonParseError.value = "";
    ElMessage.success("参数配置已保存");
  } catch (error) {
    ElMessage.error(error.message || "保存参数失败");
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
    <el-tab-pane label="用户参数" name="user">
      <div class="workspace-layout" v-loading="loading" element-loading-background="rgba(11, 13, 18, 0.8)">
        <div class="workspace-panel">
          <div class="panel-head">
            <span class="panel-title">{{ activeScopeLabel }}列表</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addParamRow" title="新增参数">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div v-for="(item, idx) in params" :key="idx" class="user-row">
                  <div class="row-header">
                    <span class="user-idx">Param {{ idx + 1 }}</span>
                    <el-button class="icon-btn danger-text" size="small" text @click="removeParamRow(idx)">✕</el-button>
                  </div>
                  <el-input v-model="item.key" placeholder="参数名（如 DASHSCOPE_API_KEY）" clearable class="row-input" />
                  <el-input v-model="item.value" placeholder="参数值" clearable class="row-input" />
                </div>
                <div v-if="!params.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">🔐</div>
                  <p>暂无参数，请点击右上角新增</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>

        <div class="workspace-panel workspace-editor">
          <div class="panel-head">
            <div class="file-info">
              <span class="active-file" :title="activeScopeFilePath">{{ activeScopeFilePath }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button type="primary" class="primary-btn" size="small" @click="saveParams" :loading="saving">
                  保存
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
                <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">保存</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="paramsJsonText"
              type="textarea"
              resize="none"
              class="editor-input"
              spellcheck="false"
              placeholder='{"values":{"DASHSCOPE_API_KEY":"..."}}'
            />
          </div>
        </div>
      </div>
    </el-tab-pane>
    <el-tab-pane v-if="isSuperAdmin" label="系统参数" name="system">
      <div class="workspace-layout" v-loading="loading" element-loading-background="rgba(11, 13, 18, 0.8)">
        <div class="workspace-panel">
          <div class="panel-head">
            <span class="panel-title">{{ activeScopeLabel }}列表</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addParamRow" title="新增参数">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div v-for="(item, idx) in params" :key="idx" class="user-row">
                  <div class="row-header">
                    <span class="user-idx">Param {{ idx + 1 }}</span>
                    <el-button class="icon-btn danger-text" size="small" text @click="removeParamRow(idx)">✕</el-button>
                  </div>
                  <el-input v-model="item.key" placeholder="参数名（如 DASHSCOPE_API_KEY）" clearable class="row-input" />
                  <el-input v-model="item.value" placeholder="参数值" clearable class="row-input" />
                </div>
                <div v-if="!params.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">🔐</div>
                  <p>暂无参数，请点击右上角新增</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>
        <div class="workspace-panel workspace-editor">
          <div class="panel-head">
            <div class="file-info">
              <span class="active-file" :title="activeScopeFilePath">{{ activeScopeFilePath }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button type="primary" class="primary-btn" size="small" @click="saveParams" :loading="saving">
                  保存
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
                <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">保存</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="paramsJsonText"
              type="textarea"
              resize="none"
              class="editor-input"
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

/* 整体布局 */
.workspace-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  height: 100%;
  padding: 0 4px 16px 4px;
  box-sizing: border-box;
}

/* 面板通用样式 */
.workspace-panel {
  display: flex;
  flex-direction: column;
  background: #0a0c11;
  border: 1px solid #1f2430;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.panel-head {
  height: 48px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  background: #10141d;
  border-bottom: 1px solid #1f2430;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #d7ddf2;
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0b0d12;
}

/* 左侧按钮组 */
.tree-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

/* 按钮样式适配主界面 */
.icon-btn {
  color: #8a94af;
  font-size: 16px;
  padding: 4px 8px;
}

.icon-btn:hover {
  color: #dce2f5;
  background: #1a2030;
}

.icon-btn.danger-text:hover {
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
}

.dark-btn {
  background: #141926;
  border: 1px solid #2a3040;
  color: #d7ddf2;
}

.dark-btn:hover:not(:disabled) {
  background: #1a2030;
  border-color: #334162;
  color: #fff;
}

.primary-btn {
  background: #2563eb;
  border: none;
}

.primary-btn:hover:not(:disabled) {
  background: #3b82f6;
}

.primary-btn:disabled,
.dark-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 左侧列表 */
.tree-scroll {
  height: 100%;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.user-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #141926;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #1f2430;
}

.row-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.user-idx {
  font-size: 12px;
  color: #8a94af;
  font-weight: 600;
}

.row-input :deep(.el-input__wrapper) {
  background: #0b0d12;
  border-color: #1f2430;
  box-shadow: 0 0 0 1px #1f2430 inset;
}

.row-input :deep(.el-input__inner) {
  color: #e6e8ef;
  font-size: 13px;
}

/* 右侧编辑器 */
.file-info {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  margin-right: 16px;
}

.active-file {
  font-size: 13px;
  color: #a5b1ce;
  background: #141926;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #1f2430;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.editor-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.desktop-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.mobile-actions {
  display: none;
}

.tail-btn {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  background: var(--noobot-btn-soft-bg);
  border: 1px solid var(--noobot-btn-soft-border);
  color: var(--noobot-btn-soft-text);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.editor-body {
  position: relative;
}

.editor-input {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-input :deep(.el-textarea__inner) {
  flex: 1;
  background: #0b0d12;
  color: #e6e8ef;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0;
  padding: 16px;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
}

.editor-input :deep(.el-textarea__inner::placeholder) {
  color: #4b5563;
}

.editor-input :deep(.el-textarea__inner:focus) {
  outline: none;
}

.json-error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  font-size: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(239, 68, 68, 0.2);
}

/* 空状态 */
.empty-tip {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  text-align: center;
  line-height: 1.6;
  font-size: 14px;
}

.list-empty-tip {
  position: static;
  padding: 40px 0;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.3;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .workspace-layout {
    grid-template-columns: 1fr;
    grid-template-rows: 40% 60%;
    height: calc(100vh - 60px);
    gap: 12px;
    padding: 0;
  }

  .panel-head {
    padding: 0 12px;
  }

  .active-file {
    max-width: 180px;
  }

  .desktop-actions {
    display: none;
  }

  .mobile-actions {
    display: inline-flex;
  }
}
</style>
