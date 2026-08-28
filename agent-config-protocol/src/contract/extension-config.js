/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MCP_SERVER_TYPE } from "../enums.js";
import { CONFIG_DOCUMENT_SCOPE, CONFIG_NODE_POLICY } from "./repair.js";

const stringField = Object.freeze({ type: "string" });
const nonEmptyStringField = Object.freeze({ type: "string", nonEmpty: true });
const booleanField = Object.freeze({ type: "boolean" });

const endpointContract = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    description: stringField,
    prompt: stringField,
    custom_param_format: stringField,
    url: stringField,
    query_string_format: stringField,
    body_format: stringField,
  }),
});

export const CONFIG_EXTENSION_ENTRY_CONTRACTS = Object.freeze({
  plugins: Object.freeze({
    type: "object",
    additionalProperties: true,
  }),
  services: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({
      enabled: booleanField,
      api_key: stringField,
      handler: nonEmptyStringField,
      prompt: stringField,
      endpoints: Object.freeze({
        type: "object",
        additionalProperties: endpointContract,
      }),
    }),
    required: Object.freeze(["handler", "endpoints"]),
  }),
  mcp_servers: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({
      type: Object.freeze({
        type: "string",
        values: Object.freeze(Object.values(MCP_SERVER_TYPE)),
      }),
      description: stringField,
      prompt: stringField,
      isActive: booleanField,
      name: stringField,
      baseUrl: nonEmptyStringField,
      headers: Object.freeze({
        type: "object",
        additionalProperties: stringField,
      }),
    }),
    required: Object.freeze(["baseUrl", "type"]),
  }),
});

const optionalNode = (contract) =>
  Object.freeze({ policy: CONFIG_NODE_POLICY.USER_OPTIONAL, contract });

const userOptionalRootContract = Object.freeze({
  context: optionalNode(Object.freeze({ type: "object", additionalProperties: true })),
  session: optionalNode(
    Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: Object.freeze({
        executionBundleTimeoutMs: Object.freeze({ type: "integer", minimum: 1 }),
      }),
    }),
  ),
});

export const CONFIG_OPTIONAL_ROOT_CONTRACTS = Object.freeze({
  [CONFIG_DOCUMENT_SCOPE.GLOBAL]: Object.freeze({
    desktop: optionalNode(
      Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({
          dependency_proxy_url: stringField,
        }),
      }),
    ),
    memory: optionalNode(
      Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({
          summarizeTimeoutMs: Object.freeze({ type: "integer", minimum: 1 }),
          postprocess_async: booleanField,
        }),
      }),
    ),
    session: optionalNode(
      Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({
          executionBundleTimeoutMs: Object.freeze({ type: "integer", minimum: 1 }),
        }),
      }),
    ),
  }),
  [CONFIG_DOCUMENT_SCOPE.USER_DEFAULT]: userOptionalRootContract,
  [CONFIG_DOCUMENT_SCOPE.USER]: userOptionalRootContract,
});
