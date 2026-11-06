<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch, onBeforeUnmount } from "vue";
import {
  createFilePreviewState,
  readFilePreviewBlob,
} from "../../../shared/composables/useFilePreview.js";
import { assertPreviewResourceReference } from "@noobot/attachment-protocol/preview";
import { authenticatedResourceAccess } from "../../../infrastructure/http/authenticatedHttpService.js";
import { ElMessage } from "element-plus";
import {
  getConfigParamCatalogApi,
  buildWorkspacePreviewUrl,
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
} from "../../../infrastructure/api/chat/chatApi.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { saveFileBlob } from "../../../infrastructure/downloads/fileDownloadService.js";
import { parseContentDisposition } from "../../chat/composables/message/useMessagePreview/path-utils.js";
import {
  SettingsWorkspaceLayout,
  WorkspaceResourcePanel,
  WorkspaceEditorPanel,
  WorkspaceResetDialog,
} from "../public-api.js";
import { text, isFunction } from "@noobot/shared/value";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";

const props = defineProps({
  userId: { type: String, default: "" },
  fetcher: { type: Function, required: true },
  connected: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  isSuperAdmin: { type: Boolean, default: false },
});
const emit = defineEmits(["workspace-reset"]);

const tree = ref([]);
const allWorkspaceTree = ref([]);
const loadingTree = ref(false);
const loadingAllTree = ref(false);
const saving = ref(false);
const resetting = ref(false);
const syncing = ref(false);
const syncingAll = ref(false);
const resettingAll = ref(false);
const activePath = ref("");
const activePathSource = ref("user");
const activePathType = ref("");
const filePreview = createFilePreviewState();
const {
  descriptor: previewDescriptor,
  url: previewUrl,
  error: previewError,
  loading: loadingFile,
  textContent: content,
  editable: isTextFile,
} = filePreview.state;
const clearFilePreview = filePreview.reset;
onBeforeUnmount(clearFilePreview);
const editorInputRef = ref(null);
const systemParamCatalog = ref([]);
const userParamCatalog = ref([]);
const loadingSystemParamCatalog = ref(false);
const loadingUserParamCatalog = ref(false);
const activeResourceSection = ref("directory");
const resetDialogVisible = ref(false);
const resetDialogMode = ref("user");
const resetDialogSections = ref([]);
const loadedSections = new Set();
const pendingSections = new Map();
let resourceGeneration = 0;
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
  resetDialogMode.value === "all"
    ? translate("settings.resetAllWorkspaceTitle")
    : translate("settings.resetWorkspaceTitle"),
);
const resetDialogConfirmLoading = computed(() => resetting.value || resettingAll.value);
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
const systemParamTreeData = computed(() => toParamTreeData(systemParamCatalog.value));
const userParamTreeData = computed(() => toParamTreeData(userParamCatalog.value));

function toParamTreeData(list = []) {
  return (list || []).map((item) => ({
    key: text(item?.key),
    label: text(item?.key),
    description: text(item?.description),
    type: "param",
  }));
}

async function loadTree() {
  if (!props.connected || !props.userId) return;
  const generation = resourceGeneration;
  loadingTree.value = true;
  try {
    const nodes = await loadTreeChildren("", "user");
    if (generation === resourceGeneration) tree.value = nodes;
  } finally {
    if (generation === resourceGeneration) loadingTree.value = false;
  }
}

async function loadAllWorkspaceTree() {
  if (!props.connected || !props.isSuperAdmin) return;
  const generation = resourceGeneration;
  loadingAllTree.value = true;
  try {
    const nodes = await loadTreeChildren("", "all");
    if (generation === resourceGeneration) allWorkspaceTree.value = nodes;
  } finally {
    if (generation === resourceGeneration) loadingAllTree.value = false;
  }
}

async function loadTreeChildren(path = "", source = "user") {
  if (!props.connected || !props.userId || (source === "all" && !props.isSuperAdmin)) {
    throw new Error(translate("settings.loadingWorkspaceFailed"));
  }
  const generation = resourceGeneration;
  const res =
    source === "all"
      ? await getWorkspaceAllTreeApi({ fetcher: props.fetcher, path })
      : await getWorkspaceTreeApi({ userId: props.userId, path }, { fetcher: props.fetcher });
  const data = await res.json();
  if (!res.ok || !data.ok)
    throw new Error(data.error || translate("settings.loadingWorkspaceFailed"));
  if (!Array.isArray(data.tree)) throw new TypeError("workspace directory response requires tree");
  return generation === resourceGeneration ? data.tree : [];
}

async function loadParamCatalog(scope = "system") {
  if (!props.connected) return;
  const generation = resourceGeneration;
  const normalizedScope = text(scope).toLowerCase() === "user" ? "user" : "system";
  const loadingCatalog =
    normalizedScope === "system" ? loadingSystemParamCatalog : loadingUserParamCatalog;
  loadingCatalog.value = true;
  try {
    const res = await getConfigParamCatalogApi({
      scope: normalizedScope,
      fetcher: props.fetcher,
    });
    const data = await res.json();
    if (!res.ok || !data.ok)
      throw new Error(data.error || translate("settings.loadingParamCatalogFailed"));
    if (!Array.isArray(data.catalog))
      throw new TypeError("parameter catalog response requires catalog");
    if (generation !== resourceGeneration) return;
    if (normalizedScope === "system") {
      systemParamCatalog.value = data.catalog;
    } else {
      userParamCatalog.value = data.catalog;
    }
  } finally {
    if (generation === resourceGeneration) loadingCatalog.value = false;
  }
}

async function refreshAll() {
  loadedSections.clear();
  await loadActiveSection();
}

async function loadActiveSection() {
  if (!props.active || !props.connected || !props.userId) return;
  const section = activeResourceSection.value;
  const loaders = {
    directory: loadTree,
    "all-workspace": props.isSuperAdmin ? loadAllWorkspaceTree : null,
    "system-params": () => loadParamCatalog("system"),
    "user-params": () => loadParamCatalog("user"),
  };
  if (!loaders[section] || loadedSections.has(section)) return;
  if (pendingSections.has(section)) return pendingSections.get(section);
  const generation = resourceGeneration;
  const pending = loaders[section]()
    .then(() => {
      if (generation === resourceGeneration) loadedSections.add(section);
    })
    .catch((error) => {
      if (generation === resourceGeneration) {
        ElMessage.error(error.message || translate("settings.loadingWorkspaceFailed"));
      }
    })
    .finally(() => {
      if (pendingSections.get(section) === pending) pendingSections.delete(section);
    });
  pendingSections.set(section, pending);
  return pending;
}

async function reloadActiveFile() {
  if (!activePath.value || activePathType.value !== "file") return;
  await openFile({ path: activePath.value, type: "file" }, activePathSource.value);
}

async function openFile(node, source = "user") {
  if (!props.connected || !node || !props.userId) return;
  const normalizedSource = source === "all" ? "all" : "user";
  const nodePath = text(node.path);
  if (!nodePath) return;
  clearFilePreview();
  activePath.value = nodePath;
  activePathSource.value = normalizedSource;
  activePathType.value = node.type;
  if (node.type !== "file") return;
  const userId = props.userId;
  await filePreview.load(async (signal) => {
    const res =
      normalizedSource === "all"
        ? await getWorkspaceAllFileApi({ path: nodePath }, { fetcher: props.fetcher, signal })
        : await getWorkspaceFileApi({ userId, path: nodePath }, { fetcher: props.fetcher, signal });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.readFileFailed"));
    assertWorkspaceFileResponse(data);
    const descriptor = data.preview;
    return {
      descriptor,
      readText: async () => data.content,
      editable: data.isText === true,
      authorizeResource: (resourceSignal) =>
        authenticatedResourceAccess(
          buildWorkspacePreviewUrl({ userId, path: nodePath, source: normalizedSource }),
          resourceSignal,
        ),
    };
  });
}

function assertWorkspaceFileResponse(data) {
  if (
    !data.preview ||
    ![true, false, null].includes(data.isText) ||
    typeof data.content !== "string"
  )
    throw new TypeError("Invalid workspace file response");
}

function fetchWorkspaceBlob(path, source, signal) {
  return source === "all"
    ? downloadWorkspaceAllFileApi({ path }, { fetcher: props.fetcher, signal })
    : downloadWorkspaceFileApi({ userId: props.userId, path }, { fetcher: props.fetcher, signal });
}

async function resolvePreviewResource(reference, signal, stylesheet, { maxBytes, onBytes }) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !isFunction(onBytes))
    throw new TypeError("FILE_PREVIEW_RESOURCE_BUDGET_INVALID");
  assertPreviewResourceReference(reference);
  const root = new URL("https://workspace.invalid/");
  const documentUrl = new URL(activePath.value, root);
  const base = stylesheet ? new URL(stylesheet, documentUrl) : documentUrl;
  const resource = new URL(reference, base);
  if (resource.origin !== root.origin) throw new Error("FILE_PREVIEW_RESOURCE_OUT_OF_SCOPE");
  const filePath = decodeURIComponent(
    activePath.value.startsWith("/") ? resource.pathname : resource.pathname.slice(1),
  );
  const response = await fetchWorkspaceBlob(filePath, activePathSource.value, signal);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${reference}`);
  return readFilePreviewBlob(response, maxBytes, onBytes);
}

async function saveFile() {
  if (!props.connected || !activePath.value || !props.userId || !isTextFile.value) return;
  saving.value = true;
  try {
    const res =
      activePathSource.value === "all"
        ? await putWorkspaceAllFileApi(
            {
              path: activePath.value,
              content: content.value,
            },
            { fetcher: props.fetcher },
          )
        : await putWorkspaceFileApi(
            {
              userId: props.userId,
              path: activePath.value,
              content: content.value,
            },
            { fetcher: props.fetcher },
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
  if (!props.connected || !activePath.value || !props.userId) return;
  try {
    const response =
      activePathSource.value === "all"
        ? await downloadWorkspaceAllFileApi({ path: activePath.value }, { fetcher: props.fetcher })
        : await downloadWorkspaceFileApi(
            { userId: props.userId, path: activePath.value },
            { fetcher: props.fetcher },
          );
    if (!response.ok) await readApiResponseEnvelope(response);
    const fileName =
      parseContentDisposition(response.headers?.get("content-disposition") || "") ||
      String(activePath.value || "")
        .split("/")
        .pop() ||
      "download";
    const blob = await response.blob();
    await saveFileBlob(blob, fileName);
  } catch (error) {
    ElMessage.error(error.message || translate("settings.readFileFailed"));
  }
}

async function resetWorkspace() {
  if (!props.connected || !props.userId) return;
  openResetDialog("user");
}

async function doResetWorkspace(sections = []) {
  clearFilePreview();
  resetting.value = true;
  try {
    const res = await postResetWorkspaceApi(
      { userId: props.userId, sections },
      { fetcher: props.fetcher },
    );
    const data = await res.json();
    if (!res.ok || !data.ok)
      throw new Error(data.error || translate("settings.resetWorkspaceFailed"));
    activePath.value = "";
    activePathSource.value = "user";
    activePathType.value = "";
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
  if (!props.connected || !props.userId) return;
  syncing.value = true;
  try {
    const res = await postSyncWorkspaceApi({ userId: props.userId }, { fetcher: props.fetcher });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.syncConfigFailed"));
    await refreshAll();
    await reloadActiveFile();
    ElMessage.success(translate("settings.syncDone"));
  } catch (error) {
    ElMessage.error(error.message || translate("settings.syncConfigFailed"));
  } finally {
    syncing.value = false;
  }
}

async function syncAllWorkspace() {
  if (!props.connected || !props.isSuperAdmin) return;
  syncingAll.value = true;
  try {
    const res = await postSyncAllWorkspaceApi({ fetcher: props.fetcher });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.syncAllFailed"));
    await refreshAll();
    await reloadActiveFile();
    ElMessage.success(
      translate("settings.syncDoneWithCount", {
        success: Number(data.success || 0),
        total: Number(data.total || 0),
      }),
    );
  } catch (error) {
    ElMessage.error(error.message || translate("settings.syncAllFailed"));
  } finally {
    syncingAll.value = false;
  }
}

async function resetAllWorkspace() {
  if (!props.connected || !props.isSuperAdmin) return;
  openResetDialog("all");
}

async function doResetAllWorkspace(sections = []) {
  clearFilePreview();
  resettingAll.value = true;
  try {
    const res = await postResetAllWorkspaceApi({ sections }, { fetcher: props.fetcher });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || translate("settings.resetAllFailed"));
    activePath.value = "";
    activePathSource.value = "user";
    activePathType.value = "";
    await refreshAll();
    ElMessage.success(
      translate("settings.resetDoneWithCount", {
        success: Number(data.success || 0),
        total: Number(data.total || 0),
      }),
    );
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
  if (resetDialogMode.value === "all") {
    await doResetAllWorkspace(sections);
    return;
  }
  await doResetWorkspace(sections);
}

async function insertParamAtCursor(key = "") {
  const normalizedKey = text(key);
  if (!normalizedKey) return;
  if (!activePath.value || !isTextFile.value) {
    ElMessage.warning(translate("settings.selectEditableTextFile"));
    return;
  }
  const token = `\${${normalizedKey}}`;
  await nextTick();
  const textarea = await editorInputRef.value?.getTextarea();
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
  [() => props.userId, () => props.connected, () => props.isSuperAdmin],
  () => {
    resourceGeneration += 1;
    clearFilePreview();
    activePath.value = "";
    loadedSections.clear();
    pendingSections.clear();
    tree.value = [];
    allWorkspaceTree.value = [];
    systemParamCatalog.value = [];
    userParamCatalog.value = [];
    loadingTree.value = false;
    loadingAllTree.value = false;
    loadingSystemParamCatalog.value = false;
    loadingUserParamCatalog.value = false;
    if (!props.isSuperAdmin && activeResourceSection.value === "all-workspace") {
      activeResourceSection.value = "directory";
    }
  },
  { flush: "sync" },
);

watch(
  [
    () => props.active,
    () => props.connected,
    () => props.userId,
    () => props.isSuperAdmin,
    activeResourceSection,
  ],
  loadActiveSection,
  { immediate: true },
);
</script>

<template>
  <SettingsWorkspaceLayout>
    <WorkspaceResourcePanel
      v-model:active-resource-section="activeResourceSection"
      :tree="tree"
      :load-tree-children="loadTreeChildren"
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
      :active-path-type="activePathType"
      :preview-descriptor="previewDescriptor"
      :preview-url="previewUrl"
      :preview-error="previewError"
      :resolve-resource="resolvePreviewResource"
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
.workspace-layout {
  overflow: hidden;
}

@media (max-width: 768px) {
  .workspace-layout {
    overflow: visible;
  }
}
</style>
