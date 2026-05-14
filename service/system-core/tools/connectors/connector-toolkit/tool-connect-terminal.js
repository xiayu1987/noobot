/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { normalizeTerminalType } from "../../../config/index.js";
import { tTool } from "../../core/tool-i18n.js";
import { createConnectConnectorTool } from "../base-connector-tool.js";
import {
  normalizeProvidedTerminalDefaults,
  terminalFields,
} from "./connector-fields.js";

export function createTerminalConnectorTools(context = {}) {
  const { runtime } = context;
  return [
    createConnectConnectorTool({
      connectorType: "terminal",
      toolName: "terminal_connect_connector",
      extraSchemaParams: [
        {
          name: "terminal_type",
          zodType: z.string(),
        },
      ],
      normalizeDefaults: normalizeProvidedTerminalDefaults,
      getFields: (type, locale) => terminalFields(type, locale),
      typeParamName: "terminal_type",
      resolveTypeValue: (inputParams) =>
        normalizeTerminalType(inputParams?.terminal_type),
      validateType: (type) => {
        if (!type) {
          return tTool(runtime, "tools.terminal_connector.errorInvalidType");
        }
        return undefined;
      },
      context,
    }),
  ];
}
