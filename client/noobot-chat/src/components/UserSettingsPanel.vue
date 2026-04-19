<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { getRegularUsersApi, putRegularUsersApi } from "../api/chatApi";

const props = defineProps({
  apiKey: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
});

const loading = ref(false);
const saving = ref(false);
const users = ref([]);
const usersJsonText = ref("");
const jsonParseError = ref("");
const syncingFromUsers = ref(false);
const syncingFromJson = ref(false);

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
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function syncJsonFromUsers() {
  syncingFromUsers.value = true;
  usersJsonText.value = `${JSON.stringify({ users: users.value || [] }, null, 2)}\n`;
  jsonParseError.value = "";
  queueMicrotask(() => {
    syncingFromUsers.value = false;
  });
}

function parseUsersFromJsonText() {
  let parsed = {};
  try {
    parsed = JSON.parse(String(usersJsonText.value || "{}"));
  } catch (error) {
    throw new Error(`JSON 格式错误: ${error.message || String(error)}`);
  }
  const candidateList = Array.isArray(parsed) ? parsed : parsed?.users;
  return normalizeUsers(candidateList || []);
}

function trySyncUsersFromJsonText() {
  if (syncingFromUsers.value) return true;
  try {
    const parsedUsers = parseUsersFromJsonText();
    syncingFromJson.value = true;
    users.value = parsedUsers;
    jsonParseError.value = "";
    queueMicrotask(() => {
      syncingFromJson.value = false;
    });
    return true;
  } catch (error) {
    jsonParseError.value = error.message || "JSON 格式错误";
    return false;
  }
}

async function loadUsers() {
  if (!props.connected || !props.apiKey) return;
  loading.value = true;
  try {
    const res = await getRegularUsersApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载用户失败");
    users.value = normalizeUsers(data.users || []);
    syncJsonFromUsers();
  } catch (error) {
    ElMessage.error(error.message || "加载用户失败");
  } finally {
    loading.value = false;
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
    if (!trySyncUsersFromJsonText()) {
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
    ElMessage.success("已为连接码为空的用户生成连接码");
  } catch (error) {
    ElMessage.error(error.message || "生成连接码失败");
  }
}

function forceRegenerateAllConnectCodes() {
  try {
    if (!trySyncUsersFromJsonText()) {
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
    if (!trySyncUsersFromJsonText()) {
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
    syncJsonFromUsers();
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
    if (visible) loadUsers();
  },
  { immediate: true },
);

watch(
  () => props.apiKey,
  () => {
    if (props.active && props.connected) loadUsers();
  },
);

watch(
  () => props.connected,
  (isConnected) => {
    if (isConnected && props.active) loadUsers();
  },
);

watch(
  () => users.value,
  () => {
    if (!syncingFromJson.value) syncJsonFromUsers();
  },
  { deep: true },
);

watch(
  () => usersJsonText.value,
  () => {
    if (!syncingFromUsers.value) trySyncUsersFromJsonText();
  },
);
</script>

<template>
  <div class="workspace-layout" v-loading="loading" element-loading-background="rgba(11, 13, 18, 0.8)">
    <!-- 左侧表单编辑器 (280px 宽) -->
    <div class="workspace-panel">
      <div class="panel-head">
        <span class="panel-title">用户表单</span>
        <el-button
          class="icon-btn"
          size="small"
          text
          @click="addUserRow"
          title="新增用户"
        >
          ➕
        </el-button>
      </div>
      <div class="panel-body">
        <el-scrollbar class="tree-scroll">
          <div class="users-list">
            <div v-for="(item, idx) in users" :key="idx" class="user-row">
              <div class="row-header">
                <span class="user-idx">User {{ idx + 1 }}</span>
                <el-button
                  class="icon-btn danger-text"
                  size="small"
                  text
                  @click="removeUserRow(idx)"
                  title="删除"
                >
                  ✕
                </el-button>
              </div>
              <el-input
                v-model="item.userId"
                placeholder="userId"
                clearable
                class="row-input"
              />
              <div class="code-row">
                <el-input
                  v-model="item.connectCode"
                  placeholder="connectCode"
                  clearable
                  class="row-input"
                />
                <el-button
                  class="dark-btn action-btn"
                  @click="regenerateSingleUserConnectCode(idx)"
                  title="重新生成连接码"
                >
                  ↻
                </el-button>
              </div>
            </div>
            <div v-if="!users.length" class="empty-tip">
              <div class="empty-icon">👥</div>
              <p>暂无用户，请点击右上角新增</p>
            </div>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <!-- 右侧 JSON 编辑器 (1fr 宽) -->
    <div class="workspace-panel workspace-editor">
      <div class="panel-head">
        <div class="file-info">
          <span class="active-file" title="workspace/user.json">workspace/user.json</span>
        </div>
        <div class="editor-actions">
          <el-button size="small" class="dark-btn" @click="generateConnectCodesForEmptyOnly">
            批量生成(空值)
          </el-button>
          <el-button size="small" class="dark-btn" @click="forceRegenerateAllConnectCodes">
            强制重置
          </el-button>
          <el-button
            type="primary"
            class="primary-btn"
            size="small"
            @click="saveUsers"
            :loading="saving"
          >
            保存
          </el-button>
        </div>
      </div>

      <div class="panel-body editor-body">
        <div v-if="jsonParseError" class="json-error">
          ⚠️ {{ jsonParseError }}
        </div>
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
</template>

<style scoped>
/* 整体布局：完全对齐第二个界面的 280px 1fr */
.workspace-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  height: calc(100vh - 80px); /* 适配 Drawer 内部高度 */
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

/* 按钮样式适配主界面 */
.icon-btn {
  color: #8a94af;
  font-size: 14px;
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

/* 左侧表单区域 (适配 280px 宽度) */
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

/* 右侧 JSON 编辑器 */
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  text-align: center;
  padding: 40px 0;
  font-size: 13px;
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.3;
}

/* 响应式适配：完全对齐第二个界面的移动端 */
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
    max-width: 120px;
  }
}
</style>
