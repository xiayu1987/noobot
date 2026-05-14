/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { createConnectConnectorTool } from "./base-connector-tool.js";
import {
  databaseFields,
  normalizeDatabaseType,
  normalizeProvidedDatabaseDefaults,
} from "./connector-toolkit.js";
import { tTool } from "../core/tool-i18n.js";

/**
 * Create the database connector connect tool.
 */
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
