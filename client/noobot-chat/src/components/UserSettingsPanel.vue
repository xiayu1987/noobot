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
} from "../api/chatApi";

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
    throw new Error(`JSON 格式错误: ${error.message || String(error)}`);
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
    jsonParseError.value = error.message || "JSON 格式错误";
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
    if (!res.ok || !data.ok) throw new Error(data.error || "加载用户失败");
    users.value = normalizeUsers(data.users || []);
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
  } catch (error) {
    ElMessage.error(error.message || "加载用户失败");
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
    if (!res.ok || !data.ok) throw new Error(data.error || "加载默认用户目录失败");
    templateTree.value = data.tree || [];
  } catch (error) {
    ElMessage.error(error.message || "加载默认用户目录失败");
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
    if (!res.ok || !data.ok) throw new Error(data.error || "读取默认用户文件失败");
    templateActivePath.value = data.path || node.path;
    templateIsTextFile.value = data.isText !== false;
    templateContent.value = data.content || "";
  } catch (error) {
    ElMessage.error(error.message || "读取默认用户文件失败");
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
    if (!res.ok || !data.ok) throw new Error(data.error || "保存默认用户文件失败");
    ElMessage.success("默认用户文件已保存");
    await loadTemplateTree();
  } catch (error) {
    ElMessage.error(error.message || "保存默认用户文件失败");
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
  ElMessage.success("已重新生成该用户连接码");
}

function generateConnectCodesForEmptyOnly() {
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error("请先修正右侧 JSON 格式错误");
    }
    const targetUsers = normalizeUsers(users.value);
    if (!targetUsers.length) {
      throw new Error("请先至少添加一个用户");
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
    ElMessage.success("已为连接码为空的用户生成连接码");
  } catch (error) {
    ElMessage.error(error.message || "生成连接码失败");
  }
}

function forceRegenerateAllConnectCodes() {
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error("请先修正右侧 JSON 格式错误");
    }
    const targetUsers = normalizeUsers(users.value);
    if (!targetUsers.length) {
      throw new Error("请先至少添加一个用户");
    }
    users.value = targetUsers.map((item) => ({
      userId: String(item.userId || "").trim(),
      connectCode: generateUuid(),
    }));
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
    ElMessage.success("已强制重新生成所有用户连接码");
  } catch (error) {
    ElMessage.error(error.message || "强制重新生成失败");
  }
}

function validateUsers(list = []) {
  const normalized = normalizeUsers(list);
  if (!normalized.length) {
    throw new Error("至少保留一个用户");
  }
  if (normalized.some((item) => !item.userId || !item.connectCode)) {
    throw new Error("userId 和 connectCode 都不能为空");
  }
  const duplicate = normalized.find(
    (item, idx) =>
      normalized.findIndex((subItem) => subItem.userId === item.userId) !== idx,
  );
  if (duplicate) {
    throw new Error(`存在重复 userId: ${duplicate.userId}`);
  }
  return normalized;
}

async function saveUsers() {
  if (!props.connected || !props.apiKey) return;
  saving.value = true;
  try {
    if (!syncUsersFromJsonDraft()) {
      throw new Error("请先修正右侧 JSON 格式错误");
    }
    const payloadUsers = validateUsers(users.value);
    const res = await putRegularUsersApi(
      { users: payloadUsers },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "保存用户失败");
    users.value = normalizeUsers(data.users || payloadUsers);
    usersJsonDraft.value = buildUsersJsonText(users.value);
    jsonParseError.value = "";
    ElMessage.success("用户配置已保存");
  } catch (error) {
    ElMessage.error(error.message || "保存用户失败");
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
    <el-tab-pane label="用户设置" name="users">
      <div class="workspace-layout" v-loading="loading" element-loading-background="rgba(11, 13, 18, 0.8)">
        <div class="workspace-panel">
          <div class="panel-head">
            <span class="panel-title">用户</span>
            <div class="tree-actions">
              <el-button class="icon-btn" size="small" text @click="addUserRow" title="新增用户">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-body">
            <el-scrollbar class="tree-scroll">
              <div class="users-list">
                <div v-for="(item, idx) in users" :key="idx" class="user-row">
                  <div class="row-header">
                    <span class="user-idx">User {{ idx + 1 }}</span>
                    <el-button class="icon-btn danger-text" size="small" text @click="removeUserRow(idx)" title="删除">✕</el-button>
                  </div>
                  <el-input v-model="item.userId" placeholder="userId" clearable class="row-input" />
                  <div class="code-row">
                    <el-input v-model="item.connectCode" placeholder="connectCode" clearable class="row-input" />
                    <el-button class="dark-btn action-btn" @click="regenerateSingleUserConnectCode(idx)" title="重新生成连接码">↻</el-button>
                  </div>
                </div>
                <div v-if="!users.length" class="empty-tip list-empty-tip">
                  <div class="empty-icon">👥</div>
                  <p>暂无用户，请点击右上角新增</p>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>

        <div class="workspace-panel workspace-editor">
          <div class="panel-head">
            <div class="file-info">
              <span class="active-file" title="workspace/user.json">workspace/user.json</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button size="small" class="dark-btn" @click="generateConnectCodesForEmptyOnly">批量生成(空值)</el-button>
                <el-button size="small" class="dark-btn" @click="forceRegenerateAllConnectCodes">强制重置</el-button>
                <el-button type="primary" class="primary-btn" size="small" @click="saveUsers" :loading="saving">保存</el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleUsersEditorAction">
                <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="generate-empty">批量生成(空值)</el-dropdown-item>
                    <el-dropdown-item command="regenerate-all">强制重置</el-dropdown-item>
                    <el-dropdown-item command="save">保存</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div class="panel-body editor-body">
            <div v-if="jsonParseError" class="json-error">⚠️ {{ jsonParseError }}</div>
            <el-input
              v-model="usersJsonText"
              type="textarea"
              resize="none"
              class="editor-input"
              spellcheck="false"
              placeholder='{"users":[{"userId":"user-001","connectCode":"..."}]}'
            />
          </div>
        </div>
      </div>
    </el-tab-pane>

    <el-tab-pane label="默认用户设置" name="template">
      <div class="workspace-layout">
        <div class="workspace-panel workspace-tree">
          <div class="panel-head">
            <span class="panel-title">default-user 目录</span>
            <div class="tree-actions">
              <el-button
                class="refresh-btn noobot-action-btn tail-btn"
                size="small"
                :icon="Refresh"
                @click="loadTemplateTree"
                :loading="templateLoadingTree"
                title="刷新目录"
              />
            </div>
          </div>
          <div class="panel-body">
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
        <div class="workspace-panel workspace-editor">
          <div class="panel-head">
            <div class="file-info">
              <span class="active-file" :title="templateActivePath">{{ templateActivePath || "未选择文件" }}</span>
            </div>
            <div class="editor-actions">
              <div class="desktop-actions">
                <el-button
                  type="primary"
                  class="primary-btn"
                  size="small"
                  @click="saveTemplateFile"
                  :disabled="!templateActivePath || !templateIsTextFile"
                  :loading="templateSaving"
                >
                  保存
                </el-button>
              </div>
              <el-dropdown class="mobile-actions" trigger="click" @command="handleTemplateEditorAction">
                <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="save">保存</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <div
            class="panel-body editor-body"
            v-loading="templateLoadingFile"
            element-loading-background="rgba(11, 13, 18, 0.8)"
          >
            <template v-if="templateActivePath">
              <el-input
                v-if="templateIsTextFile"
                v-model="templateContent"
                type="textarea"
                resize="none"
                class="editor-input"
                placeholder="开始编辑..."
              />
              <div v-else class="empty-tip">
                <div class="empty-icon">📦</div>
                <p>该文件为二进制文件，暂不支持在线编辑</p>
              </div>
            </template>
            <div v-else class="empty-tip">
              <div class="empty-icon">👈</div>
              <p>请在左侧目录树中选择文件</p>
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

/* 整体布局 */
.workspace-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  height: 100%; /* 在 Tab 内部使用 100% */
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

.tail-btn :deep(.el-icon) {
  margin: 0 !important;
}

.refresh-btn:not(:disabled):hover {
  background: var(--noobot-btn-soft-bg-hover);
  color: #fff;
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

.danger-btn {
  background: #3a1117;
  border: 1px solid #7f1d1d;
  color: #fecaca;
}

.danger-btn:hover:not(:disabled) {
  background: #58151c;
  border-color: #b91c1c;
  color: #fee2e2;
}

/* 左侧目录树 & 列表 */
.tree-scroll {
  height: 100%;
}

.custom-tree {
  background: transparent;
  padding: 8px;
  color: #dce2f5;
  --el-tree-node-hover-bg-color: #161b28;
  --el-tree-text-color: #dce2f5;
  --el-tree-expand-icon-color: #6b7280;
}

.custom-tree :deep(.el-tree-node__content) {
  height: 32px;
  border-radius: 6px;
  margin-bottom: 2px;
}

.custom-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: #1a2337;
  color: #83a7ff;
}

.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.node-icon {
  font-size: 14px;
  opacity: 0.9;
}

.node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 用户列表特有样式 */
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

.code-row {
  display: flex;
  gap: 8px;
}

.code-row .row-input {
  flex: 1;
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

.action-btn {
  padding: 8px 12px;
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
    height: 100%;
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
