/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeConnectorType } from "../../../config/index.js";
import { recoverableToolError } from "../../../error/index.js";
import { cleanConnectorOutputForLLM } from "../../../utils/text-cleaner.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import {
  tToolDescription,
  tToolParamDescription,
} from "../../core/tool-schema-i18n.js";
import { tTool } from "../../core/tool-i18n.js";
import { collectNonSensitiveDefaults } from "./connector-fields.js";
import { resolveRememberedConnectorInfo } from "./connector-context.js";
import { resolveConfiguredConnectorInfo } from "./connector-resolver.js";
import { findConnectedConnector, tConnector } from "./connector-runtime.js";
import { ERROR_CODE } from "../../../error/constants.js";
import {
  ArtifactGenerationSource,
  AttachmentSource,
  ConnectorType,
  ToolName,
  ToolResultStatus,
} from "../../constants/index.js";

function buildAccessConnectorTool(context = {}) {
  const {
    runtime,
    effectiveConfig,
    store,
    historyStore,
    connectorEventListener,
    rootSessionId,
    maxAccessOutputChars,
  } = context;
  const resolveReconnectToolName = (connectorType = "") =>
    connectorType === ConnectorType.DATABASE
      ? ConnectorType.CONNECT_TOOL_NAME.DATABASE
      : connectorType === ConnectorType.TERMINAL
        ? ConnectorType.CONNECT_TOOL_NAME.TERMINAL
        : ConnectorType.CONNECT_TOOL_NAME.EMAIL;
  const buildEmailAttachmentHandler = () => {
    const userId = String(runtime?.userId || "").trim();
    const attachmentService = runtime?.attachmentService || null;
    if (!userId || !attachmentService) return null;
    return async (artifacts = [], options = {}) => {
      const sourceArtifacts = Array.isArray(artifacts) ? artifacts : [];
      if (!sourceArtifacts.length) return [];
      const runtimeSessionId = String(
        runtime?.systemRuntime?.sessionId ||
          runtime?.systemRuntime?.rootSessionId ||
          "",
      ).trim();
      const generationSource = String(
        options?.generationSource || ArtifactGenerationSource.EMAIL_CONNECTOR_READ,
      ).trim();
      const savedRecords =
        generationSource === ArtifactGenerationSource.EMAIL_CONNECTOR_READ &&
        typeof attachmentService.ingestEmailArtifacts === "function"
          ? await attachmentService.ingestEmailArtifacts({
              userId,
              sessionId: runtimeSessionId,
              artifacts: sourceArtifacts,
            })
          : await attachmentService.ingestGeneratedArtifacts({
              userId,
              sessionId: runtimeSessionId,
              attachmentSource:
                generationSource === ArtifactGenerationSource.EMAIL_CONNECTOR_READ
                  ? AttachmentSource.EMAIL
                  : AttachmentSource.MODEL,
              artifacts: sourceArtifacts,
              generationSource,
            });
      return (Array.isArray(savedRecords) ? savedRecords : []).map(
        (attachmentItem, attachmentIndex) => ({
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || runtimeSessionId).trim(),
          attachmentSource: String(
            attachmentItem?.attachmentSource ||
              (generationSource === ArtifactGenerationSource.EMAIL_CONNECTOR_READ
                ? AttachmentSource.EMAIL
                : AttachmentSource.MODEL),
          ).trim(),
          name: String(attachmentItem?.name || "").trim(),
          mimeType: String(
            attachmentItem?.mimeType || "application/octet-stream",
          ).trim(),
          size: Number(attachmentItem?.size || 0),
          generatedByModel: attachmentItem?.generatedByModel === true,
          generationSource: String(
            attachmentItem?.generationSource || generationSource,
          ).trim(),
          email_attachment_type: String(
            sourceArtifacts?.[attachmentIndex]?.email_attachment_type || "",
          ).trim(),
          email_content_id: String(
            sourceArtifacts?.[attachmentIndex]?.email_content_id || "",
          ).trim(),
          email_is_inline:
            sourceArtifacts?.[attachmentIndex]?.email_is_inline === true,
        }),
      );
    };
  };
  return {
    name: ToolName.ACCESS_CONNECTOR,
    description: tToolDescription(runtime, ToolName.ACCESS_CONNECTOR),
    schemaShape: {
      connector_name: {
        description: tToolParamDescription(runtime, ToolName.ACCESS_CONNECTOR, "connector_name"),
      },
      connector_type: {
        description: tToolParamDescription(runtime, ToolName.ACCESS_CONNECTOR, "connector_type"),
      },
      command: {
        description: tToolParamDescription(runtime, ToolName.ACCESS_CONNECTOR, "command"),
      },
    },
    async func({ connector_name, connector_type, command }) {
      if (!store || typeof store.executeConnectorCommand !== "function") {
        throw recoverableToolError(tTool(runtime, "connectors.storeMissing"), {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
        });
      }
      if (!rootSessionId) {
        throw recoverableToolError(tTool(runtime, "connectors.rootSessionMissing"), {
          code: ERROR_CODE.RECOVERABLE_ROOT_SESSION_MISSING,
        });
      }
      const connectorType = normalizeConnectorType(connector_type);
      if (
        ![
          ConnectorType.DATABASE,
          ConnectorType.TERMINAL,
          ConnectorType.EMAIL,
        ].includes(connectorType)
      ) {
        throw recoverableToolError(
          tTool(runtime, "tools.access_connector.errorConnectorTypeRequired"),
          {
            code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
          },
        );
      }
      const selectedConnectors =
        runtime?.systemRuntime?.config?.selectedConnectors &&
        typeof runtime.systemRuntime.config.selectedConnectors === "object"
          ? runtime.systemRuntime.config.selectedConnectors
          : {};
      const selectedConnectorName = String(selectedConnectors?.[connectorType] || "").trim();
      if (!selectedConnectorName) {
        throw recoverableToolError(
          tConnector(runtime, "selectedMissing", { connectorType }),
          {
            code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISSING,
          },
        );
      }
      const requestedConnectorName = String(connector_name || "").trim();
      if (
        requestedConnectorName &&
        requestedConnectorName !== selectedConnectorName
      ) {
        throw recoverableToolError(
          tConnector(runtime, "selectedOnly", {
            connectorName: selectedConnectorName,
          }),
          {
            code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISMATCH,
          },
        );
      }
      const connectorName = selectedConnectorName;
      const connectedConnector = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType,
      });
      if (!connectedConnector) {
        const configuredConnectionInfo = resolveConfiguredConnectorInfo({
          effectiveConfig,
          connectorName,
          connectorType,
        });
        const rememberedConnectionInfo = await resolveRememberedConnectorInfo({
          historyStore,
          userId: runtime?.userId || "",
          rootSessionId,
          connectorType,
          connectorName,
        });
        const connectionDefaults = {
          ...collectNonSensitiveDefaults(configuredConnectionInfo),
          ...rememberedConnectionInfo,
        };
        const reconnectToolName = resolveReconnectToolName(connectorType);
        const reconnectMessage = tConnector(runtime, "reconnectNeeded", {
          connectorName,
        });
        await connectorEventListener?.notifyReconnectRequired?.({
          connectorType,
          connectorName,
          reconnectToolName,
          defaultValues: connectionDefaults,
          message: reconnectMessage,
        });
        throw recoverableToolError(
          tConnector(runtime, "selectedConnectorNotConnected", {
            connectorType,
            connectorName,
          }),
          {
            code: ERROR_CODE.RECOVERABLE_CONNECTOR_NEEDS_RECONNECT,
            details: {
              status: ToolResultStatus.NEEDS_RECONNECT,
              reconnect_required: true,
              reconnect_tool: reconnectToolName,
              connector: {
                connector_name: connectorName,
                connector_type: connectorType,
              },
              default_values: connectionDefaults,
              message: reconnectMessage,
            },
          },
        );
      }
      try {
        const result = await store.executeConnectorCommand({
          sessionId: rootSessionId,
          connectorName,
          connectorType,
          command: String(command || "").trim(),
          emailAttachmentHandler: buildEmailAttachmentHandler(),
        });
        runtime.connectorChannels = store.getSessionConnectors(rootSessionId);
        if (
          connectorEventListener &&
          typeof connectorEventListener.onConnectorAccessed === "function"
        ) {
          connectorEventListener.onConnectorAccessed({
            connectorType,
            connectorName,
          });
        }
        const executionFailedMessage = String(
          result?.output?.stderr || result?.output?.stdout || "",
        ).trim();
        return toToolJsonResult(
          ToolName.ACCESS_CONNECTOR,
          {
            ok: result?.ok === true,
            status: result?.ok
              ? ToolResultStatus.COMPLETED
              : ToolResultStatus.FAILED,
            message: result?.ok
              ? tConnector(runtime, "execCompleted")
              : tConnector(runtime, "execFailed", {
                  reason: executionFailedMessage,
                }),
            connector: result?.connector || {},
            output: cleanConnectorOutputForLLM(
              {
                connectorType,
                output: result?.output || {},
              },
              { maxChars: maxAccessOutputChars },
            ),
          },
          true,
        );
      } catch (error) {
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_ACCESS_CONNECTOR_FAILED),
          details:
            error?.details && typeof error.details === "object"
              ? error.details
              : undefined,
        });
      }
    },
  };
}

export { buildAccessConnectorTool };
