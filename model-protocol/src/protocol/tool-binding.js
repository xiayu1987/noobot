/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isObjectLike, isPlainObject } from "@noobot/shared/value";

export const TOOL_BINDING_NAME_MAX_LENGTH = 64;
export const TOOL_CALL_NAME_BINDING = Symbol("toolCallNameBinding");
export const TOOL_MANUAL_PROVIDER = Symbol("toolManualProvider");
const NAME_PATTERN = new RegExp(`^[a-zA-Z0-9_-]{1,${TOOL_BINDING_NAME_MAX_LENGTH}}$`);

export function requireToolCallNameBinding(call) {
  const binding = call[TOOL_CALL_NAME_BINDING];
  if (!binding) throw new TypeError("model tool call requires its request name binding");
  return binding;
}

export function assertToolExecution(binding, toolId, tool) {
  binding.toActiveBindingName(toolId);
  if (tool && tool.name !== toolId)
    throw new TypeError(`tool execution identity mismatch: expected ${toolId}, got ${tool.name}`);
}

export function requireToolBindingName(value, toolId) {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
    throw new TypeError(`invalid tool bindingName for ${toolId}: ${String(value)}`);
  }
  return value;
}

export function resolveToolBindingName(toolId, bindings = {}) {
  if (typeof toolId !== "string" || !toolId.trim()) {
    throw new TypeError("tool identity must be a non-empty string");
  }
  if (Object.hasOwn(bindings, toolId)) {
    return requireToolBindingName(bindings[toolId].bindingName, toolId);
  }
  return requireToolBindingName(toolId, toolId);
}

export function requireToolBindingConfig(bindings = {}) {
  if (!isPlainObject(bindings)) throw new TypeError("tools.bindings must be an object");
  const names = new Map();
  for (const [toolId, entry] of Object.entries(bindings)) {
    requireToolId(toolId);
    if (
      !isPlainObject(entry) ||
      Object.keys(entry).length !== 1 ||
      !Object.hasOwn(entry, "bindingName")
    ) {
      throw new TypeError(`tools.bindings.${toolId} requires only bindingName`);
    }
    const name = requireToolBindingName(entry.bindingName, toolId);
    if (names.has(name))
      throw new TypeError(`duplicate tool bindingName ${name}: ${names.get(name)}, ${toolId}`);
    names.set(name, toolId);
  }
  return bindings;
}

export function requireResponseToolNameBindings(response) {
  if (!isPlainObject(response?.toolNameBindings))
    throw new TypeError("model response.toolNameBindings is required");
  return requireToolBindingConfig(response.toolNameBindings);
}

export function projectBoundModelOutput(response) {
  return { ...response.output, toolNameBindings: requireResponseToolNameBindings(response) };
}

export function requireToolId(toolId) {
  if (typeof toolId !== "string" || !toolId.trim())
    throw new TypeError("tool identity must be a non-empty string");
  return toolId;
}

export function requireUniqueToolIds(toolIds) {
  const seen = new Set();
  for (const toolId of toolIds) {
    requireToolId(toolId);
    if (seen.has(toolId)) throw new TypeError(`duplicate tool identity: ${toolId}`);
    seen.add(toolId);
  }
  return toolIds;
}

export function renderToolNameReferences(value, bindings = {}) {
  if (typeof value === "string") {
    return value.replace(/\{\{tool:[^{}]+\}\}/g, (reference) =>
      resolveToolBindingName(reference.slice(7, -2), bindings),
    );
  }
  if (Array.isArray(value)) return value.map((item) => renderToolNameReferences(item, bindings));
  if (isObjectLike(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderToolNameReferences(item, bindings)]),
    );
  }
  return value;
}

export function createToolNameBinding({
  historyToolIds = [],
  bindings = {},
  tools = [],
  ...unknown
} = {}) {
  if (Object.keys(unknown).length)
    throw new TypeError(`unknown tool binding options: ${Object.keys(unknown).join(", ")}`);
  if (!Array.isArray(tools)) throw new TypeError("tool declarations must be an array");
  requireToolBindingConfig(bindings);
  const definitions = tools.map((tool) => tool?.function || tool);
  const toolIds = requireUniqueToolIds(definitions.map((definition) => definition?.name));
  const manualProviders = new Map();
  for (const definition of definitions) {
    const provider = definition[TOOL_MANUAL_PROVIDER];
    if (provider !== undefined && !isFunction(provider))
      throw new TypeError(`tool manual provider must be a function: ${definition.name}`);
    if (provider) manualProviders.set(definition.name, provider);
  }
  const referenceBindings = Object.fromEntries(
    Object.entries(bindings).map(([id, entry]) => [
      id,
      Object.freeze({ bindingName: entry.bindingName }),
    ]),
  );
  const activeIds = new Set(toolIds);
  const namesById = new Map();
  const idsByName = new Map();
  for (const toolId of new Set([...toolIds, ...historyToolIds])) {
    const bindingName = resolveToolBindingName(toolId, bindings);
    if (idsByName.has(bindingName)) {
      throw new TypeError(
        `duplicate tool bindingName ${bindingName}: ${idsByName.get(bindingName)}, ${toolId}`,
      );
    }
    namesById.set(toolId, bindingName);
    idsByName.set(bindingName, toolId);
  }
  return Object.freeze({
    bindings: Object.freeze(referenceBindings),
    toolIds: Object.freeze([...activeIds]),
    getToolManual(toolId) {
      if (!activeIds.has(toolId)) throw new TypeError(`undeclared tool identity: ${toolId}`);
      const provider = manualProviders.get(toolId);
      if (!provider) return { status: "unsupported" };
      const manual = provider();
      if (!isPlainObject(manual) || !Object.keys(manual).length)
        throw new TypeError(`tool manual must be a non-empty object: ${toolId}`);
      return { status: "available", manual };
    },
    referenceName(toolId) {
      return resolveToolBindingName(toolId, referenceBindings);
    },
    renderReferences(value) {
      return renderToolNameReferences(value, referenceBindings);
    },
    toBindingName(toolId) {
      if (!namesById.has(toolId)) throw new TypeError(`unbound tool identity: ${toolId}`);
      return namesById.get(toolId);
    },
    toActiveBindingName(toolId) {
      if (!activeIds.has(toolId)) throw new TypeError(`undeclared tool identity: ${toolId}`);
      return namesById.get(toolId);
    },
    toToolId(bindingName) {
      const toolId = idsByName.get(bindingName);
      if (!activeIds.has(toolId))
        throw new TypeError(`undeclared tool bindingName: ${bindingName}`);
      return toolId;
    },
  });
}

function mapCall(call, mapName) {
  if (call.type === "signed_tool_call") {
    const expectedName = mapName(call.toolId);
    if (expectedName !== callName(call.providerCall)) {
      throw new TypeError("cannot rename a signed tool call; start a new model context");
    }
    return call.providerCall;
  }
  const name = mapName(callName(call));
  if ((call.signature || call.function?.signature) && name !== callName(call)) {
    throw new TypeError("cannot rename a signed tool call; start a new model context");
  }
  if (call.function) return { ...call, function: { ...call.function, name } };
  return { ...call, name };
}

function callName(call) {
  return call.function ? call.function.name : call.name;
}

export function isClientToolCallBlock(block) {
  return [
    "tool_use",
    "tool_call",
    "function_call",
    "custom_tool_call",
    "signed_tool_call",
  ].includes(block?.type);
}

function mapBlocks(blocks, mapName, restore = false) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!isClientToolCallBlock(block)) return block;
    if (restore && (block.signature || block.function?.signature))
      return { type: "signed_tool_call", toolId: mapName(callName(block)), providerCall: block };
    return mapCall(block, mapName);
  });
}

const MESSAGE_CALL_GROUPS = [
  { key: "tool_calls", blocks: false },
  { key: "content", blocks: true },
  { parent: "additional_kwargs", key: "tool_calls", blocks: false },
  { parent: "response_metadata", key: "output", blocks: true },
];

function* toolMessageGroups(message) {
  for (const group of MESSAGE_CALL_GROUPS) {
    const owner = group.parent ? message[group.parent] : message;
    if (Array.isArray(owner?.[group.key])) yield { ...group, calls: owner[group.key] };
  }
}

export function isToolResultMessage(message) {
  return message.role === "tool" || message.type === "tool";
}

function* groupToolCalls({ blocks, calls }) {
  for (const call of calls) {
    if (!blocks || isClientToolCallBlock(call)) yield call;
  }
}

function* toolMessageCalls(message) {
  for (const group of toolMessageGroups(message)) yield* groupToolCalls(group);
}

function registerToolCallIdentity(names, call) {
  const signed = call.type === "signed_tool_call";
  const source = signed ? call.providerCall : call;
  const id = source.call_id ?? source.id;
  const name = signed ? call.toolId : callName(call);
  if (names.has(id) && names.get(id) !== name)
    throw new TypeError(`conflicting tool call identity: ${id}`);
  names.set(id, name);
}

export function createToolResultIdentityResolver(messages) {
  const names = new Map();
  for (const message of messages) {
    for (const call of toolMessageCalls(message)) registerToolCallIdentity(names, call);
  }
  return (message) => {
    const id = message.tool_call_id;
    if (typeof id !== "string" || !id || !names.has(id))
      throw new TypeError(`tool result requires its matching call: ${id}`);
    const toolId = requireToolId(names.get(id));
    if (message.name !== undefined && message.name !== toolId)
      throw new TypeError(
        `tool result message identity mismatch: expected ${toolId}, got ${message.name}`,
      );
    return toolId;
  };
}

export function projectToolResultName(result, toolId, mapName) {
  requireToolId(toolId);
  if (!Object.hasOwn(result, "toolName")) return result;
  if (result.toolName !== toolId)
    throw new TypeError(
      `tool result identity mismatch: expected ${toolId}, got ${result.toolName}`,
    );
  return { ...result, toolName: mapName(result.toolName) };
}

export function projectToolMessageNames(message, mapName) {
  const projected = Object.assign(Object.create(Object.getPrototypeOf(message)), message);
  if (isToolResultMessage(message) && message.name !== undefined)
    projected.name = mapName(message.name);
  for (const { parent, key, blocks, calls } of toolMessageGroups(message)) {
    const mapped = blocks ? mapBlocks(calls, mapName) : calls.map((call) => mapCall(call, mapName));
    if (parent) projected[parent] = { ...message[parent], [key]: mapped };
    else projected[key] = mapped;
  }
  return projected;
}

export function collectToolMessageIds(messages) {
  const ids = new Set();
  for (const message of messages) {
    if (isToolResultMessage(message) && message.name !== undefined) ids.add(message.name);
    for (const call of toolMessageCalls(message))
      ids.add(call.type === "signed_tool_call" ? call.toolId : callName(call));
  }
  return [...ids];
}

export function projectToolChoiceNames(choice, binding) {
  if (!choice || ["auto", "none", "required", "any"].includes(choice)) return choice;
  if (typeof choice === "string") return binding.toActiveBindingName(choice);
  return mapCall(choice, (name) => binding.toActiveBindingName(name));
}

export function restoreToolOutputNames(output, binding) {
  const mapName = (name) => binding.toToolId(name);
  return {
    ...output,
    toolCalls: output.toolCalls.map((call) => ({
      ...mapCall(call, mapName),
      [TOOL_CALL_NAME_BINDING]: binding,
    })),
    ...(Array.isArray(output.content) ? { content: mapBlocks(output.content, mapName, true) } : {}),
    ...(Array.isArray(output.responseOutput)
      ? { responseOutput: mapBlocks(output.responseOutput, mapName, true) }
      : {}),
  };
}
