<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  MoreFilled,
  Refresh,
  Folder,
  Document,
  Key,
} from "@element-plus/icons-vue";
import {
  buildWorkspaceAllDownloadUrl,
  buildWorkspaceDownloadUrl,
  getConfigParamCatalogApi,
  getWorkspaceAllFileApi,
  getWorkspaceAllTreeApi,
  getWorkspaceFileApi,
  postSyncAllWorkspaceApi,
  postResetWorkspaceApi,
  postSyncWorkspaceApi,
  getWorkspaceTreeApi,
  putWorkspaceAllFileApi,
  putWorkspaceFileApi,
} from "../api/chatApi";

const props = defineProps({
  userId: { type: String, default: "" },
  apiKey: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  isSuperAdmin: { type: Boolean, default: false },
});
const emit = defineEmits(["workspace-reset"]);

const tree = ref([]);
const allWorkspaceTree = ref([]);
const loadingTree = ref(false);
const loadingAllTree = ref(false);
const loadingFile = ref(false);
const saving = ref(false);
const resetting = ref(false);
const syncing = ref(false);
const syncingAll = ref(false);
const activePath = ref("");
const activePathSource = ref("user");
const content = ref("");
const isTextFile = ref(true);
const editorInputRef = ref(null);
const paramCatalog = ref([]);
const loadingParamCatalog = ref(false);
const activeResourceSection = ref("directory");
const lastActiveResourceSection = ref("directory");
const paramTreeData = computed(() =>
  (paramCatalog.value || []).map((item) => ({
    key: String(item?.key || "").trim(),
    label: String(item?.key || "").trim(),
    description: String(item?.description || "").trim(),
    type: "param",
  })),
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

async function loadAllWorkspaceTree() {
  if (!props.connected || !props.apiKey || !props.isSuperAdmin) return;
  loadingAllTree.value = true;
  try {
    const res = await getWorkspaceAllTreeApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载全工作区失败");
    allWorkspaceTree.value = data.tree || [];
  } catch (error) {
    ElMessage.error(error.message || "加载全工作区失败");
  } finally {
    loadingAllTree.value = false;
  }
}

async function loadParamCatalog() {
  if (!props.connected || !props.apiKey) return;
  loadingParamCatalog.value = true;
  try {
    const res = await getConfigParamCatalogApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "加载参数列表失败");
    paramCatalog.value = Array.isArray(data.catalog) ? data.catalog : [];
  } catch (error) {
    ElMessage.error(error.message || "加载参数列表失败");
  } finally {
    loadingParamCatalog.value = false;
  }
}

async function refreshAll() {
  await Promise.all([
    loadTree(),
    loadParamCatalog(),
    props.isSuperAdmin ? loadAllWorkspaceTree() : Promise.resolve(),
  ]);
}

async function openFile(node, source = "user") {
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
    const res =
      source === "all"
        ? await getWorkspaceAllFileApi(
            { path: node.path },
            { fetcher: authFetch },
          )
        : await getWorkspaceFileApi(
            { userId: props.userId, path: node.path },
            { fetcher: authFetch },
          );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "读取文件失败");
    activePath.value = data.path || node.path;
    activePathSource.value = source === "all" ? "all" : "user";
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
    const res =
      activePathSource.value === "all"
        ? await putWorkspaceAllFileApi(
            {
              path: activePath.value,
              content: content.value,
            },
            { fetcher: authFetch },
          )
        : await putWorkspaceFileApi(
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
    await refreshAll();
  } catch (e) {
    ElMessage.error(e.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

function downloadFile() {
  if (!props.connected || !activePath.value || !props.userId || !props.apiKey)
    return;
  const downloadUrl =
    activePathSource.value === "all"
      ? buildWorkspaceAllDownloadUrl({
          path: activePath.value,
          apiKey: props.apiKey,
        })
      : buildWorkspaceDownloadUrl({
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
    activePathSource.value = "user";
    content.value = "";
    isTextFile.value = true;
    await refreshAll();
    emit("workspace-reset");
    ElMessage.success("工作区已重置");
  } catch (error) {
    ElMessage.error(error.message || "重置工作区失败");
  } finally {
    resetting.value = false;
  }
}

async function syncWorkspace() {
  if (!props.connected || !props.userId || !props.apiKey) return;
  syncing.value = true;
  try {
    const res = await postSyncWorkspaceApi(
      { userId: props.userId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "同步配置失败");
    await refreshAll();
    ElMessage.success("已完成增量同步");
  } catch (error) {
    ElMessage.error(error.message || "同步配置失败");
  } finally {
    syncing.value = false;
  }
}

async function syncAllWorkspace() {
  if (!props.connected || !props.apiKey || !props.isSuperAdmin) return;
  syncingAll.value = true;
  try {
    const res = await postSyncAllWorkspaceApi({ fetcher: authFetch });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "同步所有用户配置失败");
    await refreshAll();
    ElMessage.success(
      `已完成同步（${Number(data.success || 0)}/${Number(data.total || 0)}）`,
    );
  } catch (error) {
    ElMessage.error(error.message || "同步所有用户配置失败");
  } finally {
    syncingAll.value = false;
  }
}

async function insertParamAtCursor(key = "") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (!activePath.value || !isTextFile.value) {
    ElMessage.warning("请先选择可编辑文本文件");
    return;
  }
  const token = `\${${normalizedKey}}`;
  await nextTick();
  const textarea = editorInputRef.value?.textarea || null;
  if (!textarea) {
    content.value = `${content.value || ""}${token}`;
    return;
  }
  const start = Number(textarea.selectionStart ?? content.value.length);
  const end = Number(textarea.selectionEnd ?? content.value.length);
  const current = String(content.value || "");
  content.value = `${current.slice(0, start)}${token}${current.slice(end)}`;
  await nextTick();
  const caret = start + token.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
}

function handleTreeAction(command = "") {
  if (command === "refresh") {
    refreshAll();
  }
}

function handleEditorAction(command = "") {
  if (command === "download") {
    downloadFile();
    return;
  }
  if (command === "save") {
    saveFile();
  }
}

watch(
  () => activeResourceSection.value,
  (value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      lastActiveResourceSection.value = normalized;
      return;
    }
    activeResourceSection.value = lastActiveResourceSection.value || "directory";
  },
);

watch(
  () => props.active,
  (v) => {
    if (v) refreshAll();
  },
  { immediate: true },
);

watch(
  () => props.userId,
  () => {
    if (props.active) refreshAll();
  },
);

watch(
  () => props.apiKey,
  () => {
    if (props.active && props.connected) refreshAll();
  },
);

watch(
  () => props.connected,
  (isConnected) => {
    if (isConnected && props.active) refreshAll();
  },
);

watch(
  () => props.isSuperAdmin,
  (isSuperAdmin) => {
    if (!isSuperAdmin && activeResourceSection.value === "all-workspace") {
      activeResourceSection.value = "directory";
    }
  },
);
</script>

<template>
  <div class="workspace-layout">
    <!-- 左侧目录树 -->
    <div class="workspace-panel workspace-tree">
      <div class="panel-head">
        <span class="panel-title">资源</span>
        <!-- 将按钮包裹在 tree-actions 中，统一控制间距 -->
        <div class="tree-actions">
          <div class="desktop-actions">
            <el-button class="refresh-btn noobot-action-btn tail-btn" size="small" :icon="Refresh" @click="refreshAll"
              :loading="loadingTree || loadingAllTree || loadingParamCatalog || resetting || syncingAll"
              :disabled="!connected || resetting || syncing || syncingAll" title="刷新目录和参数"
              aria-label="刷新目录和参数" />
          </div>
          <el-dropdown class="mobile-actions" trigger="click" @command="handleTreeAction">
            <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="refresh">刷新目录和参数</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <div class="panel-body">
        <el-collapse v-model="activeResourceSection" accordion class="resource-collapse">
          <el-collapse-item
            name="directory"
            title="目录"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'directory',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'directory',
            }"
          >
            <div class="dir-inner-actions">
              <el-button class="dark-btn" size="small" @click="syncWorkspace" :loading="syncing"
                :disabled="loadingTree || loadingFile || saving || resetting" title="增量同步配置">
                同步配置
              </el-button>
              <el-button class="danger-btn" size="small" @click="resetWorkspace" :loading="resetting"
                :disabled="loadingTree || loadingFile || saving || syncing" title="重置工作区">
                重置
              </el-button>
            </div>
            <el-scrollbar class="tree-scroll">
                <el-tree :data="tree" node-key="path" :props="{ label: 'label', children: 'children' }"
                  @node-click="(data) => openFile(data, 'user')" highlight-current class="custom-tree">
                <template #default="{ data }">
                  <span class="tree-node">
                    <el-icon class="node-icon">
                      <Folder v-if="data.type === 'dir'" />
                      <Document v-else />
                    </el-icon>
                    <span class="node-label">{{ data.label }}</span>
                  </span>
                </template>
              </el-tree>
            </el-scrollbar>
          </el-collapse-item>
          <el-collapse-item
            v-if="isSuperAdmin"
            name="all-workspace"
            title="所有用户工作区"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'all-workspace',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'all-workspace',
            }"
          >
            <div class="dir-inner-actions">
              <el-button class="dark-btn" size="small" @click="syncAllWorkspace" :loading="syncingAll"
                :disabled="loadingAllTree || loadingFile || saving || resetting || syncing" title="同步所有用户配置">
                同步配置
              </el-button>
            </div>
            <el-scrollbar
              class="tree-scroll"
              v-loading="loadingAllTree"
              element-loading-background="rgba(11, 13, 18, 0.6)"
            >
              <el-tree
                :data="allWorkspaceTree"
                node-key="path"
                :props="{ label: 'label', children: 'children' }"
                @node-click="(data) => openFile(data, 'all')"
                highlight-current
                class="custom-tree"
              >
                <template #default="{ data }">
                  <span class="tree-node">
                    <el-icon class="node-icon">
                      <Folder v-if="data.type === 'dir'" />
                      <Document v-else />
                    </el-icon>
                    <span class="node-label">{{ data.label }}</span>
                  </span>
                </template>
              </el-tree>
            </el-scrollbar>
          </el-collapse-item>
          <el-collapse-item
            name="params"
            title="参数"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'params',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'params',
            }"
          >
            <el-scrollbar class="tree-scroll" v-loading="loadingParamCatalog"
              element-loading-background="rgba(11, 13, 18, 0.6)">
              <el-tree :data="paramTreeData" node-key="key" :props="{ label: 'label', children: 'children' }"
                class="custom-tree param-tree">
                <template #default="{ data }">
                  <span class="tree-node param-row" @dblclick.stop="insertParamAtCursor(data.key)">
                    <el-icon class="node-icon"><Key /></el-icon>
                    <span class="node-label">{{ data.label }}</span>
                    <span class="param-desc" :title="data.description">{{ data.description || "（无说明）" }}</span>
                  </span>
                </template>
              </el-tree>
              <div v-if="!paramTreeData.length && !loadingParamCatalog" class="empty-tip left-empty">
                <p>暂无参数</p>
              </div>
            </el-scrollbar>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>

    <!-- 右侧编辑器 -->
    <div class="workspace-panel workspace-editor">
      <div class="panel-head">
        <div class="file-info">
          <span class="active-file" :title="activePath">{{
            activePath
              ? `${activePathSource === 'all' ? '[全部工作区] ' : ''}${activePath}`
              : "未选择文件"
          }}</span>
        </div>
        <div class="editor-actions">
          <div class="desktop-actions">
            <el-button class="dark-btn" size="small" @click="downloadFile" :disabled="!activePath">
              下载
            </el-button>
            <el-button type="primary" class="primary-btn" size="small" @click="saveFile"
              :disabled="!activePath || !isTextFile" :loading="saving">
              保存
            </el-button>
          </div>
          <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
            <el-button class="tail-btn noobot-action-btn" :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="download">下载</el-dropdown-item>
                <el-dropdown-item command="save">保存</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div class="panel-body editor-body" v-loading="loadingFile" element-loading-background="rgba(11, 13, 18, 0.8)">
        <template v-if="activePath">
          <el-input v-if="isTextFile" ref="editorInputRef" v-model="content" type="textarea" resize="none" class="editor-input"
            :disabled="loadingFile" placeholder="开始编辑..." />
          <div v-else class="empty-tip">
            <el-empty
              description="该文件为二进制文件，暂不支持在线预览，请点击右上角下载查看"
              :image-size="72"
            />
          </div>
        </template>
        <div v-else class="empty-tip">
          <el-empty
            description="请在左侧目录树中选择要查看或编辑的文件"
            :image-size="72"
          />
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
  height: calc(100vh - 80px);
  /* 适配 Drawer 内部高度 */
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

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0b0d12;
}

.dir-inner-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px 0 10px;
}

.resource-collapse {
  height: 100%;
  min-height: 0;
  border: none;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.resource-collapse :deep(.el-collapse-item__header) {
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  background: #0e121b;
  color: #d7ddf2;
  border-bottom: 1px solid #1f2430;
  font-size: 13px;
  font-weight: 600;
}

.resource-collapse :deep(.el-collapse-item__header:hover) {
  background: #141926;
}

.resource-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 1px solid #1f2430;
  background: #0b0d12;
}

.resource-collapse :deep(.el-collapse-item__content) {
  padding: 0;
}

.resource-collapse :deep(.resource-collapse-item) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 0 auto;
}

.resource-collapse :deep(.resource-collapse-item--active) {
  flex: 1;
}

.resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__wrap) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__content) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.resource-collapse :deep(.resource-collapse-item--collapsed) {
  margin-top: auto;
}

/* 左侧目录树按钮组 */
.tree-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  /* 增加按钮之间的间距 */
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

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #d7ddf2;
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
  width: 100%;
  min-width: 0;
}

.node-icon {
  font-size: 14px;
  opacity: 0.9;
  color: #9fb2e3;
}

.node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.param-row {
  cursor: pointer;
}

.param-desc {
  margin-left: auto;
  color: #7f8aa6;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
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

.left-empty {
  position: static;
  min-height: 80px;
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

.empty-tip :deep(.el-empty__description p) {
  color: #7f8aa6;
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
