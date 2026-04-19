<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import {
  buildWorkspaceDownloadUrl,
  getWorkspaceFileApi,
  postResetWorkspaceApi,
  getWorkspaceTreeApi,
  putWorkspaceFileApi,
} from "../api/chatApi";

const props = defineProps({
  userId: { type: String, default: "" },
  apiKey: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
});
const emit = defineEmits(["workspace-reset"]);

const tree = ref([]);
const loadingTree = ref(false);
const loadingFile = ref(false);
const saving = ref(false);
const resetting = ref(false);
const activePath = ref("");
const content = ref("");
const isTextFile = ref(true);

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

async function loadTree() {
  if (!props.connected || !props.userId || !props.apiKey) return;
  loadingTree.value = true;
  try {
    const res = await getWorkspaceTreeApi(
      { userId: props.userId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载工作区失败");
    tree.value = data.tree || [];
  } catch (e) {
    ElMessage.error(e.message || "加载工作区失败");
  } finally {
    loadingTree.value = false;
  }
}

async function openFile(node) {
  if (
    !props.connected ||
    !node ||
    node.type !== "file" ||
    !props.userId ||
    !props.apiKey
  )
    return;
  loadingFile.value = true;
  try {
    const res = await getWorkspaceFileApi(
      { userId: props.userId, path: node.path },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "读取文件失败");
    activePath.value = data.path || node.path;
    isTextFile.value = data.isText !== false;
    content.value = data.content || "";
  } catch (e) {
    ElMessage.error(e.message || "读取文件失败");
  } finally {
    loadingFile.value = false;
  }
}

async function saveFile() {
  if (
    !props.connected ||
    !activePath.value ||
    !props.userId ||
    !props.apiKey ||
    !isTextFile.value
  )
    return;
  saving.value = true;
  try {
    const res = await putWorkspaceFileApi(
      {
        userId: props.userId,
        path: activePath.value,
        content: content.value,
      },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "保存失败");
    ElMessage.success("保存成功");
    await loadTree();
  } catch (e) {
    ElMessage.error(e.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

function downloadFile() {
  if (!props.connected || !activePath.value || !props.userId || !props.apiKey)
    return;
  const downloadUrl = buildWorkspaceDownloadUrl({
    userId: props.userId,
    path: activePath.value,
    apiKey: props.apiKey,
  });
  window.open(downloadUrl, "_blank");
}

async function resetWorkspace() {
  if (!props.connected || !props.userId || !props.apiKey) return;
  try {
    await ElMessageBox.confirm(
      "确定要重置工作区吗？该用户目录下文件会被删除，并恢复为默认模板。",
      "重置工作区",
      {
        confirmButtonText: "确定重置",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  resetting.value = true;
  try {
    const res = await postResetWorkspaceApi(
      { userId: props.userId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "重置工作区失败");
    activePath.value = "";
    content.value = "";
    isTextFile.value = true;
    await loadTree();
    emit("workspace-reset");
    ElMessage.success("工作区已重置");
  } catch (error) {
    ElMessage.error(error.message || "重置工作区失败");
  } finally {
    resetting.value = false;
  }
}

watch(
  () => props.active,
  (v) => {
    if (v) loadTree();
  },
  { immediate: true },
);

watch(
  () => props.userId,
  () => {
    if (props.active) loadTree();
  },
);

watch(
  () => props.apiKey,
  () => {
    if (props.active && props.connected) loadTree();
  },
);

watch(
  () => props.connected,
  (isConnected) => {
    if (isConnected && props.active) loadTree();
  },
);
</script>

<template>
  <div class="workspace-layout">
    <!-- 左侧目录树 -->
    <div class="workspace-panel workspace-tree">
      <div class="panel-head">
        <span class="panel-title">项目目录</span>
        <!-- 优化：使用 :icon 属性并自闭合，彻底解决 loading 时的空 span 挤压问题 -->
        <el-button
          class="refresh-btn noobot-action-btn tail-btn"
          size="small"
          :icon="Refresh"
          @click="loadTree"
          :loading="loadingTree || resetting"
          :disabled="!connected || resetting"
          title="刷新目录"
          aria-label="刷新目录"
        />
        <el-button
          class="danger-btn"
          size="small"
          @click="resetWorkspace"
          :loading="resetting"
          :disabled="loadingTree || loadingFile || saving"
          title="重置工作区"
        >
          重置工作区
        </el-button>
      </div>
      <div class="panel-body">
        <el-scrollbar class="tree-scroll">
          <el-tree
            :data="tree"
            node-key="path"
            :props="{ label: 'label', children: 'children' }"
            @node-click="openFile"
            highlight-current
            class="custom-tree"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <span class="node-icon">{{
                  data.type === "dir" ? "📁" : "📄"
                }}</span>
                <span class="node-label">{{ data.label }}</span>
              </span>
            </template>
          </el-tree>
        </el-scrollbar>
      </div>
    </div>

    <!-- 右侧编辑器 -->
    <div class="workspace-panel workspace-editor">
      <div class="panel-head">
        <div class="file-info">
          <span class="active-file" :title="activePath">{{
            activePath || "未选择文件"
          }}</span>
        </div>
        <div class="editor-actions">
          <el-button
            class="dark-btn"
            size="small"
            @click="downloadFile"
            :disabled="!activePath"
          >
            下载
          </el-button>
          <el-button
            type="primary"
            class="primary-btn"
            size="small"
            @click="saveFile"
            :disabled="!activePath || !isTextFile"
            :loading="saving"
          >
            保存
          </el-button>
        </div>
      </div>

      <div
        class="panel-body editor-body"
        v-loading="loadingFile"
        element-loading-background="rgba(11, 13, 18, 0.8)"
      >
        <template v-if="activePath">
          <el-input
            v-if="isTextFile"
            v-model="content"
            type="textarea"
            resize="none"
            class="editor-input"
            :disabled="loadingFile"
            placeholder="开始编辑..."
          />
          <div v-else class="empty-tip">
            <div class="empty-icon">📦</div>
            <p>
              该文件为二进制文件，暂不支持在线预览<br />请点击右上角下载查看
            </p>
          </div>
        </template>
        <div v-else class="empty-tip">
          <div class="empty-icon">👈</div>
          <p>请在左侧目录树中选择要查看或编辑的文件</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整体布局 */
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
  font-size: 16px;
  padding: 4px 8px;
}
.icon-btn:hover {
  color: #dce2f5;
  background: #1a2030;
}

.tail-btn {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  background: var(--noobot-btn-soft-bg);
  border: 1px solid var(--noobot-btn-soft-border);
  color: var(--noobot-btn-soft-text);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  margin-left: 0 !important;
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

/* 左侧目录树 */
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

/* 空状态/二进制文件提示 */
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
}
</style>