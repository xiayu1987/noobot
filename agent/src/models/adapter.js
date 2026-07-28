/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveDefaultModelSpec as resolveDefaultModelSpecDefault,
  resolveModelSpecByAlias as resolveModelSpecByAliasDefault,
  resolveModelSpecByName as resolveModelSpecByNameDefault,
  resolveSkillModelSpec as resolveSkillModelSpecDefault,
} from "./resolver/index.js";
import {
  createChatModelFromSpec as createChatModelFromSpecDefault,
  createChatModel as createChatModelDefault,
  createChatModelByName as createChatModelByNameDefault,
} from "./factory/chat-model.js";

const defaultModelAdapter = {
  resolveDefaultModelSpec: (...args) => resolveDefaultModelSpecDefault(...args),
  resolveModelSpecByAlias: (...args) => resolveModelSpecByAliasDefault(...args),
  resolveModelSpecByName: (...args) => resolveModelSpecByNameDefault(...args),
  resolveSkillModelSpec: (...args) => resolveSkillModelSpecDefault(...args),
  createChatModelFromSpec: (...args) => createChatModelFromSpecDefault(...args),
  createChatModel: (...args) => createChatModelDefault(...args),
  createChatModelByName: (...args) => createChatModelByNameDefault(...args),
};

let activeModelAdapter = defaultModelAdapter;

function normalizeModelAdapter(adapter = null) {
  const source = adapter && typeof adapter === "object" ? adapter : {};
  return {
    resolveDefaultModelSpec:
      typeof source.resolveDefaultModelSpec === "function"
        ? source.resolveDefaultModelSpec
        : defaultModelAdapter.resolveDefaultModelSpec,
    resolveModelSpecByAlias:
      typeof source.resolveModelSpecByAlias === "function"
        ? source.resolveModelSpecByAlias
        : defaultModelAdapter.resolveModelSpecByAlias,
    resolveModelSpecByName:
      typeof source.resolveModelSpecByName === "function"
        ? source.resolveModelSpecByName
        : defaultModelAdapter.resolveModelSpecByName,
    resolveSkillModelSpec:
      typeof source.resolveSkillModelSpec === "function"
        ? source.resolveSkillModelSpec
        : defaultModelAdapter.resolveSkillModelSpec,
    createChatModelFromSpec:
      typeof source.createChatModelFromSpec === "function"
        ? source.createChatModelFromSpec
        : defaultModelAdapter.createChatModelFromSpec,
    createChatModel:
      typeof source.createChatModel === "function"
        ? source.createChatModel
        : defaultModelAdapter.createChatModel,
    createChatModelByName:
      typeof source.createChatModelByName === "function"
        ? source.createChatModelByName
        : defaultModelAdapter.createChatModelByName,
  };
}

export function setModelAdapter(adapter = null) {
  activeModelAdapter = normalizeModelAdapter(adapter);
  return activeModelAdapter;
}

export function getModelAdapter() {
  return activeModelAdapter;
}

export function resetModelAdapter() {
  activeModelAdapter = defaultModelAdapter;
  return activeModelAdapter;
}

export function resolveDefaultModelSpec(...args) {
  return activeModelAdapter.resolveDefaultModelSpec(...args);
}

export function resolveModelSpecByAlias(...args) {
  return activeModelAdapter.resolveModelSpecByAlias(...args);
}

export function resolveModelSpecByName(...args) {
  return activeModelAdapter.resolveModelSpecByName(...args);
}

export function resolveSkillModelSpec(...args) {
  return activeModelAdapter.resolveSkillModelSpec(...args);
}

export function createChatModelFromSpec(...args) {
  return activeModelAdapter.createChatModelFromSpec(...args);
}

export function createChatModel(...args) {
  return activeModelAdapter.createChatModel(...args);
}

export function createChatModelByName(...args) {
  return activeModelAdapter.createChatModelByName(...args);
}

