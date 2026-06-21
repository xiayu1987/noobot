<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { ElMessage } from "element-plus";
import { getWorkflowSessionDetailApi } from "../../../../client/noobot-chat/src/services/api/chatApi";
import { applyCompletedToolLogsToMessages } from "../../../../client/noobot-chat/src/composables/infra/sessionToolLogs";
import { buildViewMessage, foldConversationMessages } from "../../../../client/noobot-chat/src/composables/infra/messageModel";
import { useWorkflowLocale } from "../i18n";
import {
  BaseEmptyHint,
  BaseMessageErrorAlert,
} from "../../../../client/noobot-chat/src/shared/ui";
import { WorkflowCanvasGraph } from "./workflow-graph";
import WorkflowSessionMessageItem from "./WorkflowSessionMessageItem.vue";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, default: (value = 0) => `${Number(value || 0)} B` },
  isImageMime: { type: Function, default: (mimeType = "") => String(mimeType || "").startsWith("image/") },
});
const emit = defineEmits(["open-thinking-details"]);
const { translate } = useWorkflowLocale();

const viewerVisible = ref(false);
const viewerLoading = ref(false);
const viewerError = ref("");
const selectedNode = ref(null);
const selectedNodeMessages = ref([]);
const selectedNodeSessionId = ref("");
const selectedGraphDialogId = ref("");
const semanticPreviewExpanded = ref(false);
const applyingWorkflowDrawerHistory = ref(false);

const PSEUDO_ROUTE_PANEL_KEY = "panel";
const PSEUDO_ROUTE_WORKFLOW_PANEL = "workflow-node-session";
const PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY = "workflowDialogId";
const PSEUDO_ROUTE_WORKFLOW_ROOT_KEY = "workflowRootSessionId";

function handleOpenThinkingDetails(payload = {}) {
  emit("open-thinking-details", payload);
}

const workflowMeta = computed(() =>
  props.messageItem?.pluginMeta &&
  typeof props.messageItem.pluginMeta === "object" &&
  !Array.isArray(props.messageItem.pluginMeta)
    ? props.messageItem.pluginMeta
    : {},
);

function unquoteWorkflowDslValue(value = "") {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

function parseWorkflowDslAttributes(line = "") {
  const attrs = {};
  const pattern = /(\w+)=("[^"]*"|\S+)/g;
  let match = pattern.exec(String(line || ""));
  while (match) {
    attrs[match[1]] = unquoteWorkflowDslValue(match[2]);
    match = pattern.exec(String(line || ""));
  }
  return attrs;
}

function normalizeDslStateType(value = "", nodeId = "") {
  const normalized = String(value || nodeId || "").trim().toLowerCase();
  if (normalized === "start") return 0;
  if (normalized === "end") return 1;
  if (normalized === "branch") return 2;
  if (normalized === "merge") return 3;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseWorkflowDslPayload(content = "") {
  const text = String(content || "").trim();
  if (!text.startsWith("WORKFLOW_DSL/")) return null;
  const nodes = [];
  const flowtos = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("WORKFLOW_DSL/") || line === "END") continue;
    if (line.startsWith("NODE ")) {
      const attrs = parseWorkflowDslAttributes(line);
      const id = String(attrs.id || "").trim();
      const type = String(attrs.type || "").trim();
      if (!id || !type) continue;
      nodes.push({
        id,
        type,
        name: String(attrs.name || id).trim(),
        task: String(attrs.task || "").trim(),
        ...(type.toLowerCase() === "state"
          ? { stateType: normalizeDslStateType(attrs.stateType, id) }
          : {}),
      });
    } else if (line.startsWith("EDGE ")) {
      const attrs = parseWorkflowDslAttributes(line);
      const from = String(attrs.from || "").trim();
      const to = String(attrs.to || "").trim();
      if (from && to) flowtos.push({ from, to });
    }
  }
  if (!nodes.length) return null;
  return {
    semantic: { nodes, flowtos },
    interaction: { semanticTextPreview: text },
  };
}

const workflowPayload = computed(() =>
  workflowMeta.value?.payload &&
  typeof workflowMeta.value.payload === "object" &&
  !Array.isArray(workflowMeta.value.payload)
    ? workflowMeta.value.payload
    : parseWorkflowDslPayload(props.messageItem?.content) || {},
);

const nodeSessions = computed(() => {
  const fromPayload = Array.isArray(workflowPayload.value?.nodeSessions)
    ? workflowPayload.value.nodeSessions
    : [];
  return fromPayload;
});

function makeNodeSessionFromRun(item = {}) {
  const step = item?.step && typeof item.step === "object" ? item.step : {};
  return {
    transition: Number(item?.transition || 0),
    nodeName: String(step?.nodeName || item?.nodeName || "").trim(),
    nodeId: String(step?.nodeId || item?.nodeId || "").trim(),
    nodeType: Number.isFinite(Number(step?.nodeType ?? item?.nodeType))
      ? Number(step?.nodeType ?? item?.nodeType)
      : undefined,
    actionNodeStateId: String(item?.actionNodeStateId || step?.actionNodeStateId || "").trim(),
    stepId: String(item?.stepId || step?.stepId || "").trim(),
    stepIndex: Number.isFinite(Number(item?.stepIndex ?? step?.stepIndex))
      ? Number(item?.stepIndex ?? step?.stepIndex)
      : undefined,
    type: String(step?.type || item?.type || "").trim(),
    stateType: Number.isFinite(Number(step?.stateType ?? item?.stateType))
      ? Number(step?.stateType ?? item?.stateType)
      : undefined,
    rootSessionId: String(
      item?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
    dialogId: String(item?.nodeDialogId || item?.dialogId || "").trim(),
    sessionId: String(item?.nodeSessionId || item?.sessionId || "").trim(),
    transferEnvelopes: Array.isArray(item?.nodeResultTransferEnvelopes)
      ? item.nodeResultTransferEnvelopes
      : Array.isArray(item?.transferEnvelopes)
        ? item.transferEnvelopes
        : [],
    ...(item?.nodeResultTransferResult && typeof item.nodeResultTransferResult === "object"
      ? { transferResult: item.nodeResultTransferResult }
      : item?.transferResult && typeof item.transferResult === "object"
        ? { transferResult: item.transferResult }
        : {}),
    stepStatus: String(item?.stepStatus || item?.status || "").trim(),
    stepFailure:
      item?.stepFailure && typeof item.stepFailure === "object"
        ? item.stepFailure
        : null,
    parallelWave: Number(item?.parallelWave || 0),
    waveOrder: Number(item?.waveOrder || 0),
  };
}

function makeRuntimeEntryKey(item = {}) {
  return String(
    item?.dialogId ||
      item?.nodeDialogId ||
      item?.sessionId ||
      item?.nodeSessionId ||
      item?.stepId ||
      item?.actionNodeStateId ||
      "",
  ).trim();
}

const runtimeNodeSessions = computed(() => {
  const entries = [];
  const entryIndexByKey = new Map();
  const rememberEntryKeys = (item = {}, index = entries.length - 1) => {
    const keys = [
      item?.dialogId,
      item?.nodeDialogId,
      item?.sessionId,
      item?.nodeSessionId,
      item?.stepId,
      item?.actionNodeStateId,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const key of keys) {
      if (!entryIndexByKey.has(key)) entryIndexByKey.set(key, index);
    }
  };
  const mergeRuntimeEntry = (base = {}, fallback = {}) => ({
    ...fallback,
    ...base,
    stepStatus: String(base?.stepStatus || base?.status || fallback?.stepStatus || fallback?.status || "").trim(),
    stepFailure:
      base?.stepFailure && typeof base.stepFailure === "object"
        ? base.stepFailure
        : fallback?.stepFailure && typeof fallback.stepFailure === "object"
          ? fallback.stepFailure
          : null,
  });
  for (const item of nodeSessions.value) {
    entries.push(item);
    rememberEntryKeys(item, entries.length - 1);
  }
  const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
    ? executionMeta.value.nodeAgentRuns
    : [];
  for (const runItem of runs) {
    const fallback = makeNodeSessionFromRun(runItem);
    if (!fallback.dialogId && !fallback.sessionId && !fallback.stepId) continue;
    const key = makeRuntimeEntryKey(fallback);
    if (key && entryIndexByKey.has(key)) {
      const index = entryIndexByKey.get(key);
      entries[index] = mergeRuntimeEntry(entries[index], fallback);
      rememberEntryKeys(entries[index], index);
      continue;
    }
    entries.push(fallback);
    rememberEntryKeys(fallback, entries.length - 1);
  }
  return entries;
});

const semanticFlowtos = computed(() =>
  Array.isArray(workflowPayload.value?.semantic?.flowtos)
    ? workflowPayload.value.semantic.flowtos
    : [],
);

const semanticNodeMap = computed(() => {
  const map = new Map();
  const nodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
    ? workflowPayload.value.semantic.nodes
    : [];
  for (const nodeItem of nodes) {
    const id = String(nodeItem?.id || "").trim();
    const name = String(nodeItem?.name || "").trim();
    if (id) map.set(`id:${id}`, nodeItem);
    if (name) map.set(`name:${name}`, nodeItem);
  }
  return map;
});

const executionMeta = computed(() =>
  workflowPayload.value?.execution &&
  typeof workflowPayload.value.execution === "object" &&
  !Array.isArray(workflowPayload.value.execution)
    ? workflowPayload.value.execution
    : {},
);

const nodeRunByDialogId = computed(() => {
  const map = new Map();
  const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
    ? executionMeta.value.nodeAgentRuns
    : [];
  for (const runItem of runs) {
    const dialogIds = [runItem?.nodeDialogId, runItem?.dialogId]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const dialogId of dialogIds) map.set(dialogId, runItem);
  }
  return map;
});

function normalizeStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "error") return "failed";
  if (status === "done" || status === "completed") return "success";
  return status;
}

function resolveStepStatus(stepItem = {}) {
  const failure = stepItem?.stepFailure;
  if (failure && typeof failure === "object") {
    if (String(failure?.message || failure?.error || "").trim()) return "failed";
  } else if (String(failure || "").trim()) {
    return "failed";
  }
  const explicit = normalizeStatus(stepItem?.stepStatus || stepItem?.status || stepItem?._status || "");
  if (explicit) return explicit;
  const dialogId = String(stepItem?.dialogId || "").trim();
  const runItem = dialogId ? nodeRunByDialogId.value.get(dialogId) : null;
  if (runItem?.stepFailure) return "failed";
  const runStatus = normalizeStatus(runItem?.stepStatus || runItem?.status || "");
  if (runStatus) return runStatus;
  if (String(stepItem?.sessionId || "").trim() || dialogId) return "success";
  return "pending";
}

function resolveActionRuntimeStatus(actionNodeStates = []) {
  const steps = [];
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) steps.push(stepItem);
  }
  if (!steps.length) return "pending";
  const statuses = steps.map((stepItem) => resolveStepStatus(stepItem));
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.some((status) => status === "failed" || status === "error")) return "failed";
  if (statuses.every((status) => status === "success")) return "success";
  if (statuses.some((status) => status === "success")) return "success";
  return "pending";
}

function makeRuntimeStep(item = {}, index = 0) {
  const dialogId = String(item?.dialogId || "").trim();
  const runItem = dialogId ? nodeRunByDialogId.value.get(dialogId) : null;
  const stepId = String(item?.stepId || runItem?.stepId || dialogId || item?.sessionId || `step_${index + 1}`).trim();
  const stepIndex = Number.isFinite(Number(item?.stepIndex ?? runItem?.stepIndex))
    ? Number(item?.stepIndex ?? runItem?.stepIndex)
    : index;
  const merged = {
    ...runItem,
    ...item,
    dialogId,
    stepId,
    stepIndex,
    rootSessionId: String(
      item?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
  };
  return {
    ...merged,
    _boxType: "step",
    _status: resolveStepStatus(merged),
  };
}

function makeActionStateKey(item = {}, index = 0) {
  return String(
    item?.actionNodeStateId ||
      item?.nodeStateId ||
      item?.actionStateId ||
      item?.nodeBoxId ||
      item?.dialogId ||
      item?.sessionId ||
      `node_box_${index + 1}`,
  ).trim();
}

const actionRuntimeBySemanticKey = computed(() => {
  const map = new Map();
  const ensureNodeRuntime = (item = {}) => {
    const nodeId = String(item?.nodeId || "").trim();
    const nodeName = String(item?.nodeName || "").trim();
    const primaryKey = nodeId ? `id:${nodeId}` : nodeName ? `name:${nodeName}` : "";
    if (!primaryKey) return null;
    if (!map.has(primaryKey)) {
      const runtime = {
        nodeId,
        nodeName,
        actionNodeStates: [],
        _stateMap: new Map(),
      };
      map.set(primaryKey, runtime);
      if (nodeId) map.set(`id:${nodeId}`, runtime);
      if (nodeName) map.set(`name:${nodeName}`, runtime);
    }
    return map.get(primaryKey);
  };

  runtimeNodeSessions.value.forEach((item = {}, index) => {
    const runtime = ensureNodeRuntime(item);
    if (!runtime) return;
    const stateKey = makeActionStateKey(item, index);
    if (!runtime._stateMap.has(stateKey)) {
      runtime._stateMap.set(stateKey, {
        actionNodeStateId: stateKey,
        nodeId: String(item?.nodeId || runtime.nodeId || "").trim(),
        nodeName: String(item?.nodeName || runtime.nodeName || "").trim(),
        steps: [],
      });
      runtime.actionNodeStates.push(runtime._stateMap.get(stateKey));
    }
    runtime._stateMap.get(stateKey).steps.push(makeRuntimeStep(item, index));
  });

  for (const runtime of new Set(map.values())) {
    runtime.actionNodeStates.sort((left, right) => {
      const leftOrder = Number(left?.steps?.[0]?.transition ?? left?.steps?.[0]?.stepIndex ?? 0);
      const rightOrder = Number(right?.steps?.[0]?.transition ?? right?.steps?.[0]?.stepIndex ?? 0);
      return leftOrder - rightOrder;
    });
    for (const stateBox of runtime.actionNodeStates) {
      stateBox.steps.sort((left, right) => Number(left?.stepIndex || 0) - Number(right?.stepIndex || 0));
    }
  }
  return map;
});


function resolveNodeStatus(nodeItem = {}) {
  const explicit = normalizeStatus(nodeItem?.status || nodeItem?._status || "");
  if (explicit) return explicit;
  const runtimeStatus = resolveActionRuntimeStatus(nodeItem?.actionNodeStates || []);
  if (runtimeStatus !== "pending") return runtimeStatus;
  const completed = executionMeta.value?.completed === true;
  if (completed) return "success";
  const workflowFailed = String(workflowPayload.value?.status || "").trim().toLowerCase() === "failed";
  const dialogId = String(nodeItem?.dialogId || "").trim();
  const hasRunRecord = dialogId && nodeRunByDialogId.value.has(dialogId);
  if (hasRunRecord) return "success";
  if (workflowFailed) return "failed";
  return "pending";
}

function stripRuntimeInternal(runtime = {}) {
  return {
    nodeId: String(runtime?.nodeId || "").trim(),
    nodeName: String(runtime?.nodeName || "").trim(),
    actionNodeStates: Array.isArray(runtime?.actionNodeStates)
      ? runtime.actionNodeStates.map((stateBox = {}, stateIndex) => ({
          actionNodeStateId: String(stateBox?.actionNodeStateId || `node_box_${stateIndex + 1}`).trim(),
          nodeId: String(stateBox?.nodeId || runtime?.nodeId || "").trim(),
          nodeName: String(stateBox?.nodeName || runtime?.nodeName || "").trim(),
          steps: Array.isArray(stateBox?.steps) ? stateBox.steps : [],
        }))
      : [],
  };
}

function firstRuntimeStep(actionNodeStates = []) {
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    const stepItem = Array.isArray(stateBox?.steps) ? stateBox.steps[0] : null;
    if (stepItem) return stepItem;
  }
  return null;
}

function buildFlowNodeFromRuntime(runtime = {}, index = 0) {
  const cleanRuntime = stripRuntimeInternal(runtime);
  const firstStep = firstRuntimeStep(cleanRuntime.actionNodeStates) || {};
  const semanticNode =
    semanticNodeMap.value.get(`id:${cleanRuntime.nodeId}`) ||
    semanticNodeMap.value.get(`name:${cleanRuntime.nodeName}`) ||
    null;
  return {
    ...firstStep,
    nodeId: cleanRuntime.nodeId || String(firstStep?.nodeId || "").trim(),
    nodeName: cleanRuntime.nodeName || String(firstStep?.nodeName || firstStep?.nodeId || "").trim(),
    nodeType: 2,
    type: String(firstStep?.type || semanticNode?.type || "action").trim(),
    stateType: Number.isFinite(Number(firstStep?.stateType))
      ? Number(firstStep.stateType)
      : Number.isFinite(Number(semanticNode?.stateType))
        ? Number(semanticNode.stateType)
        : undefined,
    actionNodeStates: cleanRuntime.actionNodeStates,
    runtimeBoxes: cleanRuntime.actionNodeStates,
    status: resolveActionRuntimeStatus(cleanRuntime.actionNodeStates),
    _order: Number.isFinite(Number(firstStep?.transition)) ? Number(firstStep.transition) : index + 1,
  };
}

function buildFlowNodeFromSemantic(nodeItem = {}, index = 0) {
  const nodeId = String(nodeItem?.id || "").trim();
  const nodeName = String(nodeItem?.name || nodeId || "").trim();
  const matchedRuntime =
    actionRuntimeBySemanticKey.value.get(`id:${nodeId}`) ||
    actionRuntimeBySemanticKey.value.get(`name:${nodeName}`) ||
    null;
  const cleanRuntime = matchedRuntime ? stripRuntimeInternal(matchedRuntime) : { actionNodeStates: [] };
  const firstStep = firstRuntimeStep(cleanRuntime.actionNodeStates) || {};
  const completed = executionMeta.value?.completed === true;
  const nodeType = String(nodeItem?.type || "").trim().toLowerCase();
  const isAction = nodeType === "action";
  const runtimeStatus = resolveActionRuntimeStatus(cleanRuntime.actionNodeStates);
  const restoredStatus = isAction
    ? runtimeStatus !== "pending"
      ? runtimeStatus
      : completed
        ? "success"
        : "pending"
    : completed
      ? "success"
      : "pending";
  return {
    ...firstStep,
    nodeId,
    nodeName,
    nodeType: isAction ? 2 : 0,
    type: String(nodeItem?.type || "").trim(),
    stateType: Number.isFinite(Number(nodeItem?.stateType))
      ? Number(nodeItem.stateType)
      : undefined,
    rootSessionId: String(
      firstStep?.rootSessionId ||
        workflowPayload.value?.planningDialog?.sessionId ||
        workflowPayload.value?.runMeta?.sessionId ||
        "",
    ).trim(),
    actionNodeStates: isAction ? cleanRuntime.actionNodeStates : [],
    runtimeBoxes: isAction ? cleanRuntime.actionNodeStates : [],
    status: restoredStatus,
    _order: Number.isFinite(Number(firstStep?.transition))
      ? Number(firstStep.transition)
      : index + 1,
  };
}

const flowNodes = computed(() => {
  const semanticNodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
    ? workflowPayload.value.semantic.nodes
    : [];
  if (semanticNodes.length) {
    return semanticNodes
      .map((item, index) => buildFlowNodeFromSemantic(item, index))
      .sort((left, right) => Number(left?._order || 0) - Number(right?._order || 0));
  }
  const uniqueRuntimes = Array.from(new Set(actionRuntimeBySemanticKey.value.values()));
  return uniqueRuntimes
    .map((runtime, index) => buildFlowNodeFromRuntime(runtime, index))
    .sort((left, right) => Number(left?._order || 0) - Number(right?._order || 0));
});

const semanticPreview = computed(
  () =>
    String(
      workflowMeta.value?.semanticTextPreview ||
        workflowPayload.value?.interaction?.semanticTextPreview ||
        props.messageItem?.content ||
        "",
    ).trim(),
);

const semanticPreviewLineCount = computed(() =>
  String(semanticPreview.value || "").split(/\r?\n/).length,
);

const semanticPreviewCollapsible = computed(
  () => semanticPreviewLineCount.value > 8 || String(semanticPreview.value || "").length > 900,
);

function normalizeNodeMessageForDisplay(messageItem = {}) {
  const item = messageItem && typeof messageItem === "object" ? messageItem : {};
  return {
    ...item,
    pluginMessage: false,
    content: String(item?.content || ""),
  };
}

function buildNodeViewMessage(messageItem = {}) {
  return normalizeNodeMessageForDisplay(
    buildViewMessage(messageItem, {
      userId: props.userId,
      isImageMime: props.isImageMime,
    }),
  );
}

const selectedNodeSessionDocs = computed(() => {
  const sessionId = String(selectedNodeSessionId.value || selectedNode.value?.sessionId || "").trim();
  if (!sessionId) return [];
  return [
    {
      sessionId,
      parentSessionId: String(selectedNode.value?.rootSessionId || "").trim(),
      caller: "bot",
      depth: 1,
      messages: Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : [],
    },
  ];
});

const rawNodeSessionMessages = computed(() =>
  (Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : []).map(
    (messageItem = {}) => buildNodeViewMessage(messageItem),
  ),
);

const normalizedNodeSessionMessages = computed(() => {
  const sessionDocs = selectedNodeSessionDocs.value;
  const mainSessionDoc = sessionDocs[0] || {};
  const foldedMessages = foldConversationMessages(
    Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages : [],
    buildNodeViewMessage,
  );
  applyCompletedToolLogsToMessages(foldedMessages, sessionDocs);
  return foldedMessages;
});

const displayNodeMessages = computed(() =>
  (Array.isArray(normalizedNodeSessionMessages.value)
    ? normalizedNodeSessionMessages.value
    : []
  ).map((messageItem = {}) => normalizeNodeMessageForDisplay(messageItem)),
);

const nodeSessionAllMessages = computed(() =>
  Array.isArray(rawNodeSessionMessages.value) ? rawNodeSessionMessages.value : [],
);

function buildWorkflowDrawerRoute(nodeItem = {}, patch = {}) {
  const dialogId = String(
    Object.prototype.hasOwnProperty.call(patch, "dialogId")
      ? patch.dialogId
      : nodeItem?.dialogId || "",
  ).trim();
  const rootSessionId = String(
    Object.prototype.hasOwnProperty.call(patch, "rootSessionId")
      ? patch.rootSessionId
      : nodeItem?.rootSessionId ||
          workflowPayload.value?.planningDialog?.sessionId ||
          workflowPayload.value?.runMeta?.sessionId ||
          "",
  ).trim();
  return { dialogId, rootSessionId };
}

function writeWorkflowDrawerHistory(route = {}, { mode = "replace" } = {}) {
  const dialogId = String(route?.dialogId || "").trim();
  const rootSessionId = String(route?.rootSessionId || "").trim();
  const params = new URLSearchParams(window.location.search || "");
  if (dialogId && rootSessionId) {
    params.set(PSEUDO_ROUTE_PANEL_KEY, PSEUDO_ROUTE_WORKFLOW_PANEL);
    params.set(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY, dialogId);
    params.set(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY, rootSessionId);
  } else if (params.get(PSEUDO_ROUTE_PANEL_KEY) === PSEUDO_ROUTE_WORKFLOW_PANEL) {
    params.delete(PSEUDO_ROUTE_PANEL_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY);
    params.delete(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  const nextState = {
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    noobotWorkflowNodeSession:
      dialogId && rootSessionId ? { dialogId, rootSessionId } : null,
  };
  if (mode === "push") {
    history.pushState(nextState, "", nextUrl);
    return;
  }
  history.replaceState(nextState, "", nextUrl);
}

function pushWorkflowDrawerHistory(route = {}) {
  if (applyingWorkflowDrawerHistory.value) return;
  writeWorkflowDrawerHistory(route, { mode: "push" });
}

function replaceWorkflowDrawerHistory(route = {}) {
  if (applyingWorkflowDrawerHistory.value) return;
  writeWorkflowDrawerHistory(route, { mode: "replace" });
}

function parseWorkflowDrawerRoute(eventState = null) {
  const routeFromState =
    eventState && typeof eventState === "object"
      ? eventState.noobotWorkflowNodeSession
      : null;
  if (routeFromState && typeof routeFromState === "object") {
    const dialogId = String(routeFromState?.dialogId || "").trim();
    const rootSessionId = String(routeFromState?.rootSessionId || "").trim();
    if (dialogId && rootSessionId) return { dialogId, rootSessionId };
  }
  const params = new URLSearchParams(window.location.search || "");
  if (params.get(PSEUDO_ROUTE_PANEL_KEY) !== PSEUDO_ROUTE_WORKFLOW_PANEL) {
    return { dialogId: "", rootSessionId: "" };
  }
  return {
    dialogId: String(params.get(PSEUDO_ROUTE_WORKFLOW_DIALOG_KEY) || "").trim(),
    rootSessionId: String(params.get(PSEUDO_ROUTE_WORKFLOW_ROOT_KEY) || "").trim(),
  };
}

function collectWorkflowSessionTargets() {
  const targets = [];
  for (const nodeItem of Array.isArray(flowNodes.value) ? flowNodes.value : []) {
    if (nodeItem?.dialogId) targets.push(nodeItem);
    for (const stateBox of Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []) {
      for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
        if (stepItem?.dialogId) targets.push(stepItem);
      }
    }
  }
  return targets;
}

function findWorkflowSessionTarget(route = {}) {
  const dialogId = String(route?.dialogId || "").trim();
  const rootSessionId = String(route?.rootSessionId || "").trim();
  if (!dialogId || !rootSessionId) return null;
  return (
    collectWorkflowSessionTargets().find((target = {}) => {
      const targetDialogId = String(target?.dialogId || "").trim();
      const targetRootSessionId = String(
        target?.rootSessionId ||
          workflowPayload.value?.planningDialog?.sessionId ||
          workflowPayload.value?.runMeta?.sessionId ||
          "",
      ).trim();
      return targetDialogId === dialogId && targetRootSessionId === rootSessionId;
    }) || null
  );
}

async function openNodeSession(nodeItem = {}, options = {}) {
  const { fromHistory = false } = options || {};
  selectedGraphDialogId.value = String(nodeItem?.dialogId || "").trim();
  const { dialogId, rootSessionId } = buildWorkflowDrawerRoute(nodeItem);
  if (!props.userId || !rootSessionId || !dialogId) {
    ElMessage.warning(translate("workflow.nodeSessionMissing"));
    return;
  }
  viewerVisible.value = true;
  if (!fromHistory) {
    pushWorkflowDrawerHistory({ dialogId, rootSessionId });
  }
  viewerLoading.value = true;
  viewerError.value = "";
  selectedNode.value = nodeItem;
  selectedNodeMessages.value = [];
  selectedNodeSessionId.value = "";
  try {
    const response = await getWorkflowSessionDetailApi(
      {
        userId: props.userId,
        sessionId: rootSessionId,
        dialogId,
      },
      { fetcher: props.authFetch || fetch },
    );
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
    }
    const session = payload?.workflowSession?.session || {};
    selectedNodeSessionId.value = String(session?.sessionId || "").trim();
    selectedNodeMessages.value = Array.isArray(session?.messages) ? session.messages : [];
  } catch (error) {
    viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
  } finally {
    viewerLoading.value = false;
  }
}

function handleSelectedDialogUpdate(dialogId = "") {
  selectedGraphDialogId.value = String(dialogId || "").trim();
}

async function applyWorkflowDrawerRoute(route = {}) {
  const target = findWorkflowSessionTarget(route);
  applyingWorkflowDrawerHistory.value = true;
  try {
    if (target) {
      await openNodeSession(target, { fromHistory: true });
      return;
    }
    viewerVisible.value = false;
  } finally {
    applyingWorkflowDrawerHistory.value = false;
  }
}

async function handleWorkflowDrawerPopState(event) {
  await applyWorkflowDrawerRoute(parseWorkflowDrawerRoute(event?.state));
}

onMounted(() => {
  window.addEventListener("popstate", handleWorkflowDrawerPopState);
  const initialRoute = parseWorkflowDrawerRoute(history.state);
  if (initialRoute.dialogId && initialRoute.rootSessionId) {
    applyWorkflowDrawerRoute(initialRoute);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", handleWorkflowDrawerPopState);
});

watch(
  () => viewerVisible.value,
  (visible) => {
    if (visible || applyingWorkflowDrawerHistory.value) return;
    replaceWorkflowDrawerHistory({ dialogId: "", rootSessionId: "" });
  },
);
</script>

<template>
  <div class="workflow-card">
    <div class="workflow-card-header">
      <div>
        <div class="workflow-card-title">{{ translate("workflow.planningOutputTitle") }}</div>
        <div class="workflow-card-subtitle">
          {{ translate("workflow.lineCount", { count: semanticPreviewLineCount }) }}
        </div>
      </div>
      <button
        v-if="semanticPreviewCollapsible"
        type="button"
        class="workflow-preview-toggle"
        @click="semanticPreviewExpanded = !semanticPreviewExpanded"
      >
        {{ translate(semanticPreviewExpanded ? "workflow.collapse" : "workflow.expand") }}
      </button>
    </div>
    <div
      class="workflow-card-preview-shell"
      :class="{
        'is-collapsed': semanticPreviewCollapsible && !semanticPreviewExpanded,
      }"
    >
      <pre class="workflow-card-preview">{{ semanticPreview || translate("workflow.empty") }}</pre>
    </div>

    <div v-if="flowNodes.length" class="workflow-node-list">
      <div class="workflow-node-title">{{ translate("workflow.componentizedNodes") }}</div>
      <WorkflowCanvasGraph
        :nodes="flowNodes"
        :flowtos="semanticFlowtos"
        :selected-dialog-id="selectedGraphDialogId"
        @update:selected-dialog-id="handleSelectedDialogUpdate"
        @step-click="openNodeSession"
      />
    </div>
    <BaseEmptyHint
      v-else
      class="workflow-node-empty"
      :text="translate('workflow.noWorkflowNodes')"
    />
  </div>

  <el-drawer
    v-model="viewerVisible"
    direction="rtl"
    size="72%"
    destroy-on-close
    :append-to-body="true"
    :title="translate('workflow.nodeSessionTitle', { sessionId: selectedNodeSessionId || '' })"
    modal-class="workflow-node-session-modal noobot-side-drawer-modal"
    body-class="workflow-node-session-drawer__body noobot-side-drawer__body"
    header-class="workflow-node-session-drawer__header noobot-side-drawer__header"
    class="workflow-node-session-drawer noobot-side-drawer"
  >
    <div
      v-loading="viewerLoading"
      class="workflow-node-session-content"
      :element-loading-text="translate('workflow.loadingNodeSession')"
      element-loading-background="var(--noobot-panel-bg)"
    >
      <BaseMessageErrorAlert :error="viewerError" />
      <template v-if="!viewerError">
        <div
          v-for="(messageItem, messageIndex) in displayNodeMessages"
          :key="`thinking-${String(messageItem?.ts || '')}-${messageIndex}`"
          class="workflow-node-session-item"
        >
          <WorkflowSessionMessageItem
            :message-item="messageItem"
            :all-messages="nodeSessionAllMessages"
            :session-docs="selectedNodeSessionDocs"
            :user-id="userId"
            :auth-fetch="authFetch"
            :render-markdown="renderMarkdown"
            :format-time="formatTime"
            :format-file-size="formatFileSize"
            :is-image-mime="isImageMime"
            @open-thinking-details="handleOpenThinkingDetails"
          />
        </div>
        <BaseEmptyHint
          v-if="!displayNodeMessages.length && !viewerLoading"
          class="workflow-node-empty"
          :text="translate('workflow.noNodeSessionContent')"
        />
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.workflow-card {
  --noobot-text-primary: var(--noobot-text-main);
  --workflow-card-space-sm: 10px;
  --workflow-card-space-md: 12px;
  --workflow-card-radius-sm: 7px;
  --workflow-card-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: var(--workflow-card-space-md);
  margin-bottom: var(--workflow-card-space-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #6d4aff 4%);
  box-shadow: var(--workflow-card-shadow);
}

.workflow-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--workflow-card-space-md);
  margin-bottom: var(--workflow-card-space-sm);
}

.workflow-card-title {
  font-weight: 600;
  line-height: 1.35;
}

.workflow-card-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--noobot-text-secondary);
}

.workflow-preview-toggle {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 var(--workflow-card-space-sm);
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 76%, #6d4aff 24%);
  border-radius: var(--workflow-card-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, #6d4aff 6%);
  color: var(--noobot-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.workflow-preview-toggle:hover {
  border-color: color-mix(in srgb, var(--noobot-msg-assistant-border) 46%, #6d4aff 54%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 90%, #6d4aff 10%);
}

.workflow-card-preview-shell {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 86%, transparent 14%);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 97%, #000 3%);
  overflow: hidden;
}

.workflow-card-preview-shell.is-collapsed {
  max-height: 188px;
}

.workflow-card-preview-shell.is-collapsed::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 44px;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 0%, transparent 100%),
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, #000 2%)
  );
  pointer-events: none;
}

.workflow-card-preview {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: var(--workflow-card-space-sm) var(--workflow-card-space-md);
  color: var(--noobot-text-primary);
  font-size: 12px;
  line-height: 1.55;
  background: transparent;
  overflow: visible;
}

.workflow-node-list {
  margin-top: var(--workflow-card-space-sm);
}

.workflow-node-title {
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--noobot-text-secondary);
}

.workflow-node-empty {
  color: var(--noobot-text-secondary);
  font-size: 13px;
}

.workflow-node-session-item {
  margin-bottom: 12px;
}

.workflow-node-session-item:last-child {
  margin-bottom: 0;
}
</style>

<style>
.workflow-node-session-drawer {
  --noobot-text-primary: var(--noobot-text-main);
}

.workflow-node-session-drawer__body {
  display: flex;
  flex-direction: column;
}

.workflow-node-session-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 260px;
  padding: 12px;
  box-sizing: border-box;
}

.workflow-node-session-content .el-loading-mask {
  display: flex;
  align-items: center;
  justify-content: center;
}

.workflow-node-session-content .el-loading-spinner {
  top: auto;
  margin-top: 0;
}

.workflow-node-session-drawer__body .workflow-node-empty {
  color: var(--noobot-text-secondary);
  font-size: 13px;
}
</style>
