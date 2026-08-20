/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, realpath, stat } from "node:fs/promises";
import { filePath as path, isPathWithinRoot, PATH_CAPABILITIES } from "@noobot/path-resolver";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../../config/index.js";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { resolveAuthorizedUserWorkspaceFilePath } from "../../core/check-tool-input.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../../constants/index.js";
import { CONNECTOR_TYPE } from "@noobot/connector-protocol";
import { MIME_TYPE } from "../../../shared/constants/index.js";
import { mapAttachmentRecordsToMetas } from "../../../artifacts/meta-ops.js";

const unique = (values = []) => [
  ...new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
];

function commandFilePolicy({ runtime = {}, connectorType = "" } = {}) {
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const config = effectiveConfig?.tools?.access_connector?.command_file || {};
  const workspaceBasePath = String(runtime?.basePath || runtime?.workspaceBasePath || "").trim();
  const allowedRoots = (Array.isArray(config.allowedRoots) ? config.allowedRoots : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) =>
      path.isAbsolute(item) ? path.resolve(item) : path.resolve(workspaceBasePath || ".", item),
    );
  const extensions =
    BUILTIN_THRESHOLDS.connectorCommandFile.allowedExtensionsByType?.[connectorType] || [];
  return {
    enabled: config.enabled !== false,
    allowedRoots: unique(allowedRoots),
    allowedExtensions: unique(extensions.map((item) => (item.startsWith(".") ? item : `.${item}`))),
    maxBytes: BUILTIN_THRESHOLDS.connectorCommandFile.maxBytes,
  };
}

async function readConnectorCommandFile({ commandFilePath, connectorType, runtime, agentContext }) {
  if (![CONNECTOR_TYPE.DATABASE, CONNECTOR_TYPE.TERMINAL].includes(connectorType)) {
    throw recoverableToolError("command_file_path only supports database/terminal connectors", {
      code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
    });
  }
  const policy = commandFilePolicy({ runtime, connectorType });
  if (!policy.enabled) {
    throw recoverableToolError("command_file_path is disabled", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    });
  }
  const resolution = await resolveAuthorizedUserWorkspaceFilePath({
    filePath: commandFilePath,
    agentContext,
    capability: PATH_CAPABILITIES.DOCUMENT_INPUT,
    mustExist: true,
  });
  await access(resolution.executionPath);
  const [resolvedPath, fileStat] = await Promise.all([
    realpath(resolution.executionPath),
    stat(resolution.executionPath),
  ]);
  if (!fileStat.isFile()) {
    throw recoverableToolError("command_file_path must be a file", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    });
  }
  if (
    policy.allowedRoots.length &&
    !policy.allowedRoots.some((root) => isPathWithinRoot(root, resolvedPath))
  ) {
    throw recoverableToolError("command_file_path is outside allowed roots", {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
    });
  }
  if (fileStat.size > policy.maxBytes) {
    throw recoverableToolError("command_file_path exceeds max bytes", {
      code: ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
    });
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  if (policy.allowedExtensions.length && !policy.allowedExtensions.includes(extension)) {
    throw recoverableToolError("command_file_path extension is not allowed", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    });
  }
  const command = String(await readFile(resolvedPath, "utf8")).trim();
  if (!command) {
    throw recoverableToolError("command file is empty", {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }
  return command;
}

function createEmailAttachmentHandler(runtime = {}) {
  const userId = String(runtime?.userId || "").trim();
  const sessionId = String(runtime?.systemRuntime?.sessionId || "").trim();
  const attachmentService = runtime?.attachmentService || null;
  if (!userId || !sessionId || !attachmentService) return null;
  return async (artifacts = [], options = {}) => {
    if (!Array.isArray(artifacts) || !artifacts.length) return [];
    const generationSource = String(
      options?.generationSource || ARTIFACT_GENERATION_SOURCE.EMAIL_CONNECTOR_READ,
    ).trim();
    const records = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: TOOL_ATTACHMENT_SOURCE.EMAIL,
      generationSource,
      artifacts,
    });
    return {
      attachments: mapAttachmentRecordsToMetas(records, {
        fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
        fallbackGenerationSource: generationSource,
      }),
      transferEnvelopes: [],
    };
  };
}

function assertSelectedConnector(context = {}, connectorId = "") {
  const normalizedId = String(connectorId || "").trim();
  if (!normalizedId || !context.selectedConnectorIds.includes(normalizedId)) {
    throw recoverableToolError("connector_id is not selected for this session", {
      code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISMATCH,
    });
  }
  return normalizedId;
}

function buildAccessConnectorTool(context = {}) {
  return {
    async func({ connector_id, command, command_file_path }) {
      const connectorId = assertSelectedConnector(context, connector_id);
      if (!context.userId || !context.channelStore || !context.registry) {
        throw recoverableToolError("connector runtime is unavailable", {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
        });
      }
      const record = await context.registry.get({ userId: context.userId, connectorId });
      if (!record) {
        throw recoverableToolError("selected connector does not belong to current user", {
          code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISMATCH,
        });
      }
      if (!context.channelStore.getConnector({ userId: context.userId, connectorId })) {
        throw recoverableToolError("selected connector is not connected", {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_NOT_CONNECTED,
        });
      }
      const inlineCommand = String(command || "").trim();
      const commandFilePath = String(command_file_path || "").trim();
      if (Boolean(inlineCommand) === Boolean(commandFilePath)) {
        throw recoverableToolError("provide exactly one of command or command_file_path", {
          code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        });
      }
      const resolvedCommand =
        inlineCommand ||
        (await readConnectorCommandFile({
          commandFilePath,
          connectorType: record.type,
          runtime: context.runtime,
          agentContext: context.agentContext,
        }));
      const result = await context.channelStore.executeConnectorCommand({
        userId: context.userId,
        connectorId,
        command: resolvedCommand,
        emailAttachmentHandler: createEmailAttachmentHandler(context.runtime),
      });
      return toToolJsonResult(
        TOOL_NAME.ACCESS_CONNECTOR,
        {
          ok: result.ok === true,
          status: result.ok ? TOOL_RESULT_STATUS.COMPLETED : TOOL_RESULT_STATUS.FAILED,
          connector: result.connector,
          output: result.output,
        },
        true,
      );
    },
  };
}

export { buildAccessConnectorTool };
