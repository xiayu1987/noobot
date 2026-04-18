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
  active: { type: Boolean, default: false },
});

const loading = ref(false);
const saving = ref(false);
const users = ref([]);

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

async function loadUsers() {
  if (!props.apiKey) return;
  loading.value = true;
  try {
    const res = await getRegularUsersApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载用户失败");
    users.value = normalizeUsers(data.users || []);
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

function validateUsers(list = []) {
  const normalized = normalizeUsers(list);
  if (!normalized.length) {
    throw new Error("至少保留一个用户");
  }
  if (normalized.some((item) => !item.userId || !item.connectCode)) {
    throw new Error("userId 和 connectCode 都不能为空");
  }
  const duplicate = normalized.find(
    (item, idx) => normalized.findIndex((subItem) => subItem.userId === item.userId) !== idx,
  );
  if (duplicate) {
    throw new Error(`存在重复 userId: ${duplicate.userId}`);
  }
  return normalized;
}

async function saveUsers() {
  if (!props.apiKey) return;
  saving.value = true;
  try {
    const payloadUsers = validateUsers(users.value);
    const res = await putRegularUsersApi(
      { users: payloadUsers },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "保存用户失败");
    users.value = normalizeUsers(data.users || payloadUsers);
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
    if (props.active) loadUsers();
  },
);
</script>

<template>
  <div class="user-settings-layout" v-loading="loading">
    <div class="panel-head">
      <div class="head-left">
        <div class="title">workspace/user.json</div>
        <div class="tip">仅超级管理员可编辑用户与连接码</div>
      </div>
      <div class="head-actions">
        <el-button size="small" class="dark-btn" @click="addUserRow">
          新增用户
        </el-button>
        <el-button
          size="small"
          type="primary"
          class="primary-btn"
          :loading="saving"
          @click="saveUsers"
        >
          保存
        </el-button>
      </div>
    </div>

    <el-scrollbar class="users-scroll">
      <div class="users-list">
        <div
          v-for="(item, idx) in users"
          :key="idx"
          class="user-row"
        >
          <el-input
            v-model="item.userId"
            placeholder="userId"
            clearable
            class="row-input"
          />
          <el-input
            v-model="item.connectCode"
            placeholder="connectCode"
            clearable
            class="row-input"
          />
          <el-button
            class="danger-btn"
            type="danger"
            plain
            @click="removeUserRow(idx)"
          >
            删除
          </el-button>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<style scoped>
.user-settings-layout {
  height: calc(100vh - 90px);
  display: flex;
  flex-direction: column;
  background: #070b14;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 4px 12px;
  border-bottom: 1px solid #1e2739;
}

.head-left .title {
  color: #e8eeff;
  font-size: 14px;
  font-weight: 600;
}

.head-left .tip {
  color: #8ea2cc;
  font-size: 12px;
  margin-top: 4px;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.users-scroll {
  height: 100%;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 4px 4px;
}

.user-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  align-items: center;
}

.row-input :deep(.el-input__wrapper) {
  background: #0f1523;
  border-color: #2d3b57;
}

.dark-btn {
  border: 1px solid var(--noobot-btn-secondary-border);
  background: var(--noobot-btn-secondary-bg);
  color: var(--noobot-btn-secondary-text);
}

.primary-btn {
  border-radius: 8px !important;
}

.danger-btn {
  border-radius: 8px !important;
}

@media (max-width: 768px) {
  .user-settings-layout {
    height: calc(100vh - 80px);
  }

  .user-row {
    grid-template-columns: 1fr;
  }
}
</style>
