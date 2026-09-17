/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelAdapterId } from "./model-adapter.js";
import { MODEL_IMAGE_GENERATION_API_TYPE } from "./model-capabilities.js";
import { MODEL_FAMILY_ID } from "./model-family.js";

export {
  MODEL_ADAPTER_ID,
  MODEL_FAMILY_ADAPTER_FACTS,
  resolveModelAdapterId,
} from "./model-adapter.js";

export const MODEL_PROVIDER_ID = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  ALIBABA: "alibaba",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  ZHIPU: "zhipu",
  KIMI: "kimi",
  XAI: "xai",
  GENERIC: "generic",
});

export const MODEL_PROVIDER_CONFIG_VALUE_TYPE = Object.freeze({
  ARRAY: "array",
  BOOLEAN: "boolean",
  INTEGER: "integer",
  NUMBER: "number",
  OBJECT: "object",
  STRING: "string",
});

export const MODEL_PROVIDER_CONFIG_ACCESS = Object.freeze({
  USER: "user",
  SYSTEM: "system",
});

export const MODEL_PROVIDER_DECLARATION_VISIBILITY = Object.freeze({
  HIDDEN: "hidden",
  USER: "user",
});

const stringField = Object.freeze({ type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING });
const nonEmptyStringField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
  nonEmpty: true,
});
const booleanField = Object.freeze({ type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.BOOLEAN });

export const MODEL_PROVIDER_FIELD_GROUP = Object.freeze({
  CONNECTION: "connection",
  SAMPLING: "sampling",
  REASONING: "reasoning",
  CACHE: "cache",
  CAPABILITY: "capability",
  TRANSPORT: "transport",
});

function providerField(spec, configAccess, meta = {}) {
  return Object.freeze({
    ...spec,
    configAccess,
    declarationVisibility: MODEL_PROVIDER_DECLARATION_VISIBILITY.HIDDEN,
    ...meta,
  });
}

function internalField(spec, meta = {}) {
  return providerField(spec, MODEL_PROVIDER_CONFIG_ACCESS.SYSTEM, meta);
}

function userField(spec, meta = {}) {
  return providerField(spec, MODEL_PROVIDER_CONFIG_ACCESS.USER, meta);
}

function connectionField(spec) {
  return userField(spec, { group: MODEL_PROVIDER_FIELD_GROUP.CONNECTION });
}

function samplingField(spec) {
  return userField(spec, { group: MODEL_PROVIDER_FIELD_GROUP.SAMPLING });
}

function reasoningField(spec, meta = {}) {
  return userField(spec, { group: MODEL_PROVIDER_FIELD_GROUP.REASONING, ...meta });
}

function cacheField(spec, familyScope) {
  return internalField(spec, {
    group: MODEL_PROVIDER_FIELD_GROUP.CACHE,
    ...(familyScope ? { familyScope: Object.freeze([...familyScope]) } : {}),
  });
}

const modalityField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
  values: Object.freeze(["audio", "document", "image", "video"]),
});
const modalityListField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.ARRAY,
  items: modalityField,
});

export const MODEL_REASONING_EFFORT_PARAMETER = Object.freeze({
  REASONING_EFFORT: "reasoning_effort",
  THINKING_LEVEL: "thinking_level",
  ENABLE_THINKING: "enable_thinking",
});

const REASONING_EFFORT_VALUE_SHAPE = Object.freeze({
  [MODEL_REASONING_EFFORT_PARAMETER.REASONING_EFFORT]: "effort",
  [MODEL_REASONING_EFFORT_PARAMETER.THINKING_LEVEL]: "effort",
  [MODEL_REASONING_EFFORT_PARAMETER.ENABLE_THINKING]: "switch",
});

export const MODEL_REASONING_EFFORT_DISABLED = "none";

const reasoningEffortParameterField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
  nonEmpty: true,
  values: Object.freeze(Object.keys(REASONING_EFFORT_VALUE_SHAPE)),
});

function identityText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function literalText(value) {
  return String(value ?? "").trim();
}

export function normalizeModelReasoningConfiguration(provider = {}, fallback = {}) {
  const source = provider && typeof provider === "object" ? provider : {};
  const defaults = fallback && typeof fallback === "object" ? fallback : {};
  const options = [
    ...new Set(
      (Array.isArray(source.reasoning_effort_options)
        ? source.reasoning_effort_options
        : Array.isArray(defaults.reasoning_effort_options)
          ? defaults.reasoning_effort_options
          : []
      )
        .map(identityText)
        .filter(Boolean),
    ),
  ];
  const parameter =
    identityText(source.reasoning_effort_parameter) ||
    identityText(defaults.reasoning_effort_parameter);
  if (!REASONING_EFFORT_VALUE_SHAPE[parameter]) {
    throw new TypeError(
      `unsupported model provider reasoning_effort_parameter: ${parameter || "missing"}`,
    );
  }
  const normalize = (value, fallbackValue) => {
    if (!options.length) return literalText(value) || literalText(fallbackValue);
    const requested = identityText(value) || identityText(fallbackValue);
    return options.includes(requested) ? requested : options[0];
  };
  return Object.freeze({
    reasoning_effort_parameter: parameter,
    reasoning_effort_options: [...options],
    reasoning_effort: normalize(source.reasoning_effort, defaults.reasoning_effort),
    tool_reasoning_effort: normalize(source.tool_reasoning_effort, defaults.tool_reasoning_effort),
  });
}

export function resolveModelReasoningEffortTransportValue(provider = {}, effort = "") {
  const parameter = identityText(provider.reasoning_effort_parameter);
  const shape = REASONING_EFFORT_VALUE_SHAPE[parameter];
  if (!shape) {
    throw new TypeError(
      `unsupported model provider reasoning_effort_parameter: ${parameter || "missing"}`,
    );
  }
  const value = literalText(effort);
  return shape === "switch" ? identityText(value) !== MODEL_REASONING_EFFORT_DISABLED : value;
}

export function buildModelReasoningEffortTransport(provider = {}, effort = "") {
  return {
    [identityText(provider.reasoning_effort_parameter)]: resolveModelReasoningEffortTransportValue(
      provider,
      effort,
    ),
  };
}

export function resolveModelMinimumReasoningEffort(provider = {}) {
  const options = Array.isArray(provider.reasoning_effort_options)
    ? provider.reasoning_effort_options.map(identityText).filter(Boolean)
    : [];
  return options[0] || MODEL_REASONING_EFFORT_DISABLED;
}

export const MODEL_PROVIDER_CONFIG_CONTRACT = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
  additionalProperties: false,
  normalize: normalizeModelReasoningConfiguration,
  properties: Object.freeze({
    enabled: connectionField(booleanField),
    used_for_conversation: connectionField(booleanField),
    api_key: connectionField(stringField),
    base_url: connectionField(stringField),
    model: connectionField(nonEmptyStringField),
    description: connectionField(stringField),
    temperature: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 2,
    }),
    top_p: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 1,
    }),
    top_k: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER,
      minimum: 1,
      maximum: 100,
    }),
    min_p: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 1,
    }),
    frequency_penalty: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: -2,
      maximum: 2,
    }),
    presence_penalty: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: -2,
      maximum: 2,
    }),
    max_tokens: samplingField({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER,
      minimum: 1,
    }),
    reasoning_effort: reasoningField(nonEmptyStringField, {
      optionsField: "reasoning_effort_options",
    }),
    tool_reasoning_effort: reasoningField(nonEmptyStringField, {
      optionsField: "reasoning_effort_options",
    }),
    reasoning_effort_options: internalField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.ARRAY,
        items: nonEmptyStringField,
      },
      {
        group: MODEL_PROVIDER_FIELD_GROUP.REASONING,
        declarationVisibility: MODEL_PROVIDER_DECLARATION_VISIBILITY.USER,
      },
    ),
    reasoning_effort_parameter: internalField(reasoningEffortParameterField, {
      group: MODEL_PROVIDER_FIELD_GROUP.REASONING,
    }),
    use_responses_api: internalField(booleanField, {
      group: MODEL_PROVIDER_FIELD_GROUP.TRANSPORT,
    }),
    extra_body: internalField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
        additionalProperties: true,
      },
      { group: MODEL_PROVIDER_FIELD_GROUP.TRANSPORT },
    ),
    prompt_cache_key: cacheField(stringField, [MODEL_FAMILY_ID.GPT, MODEL_FAMILY_ID.CLAUDE]),
    prompt_cache_retention: cacheField(stringField, [MODEL_FAMILY_ID.GPT, MODEL_FAMILY_ID.CLAUDE]),
    prompt_cache_options: cacheField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
        additionalProperties: true,
      },
      [MODEL_FAMILY_ID.GPT, MODEL_FAMILY_ID.CLAUDE],
    ),
    cache_control: cacheField(
      {
        oneOf: Object.freeze([
          booleanField,
          Object.freeze({
            type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
            additionalProperties: true,
          }),
        ]),
      },
      [MODEL_FAMILY_ID.CLAUDE, MODEL_FAMILY_ID.QWEN],
    ),
    cached_content: cacheField(stringField, [MODEL_FAMILY_ID.GEMINI]),
    capabilities: internalField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
        additionalProperties: false,
        properties: Object.freeze({
          image_generation: booleanField,
          reasoning: booleanField,
          streaming: booleanField,
          tools: booleanField,
          vision: booleanField,
          web_search: booleanField,
        }),
      },
      { group: MODEL_PROVIDER_FIELD_GROUP.CAPABILITY },
    ),
    multimodal_parsing: internalField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
        additionalProperties: false,
        properties: Object.freeze({
          enabled: booleanField,
          input_modalities: modalityListField,
        }),
      },
      { group: MODEL_PROVIDER_FIELD_GROUP.CAPABILITY },
    ),
    multimodal_generation: internalField(
      {
        type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
        additionalProperties: false,
        properties: Object.freeze({
          support_generation: Object.freeze({
            type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
            additionalProperties: false,
            properties: Object.freeze({
              enabled: booleanField,
              support_scope: modalityListField,
              api_type: Object.freeze({
                type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
                values: Object.freeze(Object.values(MODEL_IMAGE_GENERATION_API_TYPE)),
              }),
            }),
          }),
        }),
      },
      { group: MODEL_PROVIDER_FIELD_GROUP.CAPABILITY },
    ),
  }),
  required: Object.freeze(["model"]),
});

const OPERATOR_ID_BY_HOST = Object.freeze({
  "api.openai.com": MODEL_PROVIDER_ID.OPENAI,
  "api.anthropic.com": MODEL_PROVIDER_ID.ANTHROPIC,
  "generativelanguage.googleapis.com": MODEL_PROVIDER_ID.GOOGLE,
  "dashscope.aliyuncs.com": MODEL_PROVIDER_ID.ALIBABA,
  "open.bigmodel.cn": MODEL_PROVIDER_ID.ZHIPU,
  "api.deepseek.com": MODEL_PROVIDER_ID.DEEPSEEK,
  "api.x.ai": MODEL_PROVIDER_ID.XAI,
  "api.moonshot.cn": MODEL_PROVIDER_ID.KIMI,
  "api.moonshot.ai": MODEL_PROVIDER_ID.KIMI,
});

function requireIdentity(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) throw new TypeError(`model spec.${field} is required`);
  return normalized;
}

export function normalizeProviderSpec(input = {}) {
  return Object.freeze({
    operatorId: requireIdentity(input.operatorId, "operatorId"),
    adapterId: resolveModelAdapterId({ modelFamily: input.modelFamily }),
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}

export function resolveModelOperatorId({ baseUrl = "" } = {}) {
  const endpoint = String(baseUrl || "").trim();
  if (!endpoint || /^\$\{[^}]+\}$/.test(endpoint)) return MODEL_PROVIDER_ID.GENERIC;
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw new TypeError(
      "model spec.baseUrl must be an absolute URL or a configuration placeholder",
    );
  }
  return OPERATOR_ID_BY_HOST[host] || MODEL_PROVIDER_ID.GENERIC;
}
