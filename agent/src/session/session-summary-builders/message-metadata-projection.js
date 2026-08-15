/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  compactSessionAttachmentRef,
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../transfer-attachment-refs.js";

const SUMMARY_ARRAY_ITEM_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryArrayItemChars;
const SUMMARY_OBJECT_FIELD_CHARS = LENGTH_THRESHOLDS.display.sessionSummaryObjectFieldChars;
const SUMMARY_DEFAULT_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummaryDefaultJsonStringChars;
const SUMMARY_SMALL_JSON_STRING_CHARS =
  LENGTH_THRESHOLDS.display.sessionSummarySmallJsonStringChars;

function truncateText(value = "", maxLength = LENGTH_THRESHOLDS.display.sessionSummaryTextChars) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function pickLightAttachments(message = {}) {
  const metas = Array.isArray(message?.attachments) ? message.attachments : [];
  return dedupeSessionAttachmentRefs(metas.map(compactSessionAttachmentRef).filter(Boolean));
}

function pickLightObject(source = {}, allowedKeys = []) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const picked = {};
  for (const key of allowedKeys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      picked[key] = value;
    } else if (Array.isArray(value)) {
      picked[key] = value
        .slice(0, 20)
        .map((item) =>
          ["string", "number", "boolean"].includes(typeof item)
            ? item
            : truncateText(item, SUMMARY_ARRAY_ITEM_CHARS),
        );
    } else if (typeof value === "object") {
      picked[key] = truncateText(value, SUMMARY_OBJECT_FIELD_CHARS);
    }
  }
  return Object.keys(picked).length ? picked : null;
}

function clonePlainJson(value, { maxStringLength = SUMMARY_DEFAULT_JSON_STRING_CHARS } = {}) {
  if (value === undefined || value === null) return value;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return truncateText(value, maxStringLength);
  if (Array.isArray(value)) return value.map((item) => clonePlainJson(item, { maxStringLength }));
  if (typeof value !== "object") return undefined;
  const cloned = {};
  for (const [key, itemValue] of Object.entries(value)) {
    const nextValue = clonePlainJson(itemValue, { maxStringLength });
    if (nextValue !== undefined) cloned[key] = nextValue;
  }
  return cloned;
}

function pickPlainFields(source = {}, allowedKeys = [], options = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const picked = {};
  for (const key of allowedKeys) {
    if (source?.[key] === undefined || source?.[key] === null || source?.[key] === "") continue;
    const value = clonePlainJson(source[key], options);
    if (value !== undefined) picked[key] = value;
  }
  return Object.keys(picked).length ? picked : null;
}

function pickTransferEnvelope(envelope = {}) {
  return compactTransferEnvelopes([envelope])[0] || null;
}

function pickLightPayloadTransferEnvelopes(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 50)
    .map((item) => pickTransferEnvelope(item))
    .filter(Boolean);
}

function pickPayloadStepFailure(value) {
  if (!value) return null;
  if (typeof value === "string") return truncateText(value, SUMMARY_OBJECT_FIELD_CHARS);
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return pickPlainFields(value, ["message", "error", "code", "name", "stack"], {
    maxStringLength: SUMMARY_OBJECT_FIELD_CHARS,
  });
}

function pickPayloadSemantic(semantic = {}) {
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) return null;
  return pickPlainFields(semantic, ["nodes", "flowtos", "edges", "attachments"], {
    maxStringLength: SUMMARY_DEFAULT_JSON_STRING_CHARS,
  });
}

function pickPayloadNodeRun(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked =
    pickPlainFields(
      item,
      [
        "transition",
        "stepId",
        "stepIndex",
        "actionNodeStateId",
        "nodeDialogProcessId",
        "dialogProcessId",
        "nodeDialogId",
        "dialogId",
        "nodeSessionId",
        "sessionId",
        "rootSessionId",
        "stepStatus",
        "status",
        "parallelWave",
        "waveOrder",
      ],
      { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
    ) || {};
  const step = pickPlainFields(
    item?.step,
    [
      "nodeId",
      "nodeName",
      "nodeType",
      "type",
      "stateType",
      "stepId",
      "stepIndex",
      "actionNodeStateId",
    ],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (step) picked.step = step;
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(
    item?.nodeResultTransferEnvelopes || item?.transferEnvelopes,
  );
  if (envelopes.length) picked.nodeResultTransferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPayloadNodeSession(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const picked =
    pickPlainFields(
      item,
      [
        "transition",
        "nodeName",
        "nodeId",
        "nodeType",
        "actionNodeStateId",
        "stepId",
        "stepIndex",
        "type",
        "stateType",
        "rootSessionId",
        "dialogProcessId",
        "dialogId",
        "sessionId",
        "stepStatus",
        "status",
        "parallelWave",
        "waveOrder",
      ],
      { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
    ) || {};
  const stepFailure = pickPayloadStepFailure(item?.stepFailure);
  if (stepFailure) picked.stepFailure = stepFailure;
  const envelopes = pickLightPayloadTransferEnvelopes(
    item?.transferEnvelopes || item?.nodeResultTransferEnvelopes,
  );
  if (envelopes.length) picked.transferEnvelopes = envelopes;
  return Object.keys(picked).length ? picked : null;
}

function pickPluginPayloadSnapshot(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const picked =
    pickPlainFields(payload, ["workflowRunId", "status", "phase", "phaseStatus"], {
      maxStringLength: SUMMARY_SMALL_JSON_STRING_CHARS,
    }) || {};
  const semantic = pickPayloadSemantic(payload?.semantic);
  if (semantic) picked.semantic = semantic;
  if (
    payload?.execution &&
    typeof payload.execution === "object" &&
    !Array.isArray(payload.execution)
  ) {
    const execution =
      pickPlainFields(
        payload.execution,
        ["workflowRunId", "instanceId", "completed", "status", "startedAt", "endedAt", "error"],
        { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
      ) || {};
    const runs = (
      Array.isArray(payload.execution?.nodeAgentRuns) ? payload.execution.nodeAgentRuns : []
    )
      .slice(0, 100)
      .map((item) => pickPayloadNodeRun(item))
      .filter(Boolean);
    if (runs.length) execution.nodeAgentRuns = runs;
    if (Object.keys(execution).length) picked.execution = execution;
  }
  const nodeSessions = (Array.isArray(payload?.nodeSessions) ? payload.nodeSessions : [])
    .slice(0, 100)
    .map((item) => pickPayloadNodeSession(item))
    .filter(Boolean);
  if (nodeSessions.length) picked.nodeSessions = nodeSessions;
  const planningDialog = pickPlainFields(
    payload?.planningDialog,
    ["sessionId", "dialogProcessId", "dialogId", "parentSessionId"],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (planningDialog) picked.planningDialog = planningDialog;
  const runMeta = pickPlainFields(
    payload?.runMeta,
    ["sessionId", "dialogProcessId", "dialogId", "parentSessionId", "runId"],
    { maxStringLength: SUMMARY_OBJECT_FIELD_CHARS },
  );
  if (runMeta) picked.runMeta = runMeta;
  const interaction = pickPlainFields(payload?.interaction, ["semanticTextPreview"], {
    maxStringLength: LENGTH_THRESHOLDS.display.sessionSummaryTextChars,
  });
  if (interaction) picked.interaction = interaction;
  return Object.keys(picked).length ? picked : null;
}

function hasPluginPayloadSnapshot(message = {}) {
  const payload = message?.pluginMeta?.payload;
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

export function pickLightPluginMeta(message = {}) {
  const pluginMeta = pickLightObject(message?.pluginMeta, [
    "pluginId",
    "pluginName",
    "name",
    "title",
    "status",
    "state",
    "icon",
    "color",
    "source",
    "kind",
    "phase",
    "nodeId",
    "nodeName",
    "nodeType",
    "stepId",
    "stepName",
  ]);
  if (pluginMeta && hasPluginPayloadSnapshot(message)) {
    const payload = pickPluginPayloadSnapshot(message?.pluginMeta?.payload);
    if (payload) pluginMeta.payload = payload;
  }
  return pluginMeta;
}

export function pickLightTransferEnvelopes(message = {}) {
  const seen = new Set();
  return (Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((envelope) => pickTransferEnvelope(envelope))
    .filter(Boolean)
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
