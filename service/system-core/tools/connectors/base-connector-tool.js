/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import {
  tToolDescription,
  tToolParamDescription,
} from "../core/tool-schema-i18n.js";
import {
  alignFieldsWithConnectionInfo,
  attachDefaultValuesToFields,
  collectNonSensitiveDefaults,
  getMissingFieldNames,
} from "./connector-toolkit/connector-fields.js";
import {
  mergeConnectionInfo,
  resolveConfiguredConnectorInfo,
} from "./connector-toolkit/connector-resolver.js";
import {
  addRuntimeConnectorChannel,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
  findConnectedConnector,
  isUserCancelledInteraction,
  maskConnectionInfo,
  tConnector,
} from "./connector-toolkit/connector-runtime.js";
import {
  resolveRememberedConnectorInfo,
  resolveRuntimeLocale,
} from "./connector-toolkit/connector-context.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";

/**
 * Build the Zod schema for a connector connect tool.
 *
 * @param {object} runtime
 * @param {string} toolName
 * @param {Array<{name: string, zodType: z.ZodTypeAny}>} [extraParams]
 * @returns {z.ZodObject}
 */
function buildConnectSchema(runtime, toolName, extraParams = []) {
  const shape = {
    connector_name: z
      .string()
      .describe(tToolParamDescription(runtime, toolName, "connector_name")),
    default_values: z
      .union([z.string(), z.object({}).passthrough()])
      .optional()
      .describe(tToolParamDescription(runtime, toolName, "default_values")),
  };
  for (const p of extraParams) {
    shape[p.name] = p.zodType.describe(
      tToolParamDescription(runtime, toolName, p.name),
    );
  }
  return z.object(shape);
}

/**
 * Factory: create a connector "connect" tool.
 *
 * @param {object} opts
 * @param {string}   opts.connectorType       - "email" | "database" | "terminal"
 * @param {string}   opts.toolName            - e.g. "email_connect_connector"
 * @param {Array}    [opts.extraSchemaParams] - extra schema fields
 * @param {Function} opts.normalizeDefaults   - (rawDefaultValues) => object
 * @param {Function} opts.getFields           - (typeValue, locale) => field[]
 * @param {string}   [opts.typeParamName]     - e.g. "database_type"
 * @param {Function} [opts.resolveTypeValue]  - (inputParams) => string | undefined
 * @param {Function} [opts.validateType]      - (typeValue) => errorString | undefined
 * @param {object}   opts.context             - connector tool context
 * @returns {DynamicStructuredTool}
 */
export function createConnectConnectorTool(opts) {
  const {
    connectorType,
    toolName,
    extraSchemaParams = [],
    normalizeDefaults,
    getFields,
    typeParamName,
    resolveTypeValue,
    validateType,
    context,
  } = opts;

  const {
    runtime,
    store,
    historyStore,
    connectorEventListener,
    rootSessionId,
    allowUserInteraction,
    bridge,
    dialogProcessId,
    sessionId,
    effectiveConfig,
  } = context;

  const schema = buildConnectSchema(runtime, toolName, extraSchemaParams);

  const func = async (inputParams) => {
    const runtimeLocale = resolveRuntimeLocale(runtime);

    // --- pre-checks ---
    if (!store || typeof store.connectConnector !== "function") {
      throw recoverableToolError(tTool(runtime, "connectors.storeMissing"), {
        code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
      });
    }
    if (!rootSessionId) {
      throw recoverableToolError(tTool(runtime, "connectors.rootSessionMissing"), {
        code: ERROR_CODE.RECOVERABLE_ROOT_SESSION_MISSING,
      });
    }

    const connectorName = String(inputParams.connector_name || "").trim();
    if (!connectorName) {
      throw recoverableToolError(tTool(runtime, "connectors.connectorNameRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }

    // resolve type value dynamically from inputParams
    const typeValue = resolveTypeValue
      ? resolveTypeValue(inputParams)
      : undefined;

    // optional type validation
    if (validateType) {
      const typeError = validateType(typeValue);
      if (typeError) {
        throw recoverableToolError(typeError, {
          code: ERROR_CODE.RECOVERABLE_INVALID_CONNECTOR_TYPE,
        });
      }
    }

    // --- already connected? ---
    const existingConnected = findConnectedConnector({
      store,
      rootSessionId,
      connectorName,
      connectorType,
    });
    if (existingConnected) {
      connectorEventListener?.onConnectorAlreadyConnected?.({
        connectorType,
        connectorName,
      });
      return buildAlreadyConnectedResponse(toolName, existingConnected, runtime);
    }

    // --- merge connection info ---
    let connectionInfo = resolveConfiguredConnectorInfo({
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
    const providedDefaults = normalizeDefaults(inputParams.default_values);
    connectionInfo = mergeConnectionInfo(connectionInfo, rememberedConnectionInfo);
    connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);

    // merge type param if applicable
    if (typeParamName && typeValue) {
      connectionInfo = mergeConnectionInfo(connectionInfo, {
        [typeParamName]: typeValue,
      });
    }

    // --- build fields ---
    const baseFields = attachDefaultValuesToFields(
      alignFieldsWithConnectionInfo(
        getFields(typeValue, runtimeLocale),
        connectionInfo,
        runtimeLocale,
      ),
      connectionInfo,
    );
    const fields = [
      {
        name: "connector_name",
        displayName: tConnector(runtime, "connectorNameLabel"),
        required: false,
        default_value: connectorName,
        defaultValue: connectorName,
      },
      ...baseFields.filter(
        (fieldItem) => String(fieldItem?.name || "").trim() !== "connector_name",
      ),
    ];
    const missing = getMissingFieldNames(fields, connectionInfo);
    const needConnectionInfo = missing.length > 0;

    // --- user interaction ---
    if (needConnectionInfo) {
      if (!allowUserInteraction) {
        throw recoverableToolError(
          tConnector(runtime, "missingConnectionInfoNoInteraction"),
          {
            code: ERROR_CODE.RECOVERABLE_MISSING_CONNECTION_INFO,
          },
        );
      }
      if (!bridge?.requestUserInteraction) {
        throw recoverableToolError(
          tTool(
            runtime,
            "tools.connectors.errorUserInteractionBridgeMissing",
          ),
          {
            code: ERROR_CODE.RECOVERABLE_USER_INTERACTION_BRIDGE_MISSING,
          },
        );
      }

      // i18n key: fillEmailConnectionInfo / fillDatabaseConnectionInfo / fillTerminalConnectionInfo
      const i18nKey = `fill${connectorType.charAt(0).toUpperCase()}${connectorType.slice(1)}ConnectionInfo`;
      const i18nVars = typeParamName ? { [typeParamName]: typeValue } : undefined;
      const interactionResult = await bridge.requestUserInteraction({
        content: tConnector(runtime, i18nKey, i18nVars),
        fields,
        dialogProcessId,
        requireEncryption: true,
        sessionId,
        toolName,
        needConnectionInfo: true,
        connectorName,
        connectorType,
        lifecycle: "pending",
        ackMode: "manual",
        resolvedBy: "",
      });
      if (isUserCancelledInteraction(interactionResult)) {
        throw recoverableToolError(tConnector(runtime, "userCancelledAction"), {
          code: ERROR_CODE.RECOVERABLE_USER_CANCELLED,
          details: {
            cancelled: true,
            connectorName,
            connectorType,
          },
        });
      }
      connectionInfo = mergeConnectionInfo(connectionInfo, interactionResult);
    }

    // --- connect ---
    const connected = store.connectConnector({
      sessionId: rootSessionId,
      connectorName,
      connectorType,
      connectionInfo,
    });
    const runtimeStatus = await buildRuntimeConnectorStatus({
      runtime,
      store,
      rootSessionId,
      connectorName,
      connectorType,
    });
    const connectedSuccess = String(runtimeStatus?.status || "") === "connected";

    // build extra payload
    const extraPayload = {
      need_connection_info: needConnectionInfo,
      connection_info_masked: maskConnectionInfo(connectionInfo),
      connection_defaults: collectNonSensitiveDefaults(connectionInfo),
    };
    if (typeParamName) {
      extraPayload[typeParamName] = typeValue;
    }

    if (!connectedSuccess) {
      if (typeof store.disconnectConnector === "function") {
        store.disconnectConnector({
          sessionId: rootSessionId,
          connectorName,
          connectorType,
        });
      }
      throw recoverableToolError(
        String(runtimeStatus?.status_message || tConnector(runtime, "statusUnavailable")),
        {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_CONNECT_FAILED,
          details: buildConnectionStatusPayload({
            runtimeStatus,
            connector: connected,
            extra: extraPayload,
          }),
        },
      );
    }

    addRuntimeConnectorChannel(runtime, connected);
    await connectorEventListener?.onConnectorConnected?.({
      connectorType,
      connectorName,
      connectionInfo,
      connector: connected,
    });
    return toToolJsonResult(
      toolName,
      buildConnectionStatusPayload({
        runtimeStatus,
        connector: connected,
        extra: extraPayload,
      }),
      true,
    );
  };

  return new DynamicStructuredTool({
    name: toolName,
    description: tToolDescription(runtime, toolName),
    schema,
    func,
  });
}
