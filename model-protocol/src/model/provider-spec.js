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
  KIMI: "kimi",
  XAI: "xai",
  GENERIC: "generic",
});

export const MODEL_ADAPTER_ID = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
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

/**
 * The reasoning transport parameter each provider accepts, with the value shape
 * it carries on the wire. This table is the only place a parameter name maps to
 * a value shape; nothing infers either from a model name.
 */
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

/**
 * Project a provider's declared reasoning facts into their canonical form.
 * A configured effort outside the declared options is not a supported fact and
 * resolves to the provider's lowest declared option.
 */
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
  if (!options.length) {
    throw new TypeError("model provider reasoning_effort_options is required");
  }
  const parameter =
    identityText(source.reasoning_effort_parameter) ||
    identityText(defaults.reasoning_effort_parameter);
  if (!REASONING_EFFORT_VALUE_SHAPE[parameter]) {
    throw new TypeError(
      `unsupported model provider reasoning_effort_parameter: ${parameter || "missing"}`,
    );
  }
  const normalize = (value, fallbackValue) => {
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

/** The wire value for an effort level, per the parameter's declared shape. */
export function resolveModelReasoningEffortTransportValue(provider = {}, effort = "") {
  const parameter = identityText(provider.reasoning_effort_parameter);
  const shape = REASONING_EFFORT_VALUE_SHAPE[parameter];
  if (!shape) {
    throw new TypeError(
      `unsupported model provider reasoning_effort_parameter: ${parameter || "missing"}`,
    );
  }
  const value = identityText(effort);
  return shape === "switch" ? value !== MODEL_REASONING_EFFORT_DISABLED : value;
}

/** The transport pair for an effort level, keyed by the declared parameter. */
export function buildModelReasoningEffortTransport(provider = {}, effort = "") {
  return {
    [identityText(provider.reasoning_effort_parameter)]: resolveModelReasoningEffortTransportValue(
      provider,
      effort,
    ),
  };
}

/** The provider's lowest declared effort level, used to suppress reasoning. */
export function resolveModelMinimumReasoningEffort(provider = {}) {
  const options = Array.isArray(provider.reasoning_effort_options)
    ? provider.reasoning_effort_options.map(identityText).filter(Boolean)
    : [];
  if (!options.length) {
    throw new TypeError("model provider reasoning_effort_options is required");
  }
  return options[0];
}

export const MODEL_PROVIDER_CONFIG_CONTRACT = Object.freeze({
  type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT,
  additionalProperties: false,
  normalize: normalizeModelReasoningConfiguration,
  properties: Object.freeze({
    enabled: booleanField,
    used_for_conversation: booleanField,
    api_key: stringField,
    base_url: stringField,
    model: nonEmptyStringField,
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
    reasoning_effort_options: Object.freeze({
      type: MODEL_PROVIDER_CONFIG_VALUE_TYPE.ARRAY,
      items: nonEmptyStringField,
    }),
    reasoning_effort_parameter: reasoningEffortParameterField,
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
    adapterId: resolveModelAdapterId(),
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}

/**
 * Every provider in this protocol speaks the OpenAI-compatible transport, so
 * the adapter identity is a protocol constant rather than a configured fact.
 */
export function resolveModelAdapterId() {
  return MODEL_ADAPTER_ID.OPENAI_COMPATIBLE;
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
