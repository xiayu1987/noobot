/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_PROVIDER_ID = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  ALIBABA: "alibaba",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  ZHIPU: "zhipu",
  GENERIC: "generic",
});

export const MODEL_ADAPTER_ID = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
});

const ADAPTER_ID_BY_FORMAT = Object.freeze({
  openai_compatible: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
});

export const MODEL_PROVIDER_CONFIG_VALUE_TYPE = Object.freeze({
  ARRAY: "array",
  BOOLEAN: "boolean",
  INTEGER: "integer",
  NUMBER: "number",
  OBJECT: "object",
  STRING: "string",
});

const stringField = Object.freeze({ type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING });
const nonEmptyStringField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
  nonEmpty: true,
});
const booleanField = Object.freeze({ type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.BOOLEAN });
const modalityField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
  values: Object.freeze(["audio", "document", "image", "video"]),
});
const modalityListField = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.ARRAY,
  items: modalityField,
});

export const MODEL_PROVIDER_CONFIG_CONTRACT = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
  additionalProperties: false,
  properties: Object.freeze({
    enabled: booleanField,
    used_for_conversation: booleanField,
    api_key: stringField,
    base_url: stringField,
    model: nonEmptyStringField,
    format: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING,
      nonEmpty: true,
      values: Object.freeze(Object.keys(ADAPTER_ID_BY_FORMAT)),
    }),
    description: stringField,
    temperature: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 2,
    }),
    top_p: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 1,
    }),
    top_k: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER,
      minimum: 1,
      maximum: 100,
    }),
    min_p: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: 0,
      maximum: 1,
    }),
    frequency_penalty: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: -2,
      maximum: 2,
    }),
    presence_penalty: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER,
      minimum: -2,
      maximum: 2,
    }),
    max_tokens: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER,
      minimum: 1,
    }),
    reasoning_effort: nonEmptyStringField,
    tool_reasoning_effort: nonEmptyStringField,
    enable_thinking: booleanField,
    preserve_thinking: booleanField,
    thinking_budget: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER,
      minimum: 0,
    }),
    use_responses_api: booleanField,
    extra_body: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
      additionalProperties: true,
    }),
    prompt_cache_key: stringField,
    prompt_cache_retention: stringField,
    prompt_cache_options: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
      additionalProperties: true,
    }),
    cache_control: Object.freeze({
      oneOf: Object.freeze([
        booleanField,
        Object.freeze({
          type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
          additionalProperties: true,
        }),
      ]),
    }),
    prompt_cache_control: Object.freeze({
      oneOf: Object.freeze([
        booleanField,
        Object.freeze({
          type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
          additionalProperties: true,
        }),
      ]),
    }),
    cached_content: stringField,
    gemini_cached_content: stringField,
    capabilities: Object.freeze({
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
    }),
    multimodal_parsing: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
      additionalProperties: false,
      properties: Object.freeze({
        enabled: booleanField,
        input_modalities: modalityListField,
      }),
    }),
    multimodal_generation: Object.freeze({
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
              values: Object.freeze(["images_async", "openai_responses"]),
            }),
          }),
        }),
      }),
    }),
  }),
  required: Object.freeze(["format", "model"]),
});

const OPERATOR_ID_BY_HOST = Object.freeze({
  "api.openai.com": MODEL_PROVIDER_ID.OPENAI,
  "api.anthropic.com": MODEL_PROVIDER_ID.ANTHROPIC,
  "generativelanguage.googleapis.com": MODEL_PROVIDER_ID.GOOGLE,
  "dashscope.aliyuncs.com": MODEL_PROVIDER_ID.ALIBABA,
  "open.bigmodel.cn": MODEL_PROVIDER_ID.ZHIPU,
  "api.deepseek.com": MODEL_PROVIDER_ID.DEEPSEEK,
});

function requireIdentity(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) throw new TypeError(`model spec.${field} is required`);
  return normalized;
}

export function normalizeProviderSpec(input = {}) {
  const format = requireIdentity(input.format, "format");
  return Object.freeze({
    operatorId: requireIdentity(input.operatorId, "operatorId"),
    adapterId: resolveModelAdapterId(format),
    format,
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}

export function resolveModelAdapterId(format = "") {
  const normalizedFormat = requireIdentity(format, "format");
  const adapterId = ADAPTER_ID_BY_FORMAT[normalizedFormat];
  if (!adapterId) throw new TypeError(`unsupported model spec.format: ${normalizedFormat}`);
  return adapterId;
}

export function resolveModelOperatorId({ format = "", baseUrl = "" } = {}) {
  const normalizedFormat = requireIdentity(format, "format");
  resolveModelAdapterId(normalizedFormat);
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
