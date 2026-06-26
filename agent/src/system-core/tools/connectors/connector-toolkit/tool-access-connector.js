/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { BUILTIN_THRESHOLDS, normalizeConnectorType } from "../../../config/index.js";
import { recoverableToolError } from "../../../error/index.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import {
  tToolDescription,
  tToolParamDescription,
} from "../../core/tool-schema-i18n.js";
import { tTool } from "../../core/tool-i18n.js";
import { collectNonSensitiveDefaults } from "./connector-fields.js";
import { resolveRememberedConnectorInfo } from "./connector-context.js";
import { resolveConfiguredConnectorInfo } from "./connector-resolver.js";
import {
  findConnectedConnector,
  tConnector,
  upsertRuntimeSelectedConnector,
} from "./connector-runtime.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { MIME_TYPE } from "../../../constants/index.js";
import { mapAttachmentRecordsToMetas } from "../../../attach/meta-ops.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  CONNECTOR_TYPE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../../constants/index.js";

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizePositiveInt(value, fallback = 0, min = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(num));
}

function normalizeExtensionList(input = [], fallback = []) {
  const source = Array.isArray(input) ? input : fallback;
  const set = new Set();
  for (const item of source) {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized) continue;
    set.add(normalized.startsWith(".") ? normalized : `.${normalized}`);
  }
  return Array.from(set);
}

function isPathUnderRoot(rootPath = "", targetPath = "") {
  const rel = path.relative(rootPath, targetPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveWorkspaceBasePath(runtime = {}) {
  const basePath = String(
    runtime?.basePath || runtime?.workspaceBasePath || "",
  ).trim();
  if (!basePath) return "";
  return path.resolve(basePath);
}

function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = String(item?.attachmentId || "").trim() ||
      `${String(item?.path || "").trim()}|${String(item?.relativePath || "").trim()}|${String(item?.name || "").trim()}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveAccessConnectorFilePolicy({
  effectiveConfig = {},
  runtime = {},
  connectorType = "",
} = {}) {
  const toolsConfig =
    effectiveConfig?.tools && typeof effectiveConfig.tools === "object"
      ? effectiveConfig.tools
      : {};
  const accessConfig =
    toolsConfig?.accessConnector && typeof toolsConfig.accessConnector === "object"
      ? toolsConfig.accessConnector
      : toolsConfig?.access_connector && typeof toolsConfig.access_connector === "object"
        ? toolsConfig.access_connector
        : {};
  const commandFileConfig =
    accessConfig?.commandFile && typeof accessConfig.commandFile === "object"
      ? accessConfig.commandFile
      : accessConfig?.command_file && typeof accessConfig.command_file === "object"
        ? accessConfig.command_file
        : {};
  const workspaceBasePath = resolveWorkspaceBasePath(runtime);
  const configuredRoots = Array.isArray(commandFileConfig?.allowedRoots)
    ? commandFileConfig.allowedRoots
    : Array.isArray(commandFileConfig?.allowed_roots)
      ? commandFileConfig.allowed_roots
      : [];
  const roots = configuredRoots.length
    ? configuredRoots
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) =>
          path.isAbsolute(item)
            ? path.resolve(item)
            : workspaceBasePath
              ? path.resolve(workspaceBasePath, item)
              : path.resolve(item),
        )
    : workspaceBasePath
      ? [workspaceBasePath]
      : [];
  const defaultExtensionsByType =
    BUILTIN_THRESHOLDS.connectorCommandFile.allowedExtensionsByType?.[connectorType] || [];
  return {
    enabled: normalizeBoolean(
      commandFileConfig?.enabled ?? commandFileConfig?.enable,
      true,
    ),
    maxBytes: BUILTIN_THRESHOLDS.connectorCommandFile.maxBytes,
    allowedRoots: roots,
    allowedExtensions: normalizeExtensionList(defaultExtensionsByType, defaultExtensionsByType),
  };
}

async function resolveCommandFromFile({
  commandFilePath = "",
  connectorType = "",
  effectiveConfig = {},
  runtime = {},
} = {}) {
  const normalizedFilePath = String(commandFilePath || "").trim();
  if (!normalizedFilePath) {
    throw recoverableToolError("command_file_path required", {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: "command_file_path" },
    });
  }

  if (![CONNECTOR_TYPE.DATABASE, CONNECTOR_TYPE.TERMINAL].includes(connectorType)) {
    throw recoverableToolError(
      "command_file_path only supports database/terminal connector",
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
        details: { field: "command_file_path", connector_type: connectorType },
      },
    );
  }

  const policy = resolveAccessConnectorFilePolicy({
    effectiveConfig,
    runtime,
    connectorType,
  });
  if (!policy.enabled) {
    throw recoverableToolError("command_file_path is disabled by config", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "command_file_path", reason: "disabled" },
    });
  }
  if (!policy.allowedRoots.length) {
    throw recoverableToolError("command_file_path allowed roots not configured", {
      code: ERROR_CODE.RECOVERABLE_RUNTIME_BASEPATH_MISSING,
      details: { field: "command_file_path" },
    });
  }

  const resolvedInputPath = path.isAbsolute(normalizedFilePath)
    ? path.resolve(normalizedFilePath)
    : path.resolve(policy.allowedRoots[0], normalizedFilePath);

  const inAllowedRoots = policy.allowedRoots.some((rootPath) =>
    isPathUnderRoot(rootPath, resolvedInputPath),
  );
  if (!inAllowedRoots) {
    throw recoverableToolError("command_file_path out of allowed roots", {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: "command_file_path",
        file_path: normalizedFilePath,
        allowed_roots: policy.allowedRoots,
      },
    });
  }

  try {
    await access(resolvedInputPath);
  } catch {
    throw recoverableToolError("command_file_path not found", {
      code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
      details: { field: "command_file_path", file_path: normalizedFilePath },
    });
  }

  const [resolvedRealPath, fileStat] = await Promise.all([
    realpath(resolvedInputPath),
    stat(resolvedInputPath),
  ]);
  const realInAllowedRoots = policy.allowedRoots.some((rootPath) =>
    isPathUnderRoot(rootPath, resolvedRealPath),
  );
  if (!realInAllowedRoots) {
    throw recoverableToolError("command_file_path out of allowed roots", {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: "command_file_path",
        file_path: normalizedFilePath,
        allowed_roots: policy.allowedRoots,
      },
    });
  }
  if (!fileStat?.isFile?.()) {
    throw recoverableToolError("command_file_path must be a file", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "command_file_path", file_path: normalizedFilePath },
    });
  }
  if (Number(fileStat.size || 0) > policy.maxBytes) {
    throw recoverableToolError("command_file_path exceeds max bytes", {
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
      details: {
        field: "command_file_path",
        file_path: normalizedFilePath,
        file_size_bytes: Number(fileStat.size || 0),
        max_bytes: policy.maxBytes,
      },
    });
  }

  const fileExt = String(path.extname(resolvedRealPath) || "").toLowerCase();
  if (policy.allowedExtensions.length && !policy.allowedExtensions.includes(fileExt)) {
    throw recoverableToolError("command_file_path extension not allowed", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: "command_file_path",
        extension: fileExt,
        allowed_extensions: policy.allowedExtensions,
      },
    });
  }

  const commandText = String(await readFile(resolvedRealPath, "utf8") || "").trim();
  if (!commandText) {
    throw recoverableToolError("command file is empty", {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: "command_file_path", file_path: normalizedFilePath },
    });
  }
  return commandText;
}


function resolveConnectorBucketName(connectorType = "") {
  if (connectorType === CONNECTOR_TYPE.DATABASE) return CONNECTOR_TYPE.CHANNEL_BUCKET.DATABASE;
  if (connectorType === CONNECTOR_TYPE.TERMINAL) return CONNECTOR_TYPE.CHANNEL_BUCKET.TERMINAL;
  if (connectorType === CONNECTOR_TYPE.EMAIL) return CONNECTOR_TYPE.CHANNEL_BUCKET.EMAIL;
  return "";
}

function resolveSelectedConnectorName({
  runtime = {},
  store = null,
  rootSessionId = "",
  connectorType = "",
  requestedConnectorName = "",
} = {}) {
  const selectedConnectors =
    runtime?.systemRuntime?.config?.selectedConnectors &&
    typeof runtime.systemRuntime.config.selectedConnectors === "object"
      ? runtime.systemRuntime.config.selectedConnectors
      : {};
  const explicitlySelectedName = String(selectedConnectors?.[connectorType] || "").trim();
  if (explicitlySelectedName) {
    return { connectorName: explicitlySelectedName, inferred: false };
  }

  if (!store || typeof store.getSessionConnectors !== "function") {
    return { connectorName: "", inferred: false };
  }
  const bucketName = resolveConnectorBucketName(connectorType);
  if (!bucketName) return { connectorName: "", inferred: false };
  const sessionConnectors = store.getSessionConnectors(String(rootSessionId || "").trim());
  const sourceList = Array.isArray(sessionConnectors?.[bucketName])
    ? sessionConnectors[bucketName]
    : [];
  const connectedNames = sourceList
    .map((item) => String(item?.connectorName || item?.connector_name || "").trim())
    .filter(Boolean);

  const requestedName = String(requestedConnectorName || "").trim();
  if (requestedName && connectedNames.includes(requestedName)) {
    return { connectorName: requestedName, inferred: true };
  }
  if (!requestedName && connectedNames.length === 1) {
    return { connectorName: connectedNames[0], inferred: true };
  }
  return { connectorName: "", inferred: false };
}

function buildAccessConnectorTool(context = {}) {
  const {
    runtime,
    effectiveConfig,
    store,
    historyStore,
    connectorEventListener,
    rootSessionId,
  } = context;
  const resolveReconnectToolName = (connectorType = "") =>
    connectorType === CONNECTOR_TYPE.DATABASE
      ? CONNECTOR_TYPE.CONNECT_TOOL_NAME.DATABASE
      : connectorType === CONNECTOR_TYPE.TERMINAL
        ? CONNECTOR_TYPE.CONNECT_TOOL_NAME.TERMINAL
        : CONNECTOR_TYPE.CONNECT_TOOL_NAME.EMAIL;
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
        options?.generationSource || ARTIFACT_GENERATION_SOURCE.EMAIL_CONNECTOR_READ,
      ).trim();
      const attachmentSource =
        generationSource === ARTIFACT_GENERATION_SOURCE.EMAIL_CONNECTOR_READ
          ? TOOL_ATTACHMENT_SOURCE.EMAIL
          : TOOL_ATTACHMENT_SOURCE.MODEL;
      const records = await attachmentService.ingestGeneratedArtifacts({
        userId,
        sessionId: runtimeSessionId,
        attachmentSource,
        generationSource,
        artifacts: sourceArtifacts,
      });
      const rawAttachments = dedupeAttachments(
        mapAttachmentRecordsToMetas(records, {
          fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
          fallbackGenerationSource: generationSource,
        }),
      );
      const attachments = rawAttachments.map(
        (attachmentItem, attachmentIndex) => ({
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || runtimeSessionId).trim(),
          attachmentSource: String(
            attachmentItem?.attachmentSource ||
              (generationSource === ARTIFACT_GENERATION_SOURCE.EMAIL_CONNECTOR_READ
                ? TOOL_ATTACHMENT_SOURCE.EMAIL
                : TOOL_ATTACHMENT_SOURCE.MODEL),
          ).trim(),
          name: String(attachmentItem?.name || "").trim(),
          mimeType: String(
            attachmentItem?.mimeType || MIME_TYPE.APPLICATION_OCTET_STREAM,
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
      return {
        attachments,
        transferEnvelopes: [],
      };
    };
  };
  return {
    name: TOOL_NAME.ACCESS_CONNECTOR,
    description: tToolDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR),
    schemaShape: {
      connector_name: {
        description: tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "connector_name"),
      },
      connector_type: {
        description: tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "connector_type"),
      },
      command: {
        description: tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "command"),
      },
      command_file_path: {
        description: tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "command_file_path"),
      },
    },
    async func({ connector_name, connector_type, command, command_file_path }) {
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
          CONNECTOR_TYPE.DATABASE,
          CONNECTOR_TYPE.TERMINAL,
          CONNECTOR_TYPE.EMAIL,
        ].includes(connectorType)
      ) {
        throw recoverableToolError(
          tTool(runtime, "tools.access_connector.errorConnectorTypeRequired"),
          {
            code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
          },
        );
      }
      const inlineCommand = String(command || "").trim();
      const fileCommandPath = String(command_file_path || "").trim();
      if (inlineCommand && fileCommandPath) {
        throw recoverableToolError(
          "Provide either command or command_file_path, not both",
          {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: { fields: ["command", "command_file_path"] },
          },
        );
      }
      const resolvedCommand = inlineCommand || (await resolveCommandFromFile({
        commandFilePath: fileCommandPath,
        connectorType,
        effectiveConfig,
        runtime,
      }));
      const requestedConnectorName = String(connector_name || "").trim();
      const selectedResolution = resolveSelectedConnectorName({
        runtime,
        store,
        rootSessionId,
        connectorType,
        requestedConnectorName,
      });
      const selectedConnectorName = String(selectedResolution?.connectorName || "").trim();
      if (!selectedConnectorName) {
        throw recoverableToolError(
          tConnector(runtime, "selectedMissing", { connectorType }),
          {
            code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISSING,
          },
        );
      }
      if (selectedResolution?.inferred === true) {
        upsertRuntimeSelectedConnector(runtime, {
          connectorType,
          connectorName: selectedConnectorName,
        });
      }
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
              status: TOOL_RESULT_STATUS.NEEDS_RECONNECT,
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
          command: resolvedCommand,
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
          TOOL_NAME.ACCESS_CONNECTOR,
          {
            ok: result?.ok === true,
            status: result?.ok
              ? TOOL_RESULT_STATUS.COMPLETED
              : TOOL_RESULT_STATUS.FAILED,
            message: result?.ok
              ? tConnector(runtime, "execCompleted")
              : tConnector(runtime, "execFailed", {
                  reason: executionFailedMessage,
                }),
            connector: result?.connector || {},
            // Keep raw connector output; avoid sanitizer/truncation here.
            // Tool-runner overflow guard + semantic-transfer handles long payloads uniformly.
            output:
              result?.output && typeof result.output === "object" && !Array.isArray(result.output)
                ? result.output
                : {},
            // Email connector attachments are ordinary connector artifacts; do not
            // promote connector stdout transfer-like fields as semantic-transfer output here.
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
