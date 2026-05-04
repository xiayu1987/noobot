<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
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
  postResetAllWorkspaceApi,
  postSyncAllWorkspaceApi,
  postResetWorkspaceApi,
  postSyncWorkspaceApi,
  getWorkspaceTreeApi,
  putWorkspaceAllFileApi,
  putWorkspaceFileApi,
} from "../../services/api/chatApi";
import { useLocale } from "../../shared/i18n/useLocale";

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
const resettingAll = ref(false);
const activePath = ref("");
const activePathSource = ref("user");
const content = ref("");
const isTextFile = ref(true);
const editorInputRef = ref(null);
const systemParamCatalog = ref([]);
const userParamCatalog = ref([]);
const loadingSystemParamCatalog = ref(false);
const loadingUserParamCatalog = ref(false);
const activeResourceSection = ref("directory");
const resetDialogVisible = ref(false);
const resetDialogMode = ref("user");
const resetDialogSections = ref([]);
const { translate } = useLocale();
const RESET_SECTION_OPTIONS = [
  { value: "memory", label: "memory" },
  { value: "runtime", label: "runtime" },
  { value: "service", label: "service" },
  { value: "skill", label: "skill" },
  { value: "config", label: "config" },
];
const RESET_SECTION_DEFAULTS = ["service", "config"];
const resetDialogTitle = computed(() =>
  resetDialogMode.value === "all" ? translate("settings.resetAllWorkspaceTitle") : translate("settings.resetWorkspaceTitle"),
);
const resetDialogConfirmLoading = computed(
  () => resetting.value || resettingAll.value,
);
const systemParamTreeData = computed(() =>
  (systemParamCatalog.value || []).map((item) => ({
    key: String(item?.key || "").trim(),
    label: String(item?.key || "").trim(),
    description: String(item?.description || "").trim(),
    type: "param",
  })),
);
const userParamTreeData = computed(() =>
  (userParamCatalog.value || []).map((item) => ({
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
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.loadingWorkspaceFailed"));
    tree.value = data.tree || [];
  } catch (error) {
    ElMessage.error(error.message || translate("settings.loadingWorkspaceFailed"));
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
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.loadingAllWorkspaceFailed"));
    allWorkspaceTree.value = data.tree || [];
  } catch (error) {
    ElMessage.error(error.message || translate("settings.loadingAllWorkspaceFailed"));
  } finally {
    loadingAllTree.value = false;
  }
}

async function loadParamCatalog(scope = "system") {
  if (!props.connected || !props.apiKey) return;
  const normalizedScope = String(scope || "").trim().toLowerCase() === "user" ? "user" : "system";
  if (normalizedScope === "system") loadingSystemParamCatalog.value = true;
  else loadingUserParamCatalog.value = true;
  try {
    const res = await getConfigParamCatalogApi({
      scope: normalizedScope,
      fetcher: authFetch,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.loadingParamCatalogFailed"));
    if (normalizedScope === "system") {
      systemParamCatalog.value = Array.isArray(data.catalog) ? data.catalog : [];
    } else {
      userParamCatalog.value = Array.isArray(data.catalog) ? data.catalog : [];
    }
  } catch (error) {
    ElMessage.error(error.message || translate("settings.loadingParamCatalogFailed"));
  } finally {
    if (normalizedScope === "system") loadingSystemParamCatalog.value = false;
    else loadingUserParamCatalog.value = false;
  }
}

async function refreshAll() {
  await Promise.all([
    loadTree(),
    loadParamCatalog("system"),
    loadParamCatalog("user"),
    props.isSuperAdmin ? loadAllWorkspaceTree() : Promise.resolve(),
  ]);
}

async function openFile(node, source = "user") {
  if (!props.connected || !node || !props.userId || !props.apiKey)
    return;
  const normalizedSource = source === "all" ? "all" : "user";
  const nodePath = String(node.path || "").trim();
  if (!nodePath) return;
  if (node.type === "dir") {
    activePath.value = nodePath;
    activePathSource.value = normalizedSource;
    isTextFile.value = false;
    content.value = "";
    return;
  }
  if (node.type !== "file") return;
  loadingFile.value = true;
  try {
    const res =
      normalizedSource === "all"
        ? await getWorkspaceAllFileApi(
            { path: nodePath },
            { fetcher: authFetch },
          )
        : await getWorkspaceFileApi(
            { userId: props.userId, path: nodePath },
            { fetcher: authFetch },
          );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.readFileFailed"));
    activePath.value = data.path || nodePath;
    activePathSource.value = normalizedSource;
    isTextFile.value = data.isText !== false;
    content.value = data.content || "";
  } catch (error) {
    ElMessage.error(error.message || translate("settings.readFileFailed"));
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
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.saveFileFailed"));
    ElMessage.success(translate("settings.saveSuccess"));
    await refreshAll();
  } catch (error) {
    ElMessage.error(error.message || translate("settings.saveFileFailed"));
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
  openResetDialog("user");
}

async function doResetWorkspace(sections = []) {
  resetting.value = true;
  try {
    const res = await postResetWorkspaceApi(
      { userId: props.userId, sections },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.resetWorkspaceFailed"));
    activePath.value = "";
    activePathSource.value = "user";
    content.value = "";
    isTextFile.value = true;
    await refreshAll();
    emit("workspace-reset");
    ElMessage.success(translate("settings.workspaceReset"));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.resetWorkspaceFailed"));
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
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.syncConfigFailed"));
    await refreshAll();
    ElMessage.success(translate("settings.syncDone"));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.syncConfigFailed"));
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
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.syncAllFailed"));
    await refreshAll();
    ElMessage.success(translate("settings.syncDoneWithCount", { success: Number(data.success || 0), total: Number(data.total || 0) }));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.syncAllFailed"));
  } finally {
    syncingAll.value = false;
  }
}

async function resetAllWorkspace() {
  if (!props.connected || !props.apiKey || !props.isSuperAdmin) return;
  openResetDialog("all");
}

async function doResetAllWorkspace(sections = []) {
  resettingAll.value = true;
  try {
    const res = await postResetAllWorkspaceApi(
      { sections },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.resetAllFailed"));
    activePath.value = "";
    activePathSource.value = "user";
    content.value = "";
    isTextFile.value = true;
    await refreshAll();
    ElMessage.success(translate("settings.resetDoneWithCount", { success: Number(data.success || 0), total: Number(data.total || 0) }));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.resetAllFailed"));
  } finally {
    resettingAll.value = false;
  }
}

function openResetDialog(mode = "user") {
  resetDialogMode.value = mode === "all" ? "all" : "user";
  resetDialogSections.value = [...RESET_SECTION_DEFAULTS];
  resetDialogVisible.value = true;
}

function selectAllResetSections() {
  resetDialogSections.value = RESET_SECTION_OPTIONS.map((item) => item.value);
}

function clearAllResetSections() {
  resetDialogSections.value = [];
}

async function confirmResetDialog() {
  if (!Array.isArray(resetDialogSections.value) || !resetDialogSections.value.length) {
    ElMessage.warning(translate("settings.selectResetAtLeastOne"));
    return;
  }
  const sections = [...resetDialogSections.value];
  resetDialogVisible.value = false;
  try {
    if (resetDialogMode.value === "all") {
      await doResetAllWorkspace(sections);
      return;
    }
    await doResetWorkspace(sections);
  } catch {
    // errors are handled in doResetWorkspace/doResetAllWorkspace
  }
}

async function insertParamAtCursor(key = "") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (!activePath.value || !isTextFile.value) {
    ElMessage.warning(translate("settings.selectEditableTextFile"));
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
  () => props.active,
  (isActive) => {
    if (isActive) refreshAll();
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
  <div class="workspace-layout noobot-workspace-layout">
    <!-- 左侧目录树 -->
    <div class="workspace-panel workspace-tree noobot-flat-card noobot-workspace-panel">
      <div class="panel-head noobot-workspace-head">
        <span class="panel-title noobot-workspace-title">{{ translate("settings.resources") }}</span>
        <!-- 将按钮包裹在 tree-actions 中，统一控制间距 -->
        <div class="tree-actions">
          <div class="desktop-actions">
            <el-button class="refresh-btn noobot-action-btn tail-btn noobot-tail-btn" size="small" :icon="Refresh" @click="refreshAll"
              :loading="loadingTree || loadingAllTree || loadingSystemParamCatalog || loadingUserParamCatalog || resetting || syncingAll"
              :disabled="!connected || resetting || syncing || syncingAll" :title="translate('settings.refreshDirsAndParams')"
              :aria-label="translate('settings.refreshDirsAndParams')" />
          </div>
          <el-dropdown class="mobile-actions" trigger="click" @command="handleTreeAction">
            <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="refresh">{{ translate("settings.refreshDirsAndParams") }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <div class="panel-body noobot-workspace-body">
        <el-collapse v-model="activeResourceSection" accordion class="resource-collapse">
          <el-collapse-item
            name="directory"
            :title="translate('settings.directory')"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'directory',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'directory',
            }"
          >
            <div class="dir-inner-actions">
              <el-button class="dark-btn noobot-action-btn noobot-flat-soft-btn" size="small" @click="syncWorkspace" :loading="syncing"
                :disabled="loadingTree || loadingFile || saving || resetting" :title="translate('settings.syncConfig')">
                {{ translate("settings.syncConfig") }}
              </el-button>
              <el-button class="danger-btn noobot-action-btn" size="small" @click="resetWorkspace" :loading="resetting"
                :disabled="loadingTree || loadingFile || saving || syncing" :title="translate('settings.resetWorkspaceTitle')">
                {{ translate("settings.reset") }}
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
            :title="translate('settings.allWorkspace')"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'all-workspace',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'all-workspace',
            }"
          >
            <div class="dir-inner-actions">
              <el-button class="dark-btn noobot-action-btn noobot-flat-soft-btn" size="small" @click="syncAllWorkspace" :loading="syncingAll"
                :disabled="loadingAllTree || loadingFile || saving || resetting || syncing || resettingAll"
                :title="translate('settings.syncAllConfig')">
                {{ translate("settings.syncConfig") }}
              </el-button>
              <el-button class="danger-btn noobot-action-btn" size="small" @click="resetAllWorkspace" :loading="resettingAll"
                :disabled="loadingAllTree || loadingFile || saving || resetting || syncing || syncingAll"
                :title="translate('settings.resetAllWorkspaceKeepRuntime')">
                {{ translate("settings.reset") }}
              </el-button>
            </div>
            <el-scrollbar
              class="tree-scroll"
              v-loading="loadingAllTree"
              element-loading-background="var(--noobot-mask-bg)"
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
            name="system-params"
            :title="translate('settings.systemParams')"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'system-params',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'system-params',
            }"
          >
            <el-scrollbar class="tree-scroll" v-loading="loadingSystemParamCatalog"
              element-loading-background="var(--noobot-mask-bg)">
              <el-tree :data="systemParamTreeData" node-key="key" :props="{ label: 'label', children: 'children' }"
                class="custom-tree param-tree">
                <template #default="{ data }">
                  <span class="tree-node param-row" @dblclick.stop="insertParamAtCursor(data.key)">
                    <el-icon class="node-icon"><Key /></el-icon>
                    <span class="node-label">{{ data.label }}</span>
                    <span class="param-desc" :title="data.description">{{ data.description || translate("settings.noDescription") }}</span>
                  </span>
                </template>
              </el-tree>
              <div v-if="!systemParamTreeData.length && !loadingSystemParamCatalog" class="empty-tip left-empty">
                <p>{{ translate("settings.noParams") }}</p>
              </div>
            </el-scrollbar>
          </el-collapse-item>
          <el-collapse-item
            name="user-params"
            :title="translate('settings.userParams')"
            class="resource-collapse-item"
            :class="{
              'resource-collapse-item--active': activeResourceSection === 'user-params',
              'resource-collapse-item--collapsed':
                !!activeResourceSection && activeResourceSection !== 'user-params',
            }"
          >
            <el-scrollbar class="tree-scroll" v-loading="loadingUserParamCatalog"
              element-loading-background="var(--noobot-mask-bg)">
              <el-tree :data="userParamTreeData" node-key="key" :props="{ label: 'label', children: 'children' }"
                class="custom-tree param-tree">
                <template #default="{ data }">
                  <span class="tree-node param-row" @dblclick.stop="insertParamAtCursor(data.key)">
                    <el-icon class="node-icon"><Key /></el-icon>
                    <span class="node-label">{{ data.label }}</span>
                    <span class="param-desc" :title="data.description">{{ data.description || translate("settings.noDescription") }}</span>
                  </span>
                </template>
              </el-tree>
              <div v-if="!userParamTreeData.length && !loadingUserParamCatalog" class="empty-tip left-empty">
                <p>{{ translate("settings.noParams") }}</p>
              </div>
            </el-scrollbar>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>

    <!-- 右侧编辑器 -->
    <div class="workspace-panel workspace-editor noobot-flat-card noobot-workspace-panel">
      <div class="panel-head noobot-workspace-head">
        <div class="file-info">
              <span class="active-file noobot-flat-chip" :title="activePath">{{
            activePath
              ? `${activePathSource === 'all' ? translate('settings.allWorkspacePrefix') : ''}${activePath}`
              : translate("settings.noFileSelected")
          }}</span>
        </div>
        <div class="editor-actions">
          <div class="desktop-actions">
            <el-button class="dark-btn noobot-action-btn noobot-flat-soft-btn" size="small" @click="downloadFile" :disabled="!activePath">
              {{ translate("settings.download") }}
            </el-button>
            <el-button type="primary" class="primary-btn noobot-action-btn" size="small" @click="saveFile"
              :disabled="!activePath || !isTextFile" :loading="saving">
              {{ translate("settings.save") }}
            </el-button>
          </div>
          <el-dropdown class="mobile-actions" trigger="click" @command="handleEditorAction">
            <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="download">{{ translate("settings.download") }}</el-dropdown-item>
                <el-dropdown-item command="save">{{ translate("settings.save") }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div class="panel-body noobot-workspace-body editor-body" v-loading="loadingFile" element-loading-background="var(--noobot-mask-bg)">
        <template v-if="activePath">
          <el-input v-if="isTextFile" ref="editorInputRef" v-model="content" type="textarea" resize="none" class="editor-input noobot-editor-textarea"
            :disabled="loadingFile" :placeholder="translate('settings.startEdit')" />
          <div v-else class="empty-tip">
            <el-empty
              :description="translate('settings.binaryNoPreview')"
              :image-size="72"
            />
          </div>
        </template>
        <div v-else class="empty-tip">
          <el-empty
            :description="translate('settings.chooseFileFromTree')"
            :image-size="72"
          />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="resetDialogVisible"
      :title="resetDialogTitle"
      width="min(92vw, 420px)"
      append-to-body
      class="workspace-reset-dialog"
    >
      <div class="reset-dialog-tip noobot-flat-card">
        {{ translate("settings.resetDialogTipPrefix") }}
        <code>default-user</code> {{ translate("settings.resetDialogTipSuffix") }}
      </div>
      <div class="reset-dialog-toolbar">
        <el-button text size="small" @click="selectAllResetSections">{{ translate("settings.selectAll") }}</el-button>
        <el-button text size="small" @click="clearAllResetSections">{{ translate("settings.clear") }}</el-button>
      </div>
      <el-checkbox-group v-model="resetDialogSections" class="reset-section-group">
        <el-checkbox
          v-for="item in RESET_SECTION_OPTIONS"
          :key="item.value"
          :value="item.value"
          :label="item.label"
          border
          class="reset-section-item"
        >
          {{ item.label }}
        </el-checkbox>
      </el-checkbox-group>
      <div class="reset-dialog-note">{{ translate("settings.resetDialogNote") }}</div>
      <template #footer>
        <el-button @click="resetDialogVisible = false">{{ translate("settings.cancel") }}</el-button>
        <el-button
          type="danger"
          :loading="resetDialogConfirmLoading"
          @click="confirmResetDialog"
        >
          {{ translate("settings.confirmReset") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 整体布局 */
.workspace-layout {
  overflow: hidden;
}

/* 面板通用样式 */
.workspace-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  background: var(--noobot-panel-head-bg);
  color: var(--noobot-text-main);
  border-bottom: 1px solid var(--noobot-divider);
  font-size: 13px;
  font-weight: 600;
}

.resource-collapse :deep(.el-collapse-item__header:hover) {
  background: var(--noobot-panel-muted);
}

.resource-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 1px solid var(--noobot-divider);
  background: color-mix(in srgb, var(--noobot-panel-bg) 92%, var(--noobot-surface-sidebar));
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

.tree-node {
  width: 100%;
  min-width: 0;
}

.node-icon {
  color: var(--noobot-text-secondary);
}

.param-row {
  cursor: pointer;
}

.param-desc {
  margin-left: auto;
  color: var(--noobot-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.left-empty {
  position: static;
  min-height: 80px;
}

.editor-body {
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-input {
  flex: 1;
  min-height: 0;
}

.editor-input :deep(.el-textarea) {
  height: 100%;
}

:deep(.workspace-reset-dialog .el-dialog) {
  border: 1px solid var(--noobot-panel-border);
  background: var(--noobot-panel-bg);
}

:deep(.workspace-reset-dialog .el-dialog__header) {
  border-bottom: 1px solid var(--noobot-divider);
  margin-right: 0;
  padding-bottom: 12px;
}

:deep(.workspace-reset-dialog .el-dialog__title) {
  color: var(--noobot-text-main);
  font-weight: 600;
}

:deep(.workspace-reset-dialog .el-dialog__body) {
  padding-top: 14px;
}

:deep(.workspace-reset-dialog .el-dialog__footer) {
  border-top: 1px solid var(--noobot-divider);
}

.reset-section-group {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(120px, 1fr));
  gap: 8px 12px;
}

.reset-dialog-tip {
  font-size: 13px;
  color: var(--noobot-text-secondary);
  line-height: 1.6;
  padding: 10px 12px;
  background: var(--noobot-panel-muted);
}

.reset-dialog-tip code {
  color: var(--noobot-text-accent);
}

.reset-dialog-toolbar {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.reset-section-item {
  margin-right: 0 !important;
}

.reset-dialog-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--noobot-text-muted);
}

/* 空状态/二进制文件提示 */
.empty-tip :deep(.el-empty__description p) {
  color: var(--noobot-text-muted);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .reset-section-group {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .reset-dialog-toolbar {
    justify-content: space-between;
  }

  :deep(.workspace-reset-dialog .el-dialog) {
    width: calc(100vw - 24px) !important;
    max-width: 560px;
    margin-top: 8vh !important;
  }

  :deep(.workspace-reset-dialog .el-dialog__body) {
    padding-left: 14px;
    padding-right: 14px;
  }

  :deep(.workspace-reset-dialog .el-dialog__footer) {
    padding: 10px 14px 14px;
    display: flex;
    gap: 8px;
  }

  :deep(.workspace-reset-dialog .el-dialog__footer .el-button) {
    flex: 1;
  }
}
</style>
