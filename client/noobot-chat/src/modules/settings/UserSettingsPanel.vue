<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { MoreFilled, Plus, Refresh } from "@element-plus/icons-vue";
import {
  getRegularUsersApi,
  getTemplateFileApi,
  getTemplateTreeApi,
  putRegularUsersApi,
  putTemplateFileApi,
} from "../../services/api/chatApi";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  apiKey: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
});

const loading = ref(false);
const saving = ref(false);
const activeTab = ref("users");
const users = ref([]);
const usersJsonDraft = ref("");
const jsonParseError = ref("");
const templateTree = ref([]);
const templateLoadingTree = ref(false);
const templateLoadingFile = ref(false);
const templateSaving = ref(false);
const templateActivePath = ref("");
const templateContent = ref("");
const templateIsTextFile = ref(true);
const { t } = useLocale();

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

function normalizeUsers(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      userId: String(item?.userId || "").trim(),
      connectCode: String(item?.connectCode || "").trim(),
    }))
    .filter((item) => item.userId || item.connectCode);
}

function generateUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholderChar) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const uuidNibble = placeholderChar === "x" ? randomNibble : (randomNibble & 0x3) | 0x8;
    return uuidNibble.toString(16);
  });
}

function buildUsersJsonText(list = users.value) {
  return `${JSON.stringify({ users: normalizeUsers(list) }, null, 2)}\n`;
}

function parseUsersFromJsonText(text = "") {
  let parsed = {};
  try {
    parsed = JSON.parse(String(text || "{}"));
  } catch (error) {
    throw new Error(`JSON parse error: ${error.message || String(error)}`);
  }
  const candidateList = Array.isArray(parsed) ? parsed : parsed?.users;
  return normalizeUsers(candidateList || []);
}

function syncUsersFromJsonDraft() {
  try {
    users.value = parseUsersFromJsonText(usersJsonDraft.value);
    jsonParseError.value = "";
    return true;
  } catch (error) {
    jsonParseError.value = error.message || t("settings.fixJsonError");
    return false;
  }
}

const usersJsonText = computed({
  get() {
    if (jsonParseError.value) return usersJsonDraft.value;
    return buildUsersJsonText(users.value);
  },
  set(value) {
    usersJsonDraft.value = String(value || "");
    syncUsersFromJsonDraft();
  },
});

async function loadUsers() {
  if (!props.connected || !props.apiKey) return;
  loading.value = true;
  try {
    const res = await getRegularUsersApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("settings.loadUsersFailed"));
    users.value = normalizeUsers(data.users || []);
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
  } catch (error) {
    ElMessage.error(error.message || t("settings.loadUsersFailed"));
  } finally {
    loading.value = false;
  }
}

async function loadTemplateTree() {
  if (!props.connected || !props.apiKey) return;
  templateLoadingTree.value = true;
  try {
    const res = await getTemplateTreeApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("settings.loadTemplateDirFailed"));
    templateTree.value = data.tree || [];
  } catch (error) {
    ElMessage.error(error.message || t("settings.loadTemplateDirFailed"));
  } finally {
    templateLoadingTree.value = false;
  }
}

async function openTemplateFile(node) {
  if (!props.connected || !props.apiKey || !node || node.type !== "file") return;
  templateLoadingFile.value = true;
  try {
    const res = await getTemplateFileApi(
      { path: node.path },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("settings.readTemplateFileFailed"));
    templateActivePath.value = data.path || node.path;
    templateIsTextFile.value = data.isText !== false;
    templateContent.value = data.content || "";
  } catch (error) {
    ElMessage.error(error.message || t("settings.readTemplateFileFailed"));
  } finally {
    templateLoadingFile.value = false;
  }
}

async function saveTemplateFile() {
  if (!props.connected || !props.apiKey || !templateActivePath.value) return;
  if (!templateIsTextFile.value) return;
  templateSaving.value = true;
  try {
    const res = await putTemplateFileApi(
      { path: templateActivePath.value, content: templateContent.value },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("settings.saveTemplateFileFailed"));
    ElMessage.success(t("settings.templateFileSaved"));
    await loadTemplateTree();
  } catch (error) {
    ElMessage.error(error.message || t("settings.saveTemplateFileFailed"));
  } finally {
    templateSaving.value = false;
  }
}

function handleUsersEditorAction(command = "") {
  if (command === "generate-empty") {
    generateConnectCodesForEmptyOnly();
    return;
  }
  if (command === "regenerate-all") {
    forceRegenerateAllConnectCodes();
    return;
  }
  if (command === "save") {
    saveUsers();
  }
}

function handleTemplateEditorAction(command = "") {
  if (command === "save") {
    saveTemplateFile();
  }
}

function addUserRow() {
  users.value.push({ userId: "", connectCode: "" });
}

function removeUserRow(index) {
  users.value.splice(index, 1);
}

function regenerateSingleUserConnectCode(index) {
  if (!Number.isInteger(index) || index < 0 || index >= users.value.length) return;
  users.value[index].connectCode = generateUuid();
  ElMessage.success(t("settings.regeneratedSingleCode"));
}

function generateConnectCodesForEmptyOnly() {
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error(t("settings.fixJsonError"));
    }
    const targetUsers = normalizeUsers(users.value);
    if (!targetUsers.length) {
      throw new Error(t("settings.atLeastOneUser"));
    }
    users.value = targetUsers.map((item) => {
      const currentCode = String(item.connectCode || "").trim();
      return {
        userId: String(item.userId || "").trim(),
        connectCode: currentCode || generateUuid(),
      };
    });
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
    ElMessage.success(t("settings.generatedForEmptyDone"));
  } catch (error) {
    ElMessage.error(error.message || t("settings.generateCodeFailed"));
  }
}

function forceRegenerateAllConnectCodes() {
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error(t("settings.fixJsonError"));
    }
    const targetUsers = normalizeUsers(users.value);
    if (!targetUsers.length) {
      throw new Error(t("settings.atLeastOneUser"));
    }
    users.value = targetUsers.map((item) => ({
      userId: String(item.userId || "").trim(),
      connectCode: generateUuid(),
    }));
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
    ElMessage.success(t("settings.forceRegenerateDone"));
  } catch (error) {
    ElMessage.error(error.message || t("settings.forceRegenerateFailed"));
  }
}

function validateUsers(list = []) {
  const normalized = normalizeUsers(list);
  if (!normalized.length) {
    throw new Error(t("settings.keepAtLeastOneUser"));
  }
  if (normalized.some((item) => !item.userId || !item.connectCode)) {
    throw new Error(t("settings.userAndCodeRequired"));
  }
  const duplicate = normalized.find(
    (item, idx) =>
      normalized.findIndex((subItem) => subItem.userId === item.userId) !== idx,
  );
  if (duplicate) {
    throw new Error(t("settings.duplicateUserId", { userId: duplicate.userId }));
  }
  return normalized;
}

async function saveUsers() {
  if (!props.connected || !props.apiKey) return;
  saving.value = true;
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error(t("settings.fixJsonError"));
    }
    const payloadUsers = validateUsers(users.value);
    const res = await putRegularUsersApi(
      { users: payloadUsers },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || t("settings.saveUsersFailed"));
    users.value = normalizeUsers(data.users || payloadUsers);
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
    ElMessage.success(t("settings.usersSaved"));
  } catch (error) {
    ElMessage.error(error.message || t("settings.saveUsersFailed"));
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.active,
  (visible) => {
    if (!visible) return;
    if (activeTab.value === "users") loadUsers();
    if (activeTab.value === "template") loadTemplateTree();
  },
  { immediate: true },
);

watch(
  () => props.apiKey,
  () => {
    if (!props.active || !props.connected) return;
    if (activeTab.value === "users") loadUsers();
    if (activeTab.value === "template") loadTemplateTree();
  },
);

watch(
  () => props.connected,
  (isConnected) => {
    if (!isConnected || !props.active) return;
    if (activeTab.value === "users") loadUsers();
    if (activeTab.value === "template") loadTemplateTree();
  },
);

watch(activeTab, (tabName) => {
  if (!props.active || !props.connected) return;
  if (tabName === "users") loadUsers();
  if (tabName === "template") loadTemplateTree();
});

watch(
  () => users.value,
  () => {
    if (!jsonParseError.value) {
      usersJsonDraft.value = buildUsersJsonText(users.value);
    }
  },
  { deep: true },
);
</script>

<template>
  <el-tabs v-model="activeTab" class="settings-tabs">
    <el-tab-pane :label="t('settings.userSettings')" name="users">
      <div class="workspace-layout noobot-workspace-layout" v-loading="loading" element-loading-background="var(--noobot-mask-bg)">
        <div class="workspace-panel noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <span class="panel-title noobot-workspace-title">{{ t("settings.users") }}</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addUserRow" :title="t('settings.addUser')">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div
                  v-for="(item, idx) in users"
                  :key="idx"
                  class="user-row noobot-flat-card noobot-list-row"
                >
                  <div class="row-header">
                    <span class="user-idx">User {{ idx + 1 }}</span>
                    <el-button class="icon-btn danger-text" size="small" text @click="removeUserRow(idx)" :title="t('settings.delete')">✕</el-button>
                  </div>
                  <el-input v-model="item.userId" placeholder="userId" clearable class="row-input" />
                  <div class="code-row">
                    <el-input v-model="item.connectCode" placeholder="connectCode" clearable class="row-input" />
                    <el-button class="dark-btn action-btn noobot-action-btn noobot-flat-soft-btn" @click="regenerateSingleUserConnectCode(idx)" :title="t('settings.regenerateConnectCode')">↻</el-button>
                  </div>
                </div>
                <div v-if="!users.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">👥</div>
                  <p>{{ t("settings.noUsersAdd") }}</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>

        <div class="workspace-panel workspace-editor noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <div class="file-info">
              <span class="active-file noobot-flat-chip" title="workspace/user.json">workspace/user.json</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button size="small" class="dark-btn noobot-action-btn noobot-flat-soft-btn" @click="generateConnectCodesForEmptyOnly">{{ t("settings.generateForEmpty") }}</el-button>
                <el-button size="small" class="dark-btn noobot-action-btn noobot-flat-soft-btn" @click="forceRegenerateAllConnectCodes">{{ t("settings.forceRegenerateAll") }}</el-button>
                <el-button type="primary" class="primary-btn noobot-action-btn" size="small" @click="saveUsers" :loading="saving">{{ t("settings.save") }}</el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleUsersEditorAction">
                <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="generate-empty">{{ t("settings.generateForEmpty") }}</el-dropdown-item>
                    <el-dropdown-item command="regenerate-all">{{ t("settings.forceRegenerateAll") }}</el-dropdown-item>
                    <el-dropdown-item command="save">{{ t("settings.save") }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body noobot-workspace-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="usersJsonText"
              type="textarea"
              resize="none"
              class="editor-input noobot-editor-textarea"
              spellcheck="false"
              placeholder='{"users":[{"userId":"user-001","connectCode":"..."}]}'
            />
          </div>
        </div>
      </div>
    </el-tab-pane>

    <el-tab-pane :label="t('settings.defaultUserSettings')" name="template">
      <div class="workspace-layout noobot-workspace-layout">
        <div class="workspace-panel workspace-tree noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <span class="panel-title noobot-workspace-title">{{ t("settings.defaultUserDir") }}</span>
            <div class="tree-actions">
              <el-button
                class="refresh-btn noobot-action-btn tail-btn noobot-tail-btn"
                size="small"
                :icon="Refresh"
                @click="loadTemplateTree"
                :loading="templateLoadingTree"
                :title="t('settings.refreshDir')"
              />
            </div>
          </div>
          <div class="panel-body noobot-workspace-body">
            <el-scrollbar class="tree-scroll">
              <el-tree
                :data="templateTree"
                node-key="path"
                :props="{ label: 'label', children: 'children' }"
                @node-click="openTemplateFile"
                highlight-current
                class="custom-tree"
              >
                <template #default="{ data }">
                  <span class="tree-node">
                    <span class="node-icon">{{ data.type === "dir" ? "📁" : "📄" }}</span>
                    <span class="node-label">{{ data.label }}</span>
                  </span>
                </template>
              </el-tree>
            </el-scrollbar>
          </div>
        </div>
        <div class="workspace-panel workspace-editor noobot-flat-card noobot-workspace-panel">
          <div class="panel-head noobot-workspace-head">
            <div class="file-info">
              <span class="active-file noobot-flat-chip" :title="templateActivePath">{{ templateActivePath || t("settings.noFileSelected") }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button
                  type="primary"
                  class="primary-btn noobot-action-btn"
                  size="small"
                  @click="saveTemplateFile"
                  :disabled="!templateActivePath || !templateIsTextFile"
                  :loading="templateSaving"
                >
                  {{ t("settings.save") }}
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleTemplateEditorAction">
                <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">{{ t("settings.save") }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div
            class="panel-body noobot-workspace-body editor-body"
            v-loading="templateLoadingFile"
            element-loading-background="var(--noobot-mask-bg)"
          >
            <template v-if="templateActivePath">
              <el-input
                v-if="templateIsTextFile"
                v-model="templateContent"
                type="textarea"
                resize="none"
                class="editor-input noobot-editor-textarea"
                :placeholder="t('settings.startEdit')"
              />
              <div v-else class="empty-tip">
                <div class="empty-icon">📦</div>
                <p>{{ t("settings.binaryNoEdit") }}</p>
              </div>
            </template>
            <div v-else class="empty-tip">
              <div class="empty-icon">👈</div>
              <p>{{ t("settings.chooseFileLeftTree") }}</p>
            </div>
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

/* 用户列表特有样式 */
.code-row {
  display: flex;
  gap: 8px;
}

.code-row .row-input {
  flex: 1;
}

.action-btn {
  padding: 8px 12px;
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
