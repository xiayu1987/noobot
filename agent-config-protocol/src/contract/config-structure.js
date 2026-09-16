/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  MODEL_PROVIDER_CONFIG_ACCESS,
  MODEL_PROVIDER_CONFIG_CONTRACT,
  MODEL_PROVIDER_DECLARATION_VISIBILITY,
} from "@noobot/model-protocol";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_ITEM_TYPE,
  CONFIG_NODE_ACCESS,
  CONFIG_NODE_POLICY,
  CONFIG_PATH_REPRESENTATION,
} from "./repair.js";
import { SNAKE_TO_CANONICAL_KEY_MAP } from "../normalization/keys.js";
import { MCP_SERVER_TYPE, PLUGIN_MODE, PREFERENCE_LANGUAGE, WEB_SEARCH_MODE } from "../enums.js";

export const CONFIG_STRUCTURE_KIND = Object.freeze({
  OBJECT: "object",
  COLLECTION: "collection",
  ARRAY: "array",
  STRING: "string",
  BOOLEAN: "boolean",
  INTEGER: "integer",
  NUMBER: "number",
});

const { USER_OPTIONAL, GLOBAL_ONLY } = CONFIG_NODE_POLICY;
const { BUILTIN, EXPLICIT } = CONFIG_ITEM_TYPE;
const { USER, SYSTEM } = CONFIG_NODE_ACCESS;

const SYSTEM_CONFIG_SCOPES = Object.freeze([
  CONFIG_DOCUMENT_SCOPE.GLOBAL,
  CONFIG_DOCUMENT_SCOPE.USER_DEFAULT,
]);

const builtin = (options = {}) => ({
  itemType: BUILTIN,
  access: SYSTEM,
  policy: USER_OPTIONAL,
  scopes: SYSTEM_CONFIG_SCOPES,
  ...options,
});

const builtinUser = (kind, options = {}) =>
  Object.freeze({ kind, itemType: BUILTIN, access: USER, ...options });

const field = (kind, options = {}) =>
  Object.freeze({ kind, itemType: EXPLICIT, access: USER, ...options });

const systemField = (kind, options = {}) =>
  Object.freeze({ kind, itemType: EXPLICIT, access: SYSTEM, ...options });

const string = (options) => field(CONFIG_STRUCTURE_KIND.STRING, options);
const boolean = (options) => field(CONFIG_STRUCTURE_KIND.BOOLEAN, options);
const integer = (options) => field(CONFIG_STRUCTURE_KIND.INTEGER, options);
const array = (options) => field(CONFIG_STRUCTURE_KIND.ARRAY, options);

const object = (fields, options = {}) =>
  Object.freeze({
    kind: CONFIG_STRUCTURE_KIND.OBJECT,
    itemType: EXPLICIT,
    access: USER,
    fields: Object.freeze(fields),
    ...options,
  });

const collection = (entry, options = {}) =>
  Object.freeze({
    kind: CONFIG_STRUCTURE_KIND.COLLECTION,
    itemType: EXPLICIT,
    access: USER,
    entry,
    ...options,
  });

const modelReferenceCollection = (options = {}) =>
  collection(string({ nonEmpty: true, modelReference: "model" }), {
    modelReference: "model",
    ...options,
  });

export const CONFIG_STRUCTURE_PLACEHOLDER = "<entry>";

const GLOBAL_SCOPE_ONLY = Object.freeze([CONFIG_DOCUMENT_SCOPE.GLOBAL]);

const toolToggle = (fields = {}) =>
  object({ enabled: boolean(), ...fields }, { requiredFields: Object.freeze(["enabled"]) });

const PLUGIN_MODE_VALUES = Object.freeze(Object.values(PLUGIN_MODE));

const pluginMode = () => string({ nonEmpty: true, values: PLUGIN_MODE_VALUES });

const endpointStructure = object({
  description: string(),
  prompt: string(),
  custom_param_format: string(),
  url: string(),
  query_string_format: string(),
  body_format: string(),
});

const MODEL_PROVIDER_SYSTEM_SCOPES = SYSTEM_CONFIG_SCOPES;

function agentAccessForModelProviderField(spec) {
  if (spec.configAccess === MODEL_PROVIDER_CONFIG_ACCESS.USER) return USER;
  if (spec.configAccess === MODEL_PROVIDER_CONFIG_ACCESS.SYSTEM) return SYSTEM;
  throw new TypeError(`unsupported model provider config access: ${spec.configAccess}`);
}

function modelProviderConfigField(spec) {
  const access = agentAccessForModelProviderField(spec);
  return Object.freeze({
    ...spec,
    itemType: EXPLICIT,
    access,
    ...(access === USER ? {} : { scopes: MODEL_PROVIDER_SYSTEM_SCOPES }),
  });
}

export const MODEL_PROVIDER_AGENT_CONFIG_CONTRACT = Object.freeze({
  ...MODEL_PROVIDER_CONFIG_CONTRACT,
  agentConfigContract: "model_provider",
  properties: Object.freeze(
    Object.fromEntries(
      Object.entries(MODEL_PROVIDER_CONFIG_CONTRACT.properties).map(([field, spec]) => [
        field,
        modelProviderConfigField(spec),
      ]),
    ),
  ),
});

const MODEL_PROVIDER_STRUCTURE_REF = Object.freeze({
  kind: CONFIG_STRUCTURE_KIND.OBJECT,
  itemType: EXPLICIT,
  access: USER,
  delegatedContract: MODEL_PROVIDER_AGENT_CONFIG_CONTRACT,
});

const SANDBOX_MOUNT_STRUCTURE = object({
  source: string({ nonEmpty: true }),
  target: string({ nonEmpty: true }),
});

const SECURITY_STRUCTURE = object(
  {
    trusted_directories: array({
      item: string({ nonEmpty: true }),
      policy: GLOBAL_ONLY,
    }),
    path_policy: object({}, builtin({ open: true, scopes: GLOBAL_SCOPE_ONLY })),
    execution_isolation: object({
      mode: string({ nonEmpty: true }),
      sandbox: object({
        provider: string(),
        scope: string(),
        container_name: string(),
        image: string(),
        lock_wait_timeout_ms: integer({ minimum: 1, policy: GLOBAL_ONLY }),
        mounts: array({ item: SANDBOX_MOUNT_STRUCTURE }),
      }),
    }),
  },
  { policy: GLOBAL_ONLY },
);

const TOOLS_STRUCTURE = object({
  read_file: toolToggle(),
  write_file: toolToggle(),
  list_skills: toolToggle(),
  call_service: toolToggle(),
  call_mcp_task: toolToggle({ maxToolLoopTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }) }),
  switch_model: toolToggle(),
  user_interaction: toolToggle(),
  execute_script: object({ enabled: boolean() }, { policy: GLOBAL_ONLY }),
  execute_native_script: toolToggle(),
  access_connector: toolToggle(),
  web_search: toolToggle({
    mode: string({ nonEmpty: true, values: Object.freeze(Object.values(WEB_SEARCH_MODE)) }),
    model_web_search: object({ model: string({ modelReference: "model" }) }),
    search_engine: object({
      prompt: string(),
      endpoints: object({ search: endpointStructure }),
    }),
  }),
  multimodal_generate: toolToggle(),
  task_summary: toolToggle({
    phaseSummaryLoopTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    phaseSummaryMessageCharsThreshold: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxToolLoopTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
  help: toolToggle({
    helpPromptLoopTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    toolFailureHelpCount: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
});

const SCENARIO_ENTRY_STRUCTURE = object({
  name: string(),
  description: string(),
  model: string({ modelReference: "model" }),
  tools: array({ item: string({ nonEmpty: true }) }),
  context: array({ item: string({ nonEmpty: true }) }),
});

const PLUGINS_STRUCTURE = object({
  harness: object({
    enabled: boolean(),
    mode: pluginMode(),
    stepModels: modelReferenceCollection(),
  }),
  workflow: object({
    enabled: boolean(),
    mode: pluginMode(),
    semanticModel: string({ modelReference: "model" }),
    parallelNodeExecution: boolean({ policy: GLOBAL_ONLY }),
    timeoutMs: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxAutoTransitions: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxParallelNodeAgents: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    miniRunnerMaxTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
  character: object({
    enabled: boolean(),
    mode: pluginMode(),

    characterAssets: array({
      item: object({ id: string({ nonEmpty: true }), name: string(), path: string() }),
      scopes: Object.freeze([CONFIG_DOCUMENT_SCOPE.USER_DEFAULT, CONFIG_DOCUMENT_SCOPE.USER]),
    }),
    selectedCharacterAssetIds: array({
      item: string({ nonEmpty: true }),
      scopes: Object.freeze([CONFIG_DOCUMENT_SCOPE.USER_DEFAULT, CONFIG_DOCUMENT_SCOPE.USER]),
    }),
  }),
});

const SERVICE_ENTRY_STRUCTURE = object(
  {
    enabled: boolean(),
    api_key: string(),
    handler: string({ nonEmpty: true }),
    prompt: string(),
    endpoints: collection(endpointStructure),
  },
  { requiredFields: Object.freeze(["handler", "endpoints"]) },
);

const MCP_SERVER_ENTRY_STRUCTURE = object(
  {
    type: string({ nonEmpty: true, values: Object.freeze(Object.values(MCP_SERVER_TYPE)) }),
    description: string(),
    prompt: string(),
    isActive: boolean(),
    name: string(),
    baseUrl: string({ nonEmpty: true }),
    headers: collection(string()),
  },
  { requiredFields: Object.freeze(["baseUrl", "type"]) },
);

export const CONFIG_STRUCTURE = object({
  workspace_root: systemField(CONFIG_STRUCTURE_KIND.STRING, { policy: GLOBAL_ONLY }),
  workspace_template_path: systemField(CONFIG_STRUCTURE_KIND.STRING, { policy: GLOBAL_ONLY }),
  super_admin: object(
    { user_id: string(), connect_code: string() },
    { itemType: EXPLICIT, access: SYSTEM, policy: GLOBAL_ONLY },
  ),
  streaming: boolean({ policy: GLOBAL_ONLY }),
  security: SECURITY_STRUCTURE,

  attachments: object({}, builtin({ open: true, scopes: GLOBAL_SCOPE_ONLY })),
  desktop: object({ dependency_proxy_url: string() }, builtin({ scopes: GLOBAL_SCOPE_ONLY })),
  memory: object(
    { summarizeTimeoutMs: integer({ minimum: 1 }), postprocess_async: boolean() },
    builtin({ scopes: GLOBAL_SCOPE_ONLY }),
  ),
  session: object({ executionBundleTimeoutMs: integer({ minimum: 1 }) }, builtin()),
  context: object({}, builtin({ open: true })),
  default_provider: string({ nonEmpty: true, modelReference: "conversation" }),
  providers: collection(MODEL_PROVIDER_STRUCTURE_REF),
  multimodal: object({
    parsing: object({
      default_models: object({
        audio: string({ modelReference: "parse:audio" }),
        video: string({ modelReference: "parse:video" }),
        image: string({ modelReference: "parse:image" }),
        document: string({ modelReference: "parse:document" }),
      }),
    }),
    generation: object({
      default_models: object({ image: string({ modelReference: "generate:image" }) }),
    }),
  }),
  tools: TOOLS_STRUCTURE,
  scenarios: object({
    default: string({ nonEmpty: true, documentReference: "scenarios.definitions" }),
    definitions: collection(SCENARIO_ENTRY_STRUCTURE),
  }),
  plugins: PLUGINS_STRUCTURE,
  services: collection(SERVICE_ENTRY_STRUCTURE),
  mcp_servers: collection(MCP_SERVER_ENTRY_STRUCTURE),
  preferences: object({
    language: builtinUser(CONFIG_STRUCTURE_KIND.STRING, {
      nonEmpty: true,
      values: Object.freeze(Object.values(PREFERENCE_LANGUAGE)),
    }),
  }),
});

const ALL_SCOPES = Object.freeze(Object.values(CONFIG_DOCUMENT_SCOPE));

export function structureAllowsScope(node = {}, scope = CONFIG_DOCUMENT_SCOPE.GLOBAL) {
  if (Array.isArray(node.scopes)) return node.scopes.includes(scope);
  if (node.policy === CONFIG_NODE_POLICY.GLOBAL_ONLY) {
    return scope === CONFIG_DOCUMENT_SCOPE.GLOBAL;
  }
  return ALL_SCOPES.includes(scope);
}

export function resolveConfigNodeSemantics(node = {}, scope = CONFIG_DOCUMENT_SCOPE.USER) {
  if (!Object.values(CONFIG_ITEM_TYPE).includes(node.itemType)) {
    throw new TypeError(`unsupported config item type: ${node.itemType}`);
  }
  if (!Object.values(CONFIG_NODE_ACCESS).includes(node.access)) {
    throw new TypeError(`unsupported config node access: ${node.access}`);
  }
  const allowedInScope = structureAllowsScope(node, scope);
  return Object.freeze({
    itemType: node.itemType,
    access: node.access,
    allowedInScope,
    userEditable: allowedInScope && node.access === CONFIG_NODE_ACCESS.USER,
  });
}

export function configNodeAllowsDocument(node = {}, scope = CONFIG_DOCUMENT_SCOPE.GLOBAL) {
  return resolveConfigNodeSemantics(node, scope).allowedInScope;
}

export function isConfigNodeUserEditable(node = {}, scope = CONFIG_DOCUMENT_SCOPE.USER) {
  return resolveConfigNodeSemantics(node, scope).userEditable;
}

function configKeyForRepresentation(key, representation) {
  return representation === CONFIG_PATH_REPRESENTATION.RUNTIME
    ? SNAKE_TO_CANONICAL_KEY_MAP[key] || key
    : key;
}

function projectConfigNode(node, value, options) {
  const { scope, access, representation } = options;
  if (value === undefined || !configNodeAllowsDocument(node, scope)) return undefined;
  if (access && resolveConfigNodeSemantics(node, scope).access !== access) return undefined;
  if (node.delegatedContract) {
    return projectDelegatedContract(node.delegatedContract, value, options);
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, projectConfigNode(node.entry, child, options)])
        .filter(([, child]) => child !== undefined),
    );
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT && node.fields && !node.open) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(
      Object.entries(node.fields)
        .map(([key, child]) => {
          const representedKey = configKeyForRepresentation(key, representation);
          return [representedKey, projectConfigNode(child, value[representedKey], options)];
        })
        .filter(([, child]) => child !== undefined),
    );
  }
  return structuredClone(value);
}

function projectDelegatedContract(contract, value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const properties =
    contract?.properties && typeof contract.properties === "object" ? contract.properties : {};
  return Object.fromEntries(
    Object.entries(properties)
      .map(([key, child]) => [key, projectConfigNode(child, value[key], options)])
      .filter(([, child]) => child !== undefined),
  );
}

export function projectConfigDocumentForScope(document = {}, scope = CONFIG_DOCUMENT_SCOPE.USER) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return {};
  return (
    projectConfigNode(CONFIG_STRUCTURE, document, {
      scope,
      access: null,
      representation: CONFIG_PATH_REPRESENTATION.PERSISTED,
    }) || {}
  );
}

export function projectConfigDocumentForAccess(
  document = {},
  {
    scope = CONFIG_DOCUMENT_SCOPE.USER,
    access = CONFIG_NODE_ACCESS.USER,
    representation = CONFIG_PATH_REPRESENTATION.PERSISTED,
  } = {},
) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return {};
  if (!Object.values(CONFIG_NODE_ACCESS).includes(access)) {
    throw new TypeError(`unsupported config node access: ${access}`);
  }
  if (!Object.values(CONFIG_PATH_REPRESENTATION).includes(representation)) {
    throw new TypeError(`unsupported config path representation: ${representation}`);
  }
  return projectConfigNode(CONFIG_STRUCTURE, document, { scope, access, representation }) || {};
}

export function projectUserVisibleConfigDeclarations(document = {}) {
  const providers = document?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return Object.freeze({ providers: Object.freeze({}) });
  }
  const projectedProviders = Object.fromEntries(
    Object.entries(providers).map(([providerId, provider]) => {
      const declaration = {};
      if (provider && typeof provider === "object" && !Array.isArray(provider)) {
        for (const [field, contract] of Object.entries(
          MODEL_PROVIDER_AGENT_CONFIG_CONTRACT.properties,
        )) {
          if (
            contract?.access !== SYSTEM ||
            contract.declarationVisibility !== MODEL_PROVIDER_DECLARATION_VISIBILITY.USER ||
            !Object.prototype.hasOwnProperty.call(provider, field)
          ) {
            continue;
          }
          declaration[field] = structuredClone(provider[field]);
        }
      }
      return [providerId, Object.freeze(declaration)];
    }),
  );
  return Object.freeze({ providers: Object.freeze(projectedProviders) });
}

function walkStructure(node, path, visit) {
  visit(node, path);
  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT && node.fields) {
    for (const [key, child] of Object.entries(node.fields)) {
      walkStructure(child, [...path, key], visit);
    }
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION && node.entry) {
    walkStructure(node.entry, [...path, CONFIG_STRUCTURE_PLACEHOLDER], visit);
  }
}

function toRuntimePath(path) {
  return path.map((key) => SNAKE_TO_CANONICAL_KEY_MAP[key] || key).join(".");
}

function collectScopeForbiddenPaths(node, path, scope, paths) {
  if (path.length && !structureAllowsScope(node, scope)) {
    paths.push([...path]);
    return;
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT && node.fields) {
    for (const [key, child] of Object.entries(node.fields)) {
      collectScopeForbiddenPaths(child, [...path, key], scope, paths);
    }
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION && node.entry) {
    collectScopeForbiddenPaths(node.entry, [...path, CONFIG_STRUCTURE_PLACEHOLDER], scope, paths);
  }
}

export function listConfigNodePathsByPolicy({
  policy,
  representation = CONFIG_PATH_REPRESENTATION.PERSISTED,
} = {}) {
  if (!Object.values(CONFIG_NODE_POLICY).includes(policy)) {
    throw new TypeError(`unsupported config node policy: ${policy}`);
  }
  if (!Object.values(CONFIG_PATH_REPRESENTATION).includes(representation)) {
    throw new TypeError(`unsupported config path representation: ${representation}`);
  }
  const paths = [];
  if (policy === CONFIG_NODE_POLICY.GLOBAL_ONLY) {
    collectScopeForbiddenPaths(CONFIG_STRUCTURE, [], CONFIG_DOCUMENT_SCOPE.USER, paths);
  } else {
    walkStructure(CONFIG_STRUCTURE, [], (node, path) => {
      if (!path.length) return;
      const declared = node.policy || CONFIG_NODE_POLICY.USER_CONFIGURABLE;
      if (declared === policy) paths.push([...path]);
    });
  }
  return Object.freeze(
    paths.map((path) =>
      representation === CONFIG_PATH_REPRESENTATION.RUNTIME ? toRuntimePath(path) : path.join("."),
    ),
  );
}

export function listStructureModelReferences() {
  const references = [];
  walkStructure(CONFIG_STRUCTURE, [], (node, path) => {
    if (!node.modelReference || !path.length) return;
    references.push(
      Object.freeze({ path: Object.freeze([...path]), requirement: node.modelReference }),
    );
  });
  return Object.freeze(references);
}

export function assertConfigStructure(node = CONFIG_STRUCTURE, path = []) {
  const where = path.length ? path.join(".") : "$";
  if (!node || typeof node !== "object" || typeof node.kind !== "string") {
    throw new TypeError(`config structure node is not declared at ${where}`);
  }
  if (!Object.values(CONFIG_STRUCTURE_KIND).includes(node.kind)) {
    throw new TypeError(`unsupported config structure kind at ${where}: ${node.kind}`);
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT && !node.delegatedContract && !node.open) {
    if (!node.fields || typeof node.fields !== "object") {
      throw new TypeError(`config structure object fields are required at ${where}`);
    }
    for (const [key, child] of Object.entries(node.fields)) {
      assertConfigStructure(child, [...path, key]);
    }
  }
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) {
    if (!node.entry) throw new TypeError(`config collection entry is required at ${where}`);
    assertConfigStructure(node.entry, [...path, CONFIG_STRUCTURE_PLACEHOLDER]);
  }
  return node;
}

assertConfigStructure();
