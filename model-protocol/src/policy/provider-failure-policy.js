/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_KIND as K, createModelFailureClassification } from "../protocol/constants.js";
import { MODEL_PROVIDER_ID as P } from "../model/provider-spec.js";

const SOURCES = Object.freeze({
  [P.OPENAI]: "https://developers.openai.com/api/docs/guides/error-codes",
  [P.ANTHROPIC]: "https://platform.claude.com/docs/en/api/errors",
  [P.GOOGLE]: "https://ai.google.dev/gemini-api/docs/troubleshooting",
  [P.GEMINI]: "https://ai.google.dev/gemini-api/docs/troubleshooting",
  [P.DEEPSEEK]: "https://api-docs.deepseek.com/quick_start/error_codes",
  [P.ALIBABA]: "https://help.aliyun.com/zh/model-studio/error-code",
  [P.ZHIPU]: "https://docs.bigmodel.cn/cn/api/api-code",
  [P.KIMI]: "https://forum.moonshot.ai/t/429-insufficient-balance/244",
  [P.XAI]: "https://docs.x.ai/developers/debugging",
});

function codes(entries) {
  return new Map(entries.flatMap(([kind, values]) => values.map((value) => [value, kind])));
}

const OPENAI_CODES = codes([
  [
    K.QUOTA_EXHAUSTED,
    ["insufficient_quota", "credit_balance_exhausted", "organization_usage_limit_exceeded"],
  ],
  [K.RATE_LIMIT, ["rate_limit_exceeded", "slow_down"]],
  [K.TEMPORARY_UNAVAILABLE, ["server_error"]],
  [K.INVALID_REQUEST, ["invalid_prompt", "invalid_request_error"]],
  [K.CONTEXT_LIMIT, ["context_length_exceeded"]],
  [K.CONTENT_POLICY, ["image_content_policy_violation"]],
]);
const ANTHROPIC_CODES = codes([
  [K.QUOTA_EXHAUSTED, ["enforced_spend_limit_reached"]],
  [K.AUTHENTICATION, ["authentication_error", "permission_error"]],
  [K.INVALID_REQUEST, ["invalid_request_error", "not_found_error", "request_too_large"]],
  [K.RATE_LIMIT, ["rate_limit_error"]],
  [K.TEMPORARY_UNAVAILABLE, ["overloaded_error", "api_error"]],
]);
const GOOGLE_CODES = codes([
  [K.INVALID_REQUEST, ["INVALID_ARGUMENT", "FAILED_PRECONDITION", "NOT_FOUND"]],
  [K.AUTHENTICATION, ["PERMISSION_DENIED", "UNAUTHENTICATED"]],
  [K.UNKNOWN, ["RESOURCE_EXHAUSTED"]],
  [K.TEMPORARY_UNAVAILABLE, ["INTERNAL", "UNAVAILABLE"]],
  [K.TIMEOUT, ["DEADLINE_EXCEEDED"]],
]);
const CODE_RULES = new Map([
  [P.OPENAI, OPENAI_CODES],
  [P.ANTHROPIC, ANTHROPIC_CODES],
  [P.GOOGLE, GOOGLE_CODES],
  [P.GEMINI, GOOGLE_CODES],
  [
    P.ALIBABA,
    codes([
      [K.QUOTA_EXHAUSTED, ["Arrearage"]],
      [K.UNKNOWN, ["insufficient_quota", "Throttling.AllocationQuota"]],
      [K.RATE_LIMIT, ["Throttling", "Throttling.RateQuota"]],
      [
        K.TEMPORARY_UNAVAILABLE,
        ["Throttling.ServiceOverloaded", "Throttling.ResourceExhausted", "ServiceUnavailable"],
      ],
    ]),
  ],
  [
    P.ZHIPU,
    codes([
      [K.QUOTA_EXHAUSTED, ["1113", "1308", "1309", "1310"]],
      [K.RATE_LIMIT, ["1302"]],
      [K.TEMPORARY_UNAVAILABLE, ["1305"]],
      [K.CONTEXT_LIMIT, ["1261"]],
      [K.CONTENT_POLICY, ["1301"]],
      [K.INVALID_REQUEST, ["1210", "1211", "1212", "1213", "1214", "1215"]],
    ]),
  ],
  [P.KIMI, codes([[K.QUOTA_EXHAUSTED, ["exceeded_current_quota_error"]]])],
]);

const STATUS_RULES = new Map([
  [P.OPENAI, new Set([409, 500, 502, 503, 504])],
  [P.ANTHROPIC, new Set([409, 500, 502, 503, 504, 529])],
  [P.GOOGLE, new Set([500, 503])],
  [P.GEMINI, new Set([500, 503])],
  [P.DEEPSEEK, new Set([500, 503])],
  [P.ALIBABA, new Set([500, 502, 503, 504])],
  [P.ZHIPU, new Set([500, 503])],
  [P.XAI, new Set([500, 503])],
]);

function providerCodeKind({ operatorId, status, code, type, detailCode, retryAfterMs }) {
  const rules = CODE_RULES.get(operatorId);
  const codeKind = rules?.get(String(code));
  const typeKind = rules?.get(String(type));
  const detailKind = rules?.get(String(detailCode));
  if (detailKind !== undefined) return detailKind;
  if (typeKind === K.QUOTA_EXHAUSTED) return typeKind;
  if (operatorId === P.ANTHROPIC && status === 429 && retryAfterMs != null) return K.RATE_LIMIT;
  if (codeKind !== undefined) return codeKind;
  if (typeKind !== undefined) return typeKind;
  return undefined;
}

function providerKind(facts) {
  const { operatorId, status } = facts;
  if (status === 401 || status === 403) return K.AUTHENTICATION;
  if (!SOURCES[operatorId]) return K.UNKNOWN;
  if (status === 402 && [P.DEEPSEEK, P.ANTHROPIC].includes(operatorId)) return K.QUOTA_EXHAUSTED;
  const codeKind = providerCodeKind(facts);
  if (codeKind !== undefined) return codeKind;
  if (status === 400 || status === 404 || status === 413 || status === 422)
    return K.INVALID_REQUEST;
  if (status === 429) return [P.DEEPSEEK, P.XAI].includes(operatorId) ? K.RATE_LIMIT : K.UNKNOWN;
  if (status === 408 || (status === 504 && [P.GOOGLE, P.GEMINI].includes(operatorId)))
    return K.TIMEOUT;
  if (STATUS_RULES.get(operatorId)?.has(status)) return K.TEMPORARY_UNAVAILABLE;
  return K.UNKNOWN;
}

export function classifyProviderFailure(facts) {
  return createModelFailureClassification(providerKind(facts));
}
