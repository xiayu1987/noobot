/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * The single source of truth for explicit configuration FIELDS and STRUCTURE.
 *
 * This contract is deliberately value-free. It declares which fields exist,
 * their type, which scopes may carry them, and where a node opens into a
 * user-owned collection. It never declares a default or a selectable value:
 *
 * - Model values and options come from the model library.
 * - Every other value comes from `service/config/global.config.example.json`.
 *
 * Both value sources are consulted only when a target value is missing or
 * invalid. Structure is never inferred from any template, so adding a provider
 * to the global example cannot widen or narrow the field contract.
 */

import { MODEL_PROVIDER_CONFIG_CONTRACT } from "@noobot/model-protocol";
import { CONFIG_DOCUMENT_SCOPE, CONFIG_ITEM_TYPE, CONFIG_NODE_POLICY } from "./repair.js";
import { MCP_SERVER_TYPE } from "../enums.js";

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

/**
 * A node the global example does not declare. Built-in nodes are not repaired:
 * they are validated and preserved where present, and never added, because
 * repair only repairs explicit configuration.
 */
const builtin = (options = {}) => ({ itemType: BUILTIN, policy: USER_OPTIONAL, ...options });

/** A leaf field. `policy` defaults to user-configurable at every scope. */
const field = (kind, options = {}) => Object.freeze({ kind, itemType: EXPLICIT, ...options });

const string = (options) => field(CONFIG_STRUCTURE_KIND.STRING, options);
const boolean = (options) => field(CONFIG_STRUCTURE_KIND.BOOLEAN, options);
const integer = (options) => field(CONFIG_STRUCTURE_KIND.INTEGER, options);
const array = (options) => field(CONFIG_STRUCTURE_KIND.ARRAY, options);

/** A fixed-shape object node. */
const object = (fields, options = {}) =>
  Object.freeze({
    kind: CONFIG_STRUCTURE_KIND.OBJECT,
    itemType: EXPLICIT,
    fields: Object.freeze(fields),
    ...options,
  });

/**
 * A node whose keys are user-owned. Entry keys are never part of the field
 * contract; only the entry's own shape is. `entryContract` names the contract
 * that governs one entry, so an unknown key is repaired rather than removed.
 */
const collection = (entry, options = {}) =>
  Object.freeze({
    kind: CONFIG_STRUCTURE_KIND.COLLECTION,
    itemType: EXPLICIT,
    entry,
    ...options,
  });

/** A collection whose entries are bare model-reference strings. */
const modelReferenceCollection = (options = {}) =>
  collection(string({ nonEmpty: true }), { modelReference: "model", ...options });

export const CONFIG_STRUCTURE_PLACEHOLDER = "<entry>";

const GLOBAL_SCOPE_ONLY = Object.freeze([CONFIG_DOCUMENT_SCOPE.GLOBAL]);

const toolToggle = (fields = {}) =>
  object({ enabled: boolean(), ...fields }, { requiredFields: Object.freeze(["enabled"]) });

const endpointStructure = object({
  description: string(),
  prompt: string(),
  custom_param_format: string(),
  url: string(),
  query_string_format: string(),
  body_format: string(),
});

/**
 * Provider fields are owned by the model protocol, which is the field authority
 * for model facts. This node delegates to that contract instead of restating it,
 * so a provider field exists in exactly one place.
 */
const MODEL_PROVIDER_STRUCTURE_REF = Object.freeze({
  kind: CONFIG_STRUCTURE_KIND.OBJECT,
  delegatedContract: MODEL_PROVIDER_CONFIG_CONTRACT,
});

const SANDBOX_MOUNT_STRUCTURE = object({
  source: string({ nonEmpty: true }),
  target: string({ nonEmpty: true }),
});

const SECURITY_STRUCTURE = object(
  {
    execution_isolation: object({
      mode: string({ nonEmpty: true }),
      sandbox: object({
        provider: string(),
        scope: string(),
        container_name: string(),
        image: string(),
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
  delegate_task_async: toolToggle({
    waitTimeoutMs: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    pollIntervalMs: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxSubAgentDepth: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
  wait_async_task_result: toolToggle({
    pollIntervalMs: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
  plan_multi_task_collaboration: toolToggle(),
  switch_model: toolToggle(),
  user_interaction: toolToggle(),
  execute_script: object({ enabled: boolean() }, { policy: GLOBAL_ONLY }),
  execute_native_script: toolToggle(),
  access_connector: toolToggle(),
  web_search: toolToggle({
    mode: string({ nonEmpty: true }),
    responses_api: object({ model: string({ modelReference: "model" }) }),
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
  request_help: toolToggle({
    help_services: array({ item: string({ nonEmpty: true }) }),
    help_model: string({ modelReference: "model" }),
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
    mode: string({ nonEmpty: true }),
    stepModels: modelReferenceCollection(),
  }),
  workflow: object({
    enabled: boolean(),
    mode: string({ nonEmpty: true }),
    semanticModel: string({ modelReference: "model" }),
    parallelNodeExecution: boolean({ policy: GLOBAL_ONLY }),
    timeoutMs: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxAutoTransitions: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    maxParallelNodeAgents: integer({ minimum: 1, policy: GLOBAL_ONLY }),
    miniRunnerMaxTurns: integer({ minimum: 1, policy: GLOBAL_ONLY }),
  }),
  character: object({
    enabled: boolean(),
    mode: string({ nonEmpty: true }),
    // Character assets are owned by each user's own workspace, so they exist
    // only in the user scopes and have no global-example counterpart.
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

/**
 * The explicit configuration structure. Every field a configuration document
 * may carry is declared here exactly once, with the scopes allowed to carry it.
 */
export const CONFIG_STRUCTURE = object({
  workspace_root: string({ policy: GLOBAL_ONLY }),
  workspace_template_path: string({ policy: GLOBAL_ONLY }),
  super_admin: object(
    { user_id: string(), connect_code: string() },
    { policy: GLOBAL_ONLY, runtimePath: "superAdmin" },
  ),
  streaming: boolean({ policy: GLOBAL_ONLY }),
  security: SECURITY_STRUCTURE,
  // Built-in nodes: the global example does not declare them, so repair
  // validates and preserves them but never adds or defaults them.
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
    default: string({ nonEmpty: true }),
    definitions: collection(SCENARIO_ENTRY_STRUCTURE),
  }),
  plugins: PLUGINS_STRUCTURE,
  services: collection(SERVICE_ENTRY_STRUCTURE),
  mcp_servers: collection(MCP_SERVER_ENTRY_STRUCTURE, { runtimePath: "mcpServers" }),
  preferences: object({ language: string({ nonEmpty: true }) }),
});

const ALL_SCOPES = Object.freeze(Object.values(CONFIG_DOCUMENT_SCOPE));

/** Whether a scope may carry this node at all. */
export function structureAllowsScope(node = {}, scope = CONFIG_DOCUMENT_SCOPE.GLOBAL) {
  if (Array.isArray(node.scopes)) return node.scopes.includes(scope);
  if (node.policy === CONFIG_NODE_POLICY.GLOBAL_ONLY) {
    return scope === CONFIG_DOCUMENT_SCOPE.GLOBAL;
  }
  return ALL_SCOPES.includes(scope);
}

/** Resolve a node by its dotted path, treating collection keys as entries. */
export function resolveStructureNode(path = [], root = CONFIG_STRUCTURE) {
  let node = root;
  for (const key of path) {
    if (!node) return null;
    if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) {
      node = node.entry;
      continue;
    }
    if (node.kind !== CONFIG_STRUCTURE_KIND.OBJECT || !node.fields) return null;
    node = node.fields[key];
  }
  return node || null;
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

/** Every declared path carrying the given policy, deepest-independent order. */
export function listStructurePathsByPolicy(policy) {
  if (!Object.values(CONFIG_NODE_POLICY).includes(policy)) {
    throw new TypeError(`unsupported config node policy: ${policy}`);
  }
  const paths = [];
  walkStructure(CONFIG_STRUCTURE, [], (node, path) => {
    if (!path.length) return;
    const declared = node.policy || CONFIG_NODE_POLICY.USER_CONFIGURABLE;
    if (declared === policy) paths.push(path.join("."));
  });
  return Object.freeze(paths);
}

/** Every model-reference path and the capability each reference requires. */
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
