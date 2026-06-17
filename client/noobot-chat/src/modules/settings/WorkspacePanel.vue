<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  getConfigParamCatalogApi,
  downloadWorkspaceAllFileApi,
  downloadWorkspaceFileApi,
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
import {
  SettingsWorkspaceLayout,
  WorkspaceResourcePanel,
  WorkspaceEditorPanel,
  WorkspaceResetDialog,
} from "./components";

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
const editorActions = computed(() => [
  {
    command: "download",
    label: translate("settings.download"),
    className: "dark-btn noobot-flat-soft-btn",
    disabled: !activePath.value,
  },
  {
    command: "save",
    label: translate("settings.save"),
    type: "primary",
    className: "primary-btn",
    loading: saving.value,
    disabled: !activePath.value || !isTextFile.value,
  },
]);
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

function parseContentDisposition(contentDisposition = "") {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(String(utf8Match[1]).trim());
    } catch {
      return String(utf8Match[1]).trim();
    }
  }
  const basicMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  return String(basicMatch?.[1] || "").trim();
}

async function triggerBlobDownload(blob, fileName = "download") {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = String(fileName || "download");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
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

async function downloadFile() {
  if (!props.connected || !activePath.value || !props.userId || !props.apiKey) return;
  try {
    const response =
      activePathSource.value === "all"
        ? await downloadWorkspaceAllFileApi(
            { path: activePath.value },
            { fetcher: authFetch },
          )
        : await downloadWorkspaceFileApi(
            { userId: props.userId, path: activePath.value },
            { fetcher: authFetch },
          );
    if (!response?.ok) {
      let errorText = translate("settings.readFileFailed");
      try {
        const data = await response.json();
        if (data?.error) errorText = String(data.error);
      } catch {}
      throw new Error(errorText);
    }
    const fileName =
      parseContentDisposition(response.headers?.get("content-disposition") || "") ||
      String(activePath.value || "").split("/").pop() ||
      "download";
    const blob = await response.blob();
    await triggerBlobDownload(blob, fileName);
  } catch (error) {
    ElMessage.error(error.message || translate("settings.readFileFailed"));
  }
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
  const textarea = editorInputRef.value?.textarea || editorInputRef.value?.getTextarea?.() || null;
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
  <SettingsWorkspaceLayout>
    <WorkspaceResourcePanel
      v-model:active-resource-section="activeResourceSection"
      :tree="tree"
      :all-workspace-tree="allWorkspaceTree"
      :system-param-tree-data="systemParamTreeData"
      :user-param-tree-data="userParamTreeData"
      :loading-tree="loadingTree"
      :loading-all-tree="loadingAllTree"
      :loading-system-param-catalog="loadingSystemParamCatalog"
      :loading-user-param-catalog="loadingUserParamCatalog"
      :loading-file="loadingFile"
      :saving="saving"
      :resetting="resetting"
      :syncing="syncing"
      :syncing-all="syncingAll"
      :resetting-all="resettingAll"
      :connected="connected"
      :is-super-admin="isSuperAdmin"
      :translate="translate"
      @refresh="refreshAll"
      @sync-workspace="syncWorkspace"
      @reset-workspace="resetWorkspace"
      @sync-all-workspace="syncAllWorkspace"
      @reset-all-workspace="resetAllWorkspace"
      @open-file="openFile"
      @insert-param="insertParamAtCursor"
    />

    <WorkspaceEditorPanel
      ref="editorInputRef"
      v-model:content="content"
      :active-path="activePath"
      :active-path-source="activePathSource"
      :is-text-file="isTextFile"
      :loading-file="loadingFile"
      :editor-actions="editorActions"
      :translate="translate"
      @editor-action="handleEditorAction"
    />

    <WorkspaceResetDialog
      v-model:visible="resetDialogVisible"
      v-model:sections="resetDialogSections"
      :title="resetDialogTitle"
      :section-options="RESET_SECTION_OPTIONS"
      :confirm-loading="resetDialogConfirmLoading"
      :translate="translate"
      @select-all="selectAllResetSections"
      @clear-all="clearAllResetSections"
      @confirm="confirmResetDialog"
    />
  </SettingsWorkspaceLayout>
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

/* 空状态/二进制文件提示 */
.empty-tip :deep(.el-empty__description p) {
  color: var(--noobot-text-muted);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .workspace-layout {
    overflow: visible;
  }

}
</style>
