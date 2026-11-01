/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";

export const EXTENSION_POINTS = Object.freeze({
  MESSAGE_CARD_PRE: "message.card.pre",
  MESSAGE_CARD_POST: "message.card.post",
  MESSAGE_ACTION_AFTER_PRE_CARDS: "message.action.after-pre-cards",
  MESSAGE_ACTION_POST_CONTENT: "message.action.post-content",
  COMPOSER_OPTIONS_MODEL: "composer.options.model",
  COMPOSER_MODEL_OPTIONS: "composer.model-options",
  MARKDOWN_COLLAPSE_MARKERS: "markdown.collapse.markers",
  RUNTIME_STREAM_ROUTE: "runtime.stream.route",
  SESSION_DETAIL_HYDRATOR: "session.detail.hydrator",
  SESSION_ARTIFACT_PANEL: "session.artifact.panel",
  RIGHT_TOOL_PANEL: "right.tool.panel",
  COMPOSER_MORE_ACTIONS: "composer.more.actions",
  THINKING_CONTENT_ITEM: "thinking.content.item",
});

export const EXTENSION_ARBITRATION = Object.freeze({
  MULTI: "multi",
  FIRST_MATCH: "first-match",
  EXCLUSIVE: "exclusive",
});

export const FRONTEND_EXTENSION_KIND = Object.freeze({
  COMPONENT: "component",
  PROVIDER: "provider",
});

const COMPONENT_EXTENSION_POINTS = new Set([
  EXTENSION_POINTS.MESSAGE_CARD_PRE,
  EXTENSION_POINTS.MESSAGE_CARD_POST,
  EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS,
  EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT,
  EXTENSION_POINTS.COMPOSER_OPTIONS_MODEL,
  EXTENSION_POINTS.COMPOSER_MODEL_OPTIONS,
  EXTENSION_POINTS.SESSION_ARTIFACT_PANEL,
  EXTENSION_POINTS.RIGHT_TOOL_PANEL,
  EXTENSION_POINTS.COMPOSER_MORE_ACTIONS,
]);

export const EXTENSION_POINT_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.values(EXTENSION_POINTS).map((point) => [
      point,
      Object.freeze({
        point,
        strategy: EXTENSION_ARBITRATION.MULTI,
        kind: COMPONENT_EXTENSION_POINTS.has(point)
          ? FRONTEND_EXTENSION_KIND.COMPONENT
          : FRONTEND_EXTENSION_KIND.PROVIDER,
      }),
    ]),
  ),
);

export const MESSAGE_CARD_HOST_CAPABILITY = Object.freeze({
  SELECT_EXECUTION_DETAIL: "selectExecutionDetail",
  STOP_EXECUTION: "stopExecution",
  FETCH_EXECUTION_REPORT: "fetchExecutionReport",
  SELECT_SESSION_MESSAGES: "selectSessionMessages",
  APPLY_WORKFLOW_RUNTIME_EVENT: "applyWorkflowRuntimeEvent",
  LOG_WORKFLOW_DIAGNOSTICS: "logWorkflowDiagnostics",
  RENDER_MARKDOWN: "renderMarkdown",
  FORMAT_TIME: "formatTime",
  FORMAT_FILE_SIZE: "formatFileSize",
  IS_IMAGE_MIME: "isImageMime",
});

export const MESSAGE_CARD_HOST_CAPABILITIES = Object.freeze(
  Object.values(MESSAGE_CARD_HOST_CAPABILITY),
);

export const MESSAGE_CARD_HOST_STATE = Object.freeze({
  WORKFLOW_NODE_STATE_REGISTRY: "workflowNodeStateRegistry",
  SUB_SESSION_MESSAGE_REGISTRY: "subSessionMessageRegistry",
});

export const MESSAGE_CARD_HOST_STATES = Object.freeze(Object.values(MESSAGE_CARD_HOST_STATE));

export const MESSAGE_CARD_HOST_STATE_VERSION = "subSessionMessageRegistryVersion";

export function requireSelectedSessionDocument(document, sessionId) {
  if (document === null) return null;
  if (!isPlainObject(document) || document.sessionId !== sessionId || !isCanonicalText(sessionId)) {
    throw new TypeError("selected session document must carry the requested sessionId");
  }
  if (!Array.isArray(document.messages)) {
    throw new TypeError("selected session document messages must be an array");
  }
  return document;
}

function hasSelectedExecutionIdentity(execution) {
  return (
    isPlainObject(execution) &&
    isCanonicalText(execution.executionId) &&
    isCanonicalText(execution.sessionId) &&
    isCanonicalText(execution.turnScopeId)
  );
}

function requireSelectedExecutionList(items, rootExecutionId) {
  const executionIds = new Set([rootExecutionId]);
  for (const execution of items) {
    if (!hasSelectedExecutionIdentity(execution)) {
      throw new TypeError("selected execution list identity is invalid");
    }
    if (executionIds.has(execution.executionId)) {
      throw new TypeError("selected execution list contains a duplicate executionId");
    }
    executionIds.add(execution.executionId);
  }
}

export function requireSelectedExecutionDetail(detail, { executionId, sessionId }) {
  if (detail === null) return null;
  if (!isPlainObject(detail) || !isPlainObject(detail.execution)) {
    throw new TypeError("selected execution detail must carry an execution");
  }
  const execution = detail.execution;
  if (
    !isCanonicalText(executionId) ||
    execution.executionId !== executionId ||
    !hasSelectedExecutionIdentity(execution)
  ) {
    throw new TypeError("selected execution detail identity is invalid");
  }
  if (sessionId !== undefined && execution.sessionId !== sessionId) {
    throw new TypeError("selected execution detail belongs to another session");
  }
  if (requireSelectedSessionDocument(detail.session, execution.sessionId) === null) {
    throw new TypeError("selected execution detail requires a loaded session document");
  }
  if (!Array.isArray(detail.children) || !Array.isArray(detail.descendants)) {
    throw new TypeError("selected execution detail requires children and descendants arrays");
  }
  requireSelectedExecutionList(detail.children, executionId);
  requireSelectedExecutionList(detail.descendants, executionId);
  return detail;
}

export const HOST_CAPABILITY_ERROR_CODE = Object.freeze({
  MISSING: "PLUGIN_HOST_CAPABILITY_MISSING",
});

export const EXTENSION_CONTEXT_ERROR_CODE = Object.freeze({
  INVALID: "PLUGIN_EXTENSION_CONTEXT_INVALID",
});

export const SESSION_ARTIFACT_PANEL_CONTEXT_FIELDS = Object.freeze([
  "sessionId",
  "panelResizing",
  "panelResizeRevision",
]);

function invalidExtensionContext(point, field) {
  return Object.assign(new TypeError(`${point} context invalid: ${field}`), {
    code: EXTENSION_CONTEXT_ERROR_CODE.INVALID,
  });
}

export function requireRuntimeStreamRouteContext(context) {
  const point = EXTENSION_POINTS.RUNTIME_STREAM_ROUTE;
  if (!isPlainObject(context)) throw invalidExtensionContext(point, "context");
  if (context.source !== "live" && context.source !== "reconnect") {
    throw invalidExtensionContext(point, "source");
  }
  if (!isFunction(context.isCurrentActiveSession)) {
    throw invalidExtensionContext(point, "isCurrentActiveSession");
  }
  if (
    context.logRuntimeProjectionDiagnostics !== undefined &&
    !isFunction(context.logRuntimeProjectionDiagnostics)
  ) {
    throw invalidExtensionContext(point, "logRuntimeProjectionDiagnostics");
  }
  return context;
}

export function createSessionArtifactPanelContext({
  sessionId,
  panelResizing,
  panelResizeRevision,
}) {
  const point = EXTENSION_POINTS.SESSION_ARTIFACT_PANEL;
  if (!isCanonicalText(sessionId)) throw invalidExtensionContext(point, "sessionId");
  if (typeof panelResizing !== "boolean") throw invalidExtensionContext(point, "panelResizing");
  if (!Number.isInteger(panelResizeRevision) || panelResizeRevision < 0) {
    throw invalidExtensionContext(point, "panelResizeRevision");
  }
  return Object.freeze({ sessionId, panelResizing, panelResizeRevision });
}

function missingHostCapability(name) {
  return Object.assign(new TypeError(`message card host capability missing: ${name}`), {
    code: HOST_CAPABILITY_ERROR_CODE.MISSING,
  });
}

export function requireMessageCardHostCapabilities(context) {
  for (const name of MESSAGE_CARD_HOST_CAPABILITIES) {
    if (!isFunction(context?.[name])) throw missingHostCapability(name);
  }
  for (const name of MESSAGE_CARD_HOST_STATES) {
    if (!isPlainObject(context[name])) throw missingHostCapability(name);
  }
  if (!Number.isInteger(context[MESSAGE_CARD_HOST_STATE_VERSION])) {
    throw missingHostCapability(MESSAGE_CARD_HOST_STATE_VERSION);
  }
  return context;
}
