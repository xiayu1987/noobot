/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sha256Text, tryParseJson } from './common.js';

function getJsonPathValue(source, pathItems = []) {
  let current = source;
  for (const pathItem of pathItems) {
    if (current === null || current === undefined) return undefined;
    current = current[pathItem];
  }
  return current;
}

function firstFiniteNumber(source, pathCandidates = []) {
  for (const pathItems of pathCandidates) {
    const value = getJsonPathValue(source, pathItems);
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function collectProviderCacheFields(source, prefix = '', output = {}) {
  if (!source || typeof source !== 'object') return output;
  for (const [key, value] of Object.entries(source)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey.includes('cache') || normalizedKey.includes('cached')) {
      output[fieldPath] = value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectProviderCacheFields(value, fieldPath, output);
    }
  }
  return output;
}

function computeCommonPrefixLength(left = '', right = '') {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function normalizeCacheDiagnosticsNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function createRequestCacheDiagnosticsTracker() {
  const lastRequestBodyByScope = new Map();

  return function buildRequestCacheDiagnostics({
    bodyText = '',
    modelName = '',
    flowName = '',
    sessionId = '',
    parentSessionId = '',
  } = {}) {
    const bodyObject = tryParseJson(bodyText);
    const toolsText = bodyObject ? JSON.stringify(bodyObject.tools || []) : '';
    const messagesText = bodyObject ? JSON.stringify(bodyObject.messages || []) : '';
    const scopeKey = [
      modelName,
      flowName,
      sessionId,
      parentSessionId || '[root]',
      bodyObject?.model || '',
    ].join('|');
    const previousBodyText = lastRequestBodyByScope.get(scopeKey) || '';
    const commonPrefixBytes = previousBodyText
      ? Buffer.byteLength(
        bodyText.slice(0, computeCommonPrefixLength(previousBodyText, bodyText)),
        'utf8',
      )
      : 0;
    lastRequestBodyByScope.set(scopeKey, bodyText);
    return {
      scopeKeySha256: sha256Text(scopeKey).slice(0, 16),
      bodySha256: sha256Text(bodyText),
      bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
      previousBodyBytes: previousBodyText ? Buffer.byteLength(previousBodyText, 'utf8') : 0,
      commonPrefixBytesWithPrevious: commonPrefixBytes,
      commonPrefixCoversPreviousBody: Boolean(
        previousBodyText &&
          commonPrefixBytes >= Math.max(0, Buffer.byteLength(previousBodyText, 'utf8') - 2)
      ),
      requestModel: bodyObject?.model || '',
      toolsCount: Array.isArray(bodyObject?.tools) ? bodyObject.tools.length : 0,
      toolsSha256: toolsText ? sha256Text(toolsText) : '',
      messagesCount: Array.isArray(bodyObject?.messages) ? bodyObject.messages.length : 0,
      messagesSha256: messagesText ? sha256Text(messagesText) : '',
    };
  };
}

function normalizeUsageCacheDiagnostics(responseObject = null) {
  const usage = responseObject && typeof responseObject === 'object'
    ? responseObject.usage || responseObject.response?.usage || responseObject.data?.usage || null
    : null;
  const inputTokens = firstFiniteNumber(responseObject, [
    ['usage', 'prompt_tokens'],
    ['usage', 'input_tokens'],
    ['usage', 'total_input_tokens'],
    ['response', 'usage', 'input_tokens'],
    ['data', 'usage', 'input_tokens'],
  ]);
  const outputTokens = firstFiniteNumber(responseObject, [
    ['usage', 'completion_tokens'],
    ['usage', 'output_tokens'],
    ['usage', 'total_output_tokens'],
    ['response', 'usage', 'output_tokens'],
    ['data', 'usage', 'output_tokens'],
  ]);
  const totalTokens = firstFiniteNumber(responseObject, [
    ['usage', 'total_tokens'],
    ['usage', 'tokens'],
    ['response', 'usage', 'total_tokens'],
    ['data', 'usage', 'total_tokens'],
  ]);
  const cachedInputTokens = firstFiniteNumber(responseObject, [
    ['usage', 'prompt_tokens_details', 'cached_tokens'],
    ['usage', 'input_tokens_details', 'cached_tokens'],
    ['usage', 'input_tokens_details', 'cache_read'],
    ['usage', 'cache_read_input_tokens'],
    ['usage', 'cached_input_tokens'],
    ['usage', 'cache_read_tokens'],
    ['usage', 'cached_tokens'],
    ['response', 'usage', 'input_tokens_details', 'cached_tokens'],
    ['data', 'usage', 'input_tokens_details', 'cached_tokens'],
  ]);
  const cacheCreationInputTokens = firstFiniteNumber(responseObject, [
    ['usage', 'input_tokens_details', 'cache_creation'],
    ['usage', 'cache_creation_input_tokens'],
    ['usage', 'cache_write_input_tokens'],
    ['usage', 'cache_creation_tokens'],
  ]);
  return {
    inputTokens: normalizeCacheDiagnosticsNumber(inputTokens),
    outputTokens: normalizeCacheDiagnosticsNumber(outputTokens),
    totalTokens: normalizeCacheDiagnosticsNumber(totalTokens),
    cachedInputTokens: normalizeCacheDiagnosticsNumber(cachedInputTokens),
    cacheCreationInputTokens: normalizeCacheDiagnosticsNumber(cacheCreationInputTokens),
    cacheHit: cachedInputTokens !== null ? Number(cachedInputTokens) > 0 : null,
    rawUsage: usage || null,
    providerCacheFields: collectProviderCacheFields(responseObject || {}),
  };
}

export {
  createRequestCacheDiagnosticsTracker,
  normalizeUsageCacheDiagnostics,
};
