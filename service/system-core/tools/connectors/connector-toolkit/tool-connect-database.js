/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { normalizeDatabaseType } from "../../../config/index.js";
import { tTool } from "../../core/tool-i18n.js";
import { createConnectConnectorTool } from "../base-connector-tool.js";
import {
  databaseFields,
  normalizeProvidedDatabaseDefaults,
} from "./connector-fields.js";

export function createDatabaseConnectorTools(context = {}) {
  const { runtime } = context;
  return [
    createConnectConnectorTool({
      connectorType: "database",
      toolName: "database_connect_connector",
      extraSchemaParams: [
        {
          name: "database_type",
          zodType: z.string(),
        },
      ],
      normalizeDefaults: normalizeProvidedDatabaseDefaults,
      getFields: (type, locale) => databaseFields(type, locale),
      typeParamName: "database_type",
      resolveTypeValue: (inputParams) =>
        normalizeDatabaseType(inputParams?.database_type),
      validateType: (type) => {
        if (!type) {
          return tTool(runtime, "tools.database_connector.errorInvalidType");
        }
        return undefined;
      },
      context,
    }),
  ];
}
