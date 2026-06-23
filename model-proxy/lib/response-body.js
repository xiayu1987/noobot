/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const zlib = require('zlib');
const util = require('util');
const { tryParseJson } = require('./common');

const gunzip = util.promisify(zlib.gunzip);
const inflate = util.promisify(zlib.inflate);
const brotliDecompress = util.promisify(zlib.brotliDecompress);

async function decodeBodyByEncoding(buffer, encoding) {
  if (!encoding) return buffer;
  const enc = String(encoding).toLowerCase();

  try {
    if (enc.includes('gzip')) return await gunzip(buffer);
    if (enc.includes('deflate')) return await inflate(buffer);
    if (enc.includes('br')) return await brotliDecompress(buffer);
    return buffer;
  } catch (_) {
    return buffer;
  }
}

function normalizeBodyText(text, contentType = '') {
  const ct = String(contentType).toLowerCase();

  if (ct.includes('application/json')) {
    try {
      const obj = JSON.parse(text);
      return JSON.stringify(obj, null, 2);
    } catch {
      return text;
    }
  }

  return text;
}

function normalizeToolCallItem(toolCallItem = {}) {
  if (!toolCallItem || typeof toolCallItem !== 'object') return null;
  const normalizedFunction = toolCallItem.function && typeof toolCallItem.function === 'object'
    ? {
        name: String(toolCallItem.function.name || '').trim(),
        arguments: String(toolCallItem.function.arguments || ''),
      }
    : {};
  const normalized = {
    id: String(toolCallItem.id || '').trim(),
    type: String(toolCallItem.type || '').trim() || 'function',
    function: normalizedFunction,
  };
  if (!normalized.id && !normalized.function?.name && !normalized.function?.arguments) return null;
  return normalized;
}

function extractToolCallsFromJsonPayload(payloadObject = null) {
  if (!payloadObject || typeof payloadObject !== 'object') return [];
  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] : null;
  const messageToolCalls = Array.isArray(firstChoice?.message?.tool_calls)
    ? firstChoice.message.tool_calls
    : [];
  if (messageToolCalls.length) {
    return messageToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
    ? firstChoice.delta.tool_calls
    : [];
  if (deltaToolCalls.length) {
    return deltaToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  return [];
}

function extractFinalTextFromJsonPayload(payloadObject = null) {
  if (!payloadObject || typeof payloadObject !== 'object') return '';

  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] : null;
  const messageContent = String(firstChoice?.message?.content || '').trim();
  if (messageContent) return messageContent;

  const deltaContent = String(firstChoice?.delta?.content || '').trim();
  if (deltaContent) return deltaContent;

  const outputText = payloadObject?.output_text;
  if (typeof outputText === 'string' && outputText.trim()) return outputText.trim();
  if (Array.isArray(outputText)) {
    const joinedOutputText = outputText
      .map((itemValue) => String(itemValue || '').trim())
      .filter(Boolean)
      .join('\n');
    if (joinedOutputText) return joinedOutputText;
  }

  const toolCalls = extractToolCallsFromJsonPayload(payloadObject);
  if (toolCalls.length) {
    return JSON.stringify(
      {
        type: 'tool_calls',
        tool_calls: toolCalls,
      },
      null,
      2,
    );
  }

  return '';
}

function extractFinalTextFromSseBody(sseText = '') {
  const lines = String(sseText || '').split(/\r?\n/);
  const dataPayloads = lines
    .map((lineValue) => String(lineValue || '').trim())
    .filter((lineValue) => lineValue.startsWith('data:'))
    .map((lineValue) => lineValue.slice(5).trim())
    .filter((lineValue) => lineValue && lineValue !== '[DONE]');

  if (!dataPayloads.length) return '';

  let deltaTextBuffer = '';
  let latestResolvedText = '';
  const toolCallBufferByIndex = new Map();

  function upsertToolCallDelta(deltaToolCallItem = {}, fallbackIndex = 0) {
    if (!deltaToolCallItem || typeof deltaToolCallItem !== 'object') return;
    const index = Number.isInteger(deltaToolCallItem.index)
      ? deltaToolCallItem.index
      : fallbackIndex;
    const existed = toolCallBufferByIndex.get(index) || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
    const normalizedType = String(deltaToolCallItem.type || '').trim();
    if (normalizedType) existed.type = normalizedType;
    const normalizedId = String(deltaToolCallItem.id || '').trim();
    if (normalizedId) existed.id = normalizedId;

    const fn = deltaToolCallItem.function && typeof deltaToolCallItem.function === 'object'
      ? deltaToolCallItem.function
      : null;
    if (fn) {
      const namePart = String(fn.name || '');
      if (namePart) existed.function.name = `${existed.function.name || ''}${namePart}`;
      const argsPart = String(fn.arguments || '');
      if (argsPart) existed.function.arguments = `${existed.function.arguments || ''}${argsPart}`;
    }
    toolCallBufferByIndex.set(index, existed);
  }

  for (const payloadText of dataPayloads) {
    const payloadObject = tryParseJson(payloadText);
    if (!payloadObject) {
      latestResolvedText = payloadText;
      continue;
    }
    const payloadResolvedText = extractFinalTextFromJsonPayload(payloadObject);
    if (!payloadResolvedText) continue;

    const payloadChoices = Array.isArray(payloadObject?.choices)
      ? payloadObject.choices
      : [];
    const firstChoice = payloadChoices[0] && typeof payloadChoices[0] === 'object'
      ? payloadChoices[0]
      : null;
    const hasDeltaContent = typeof firstChoice?.delta?.content === 'string';
    if (hasDeltaContent) {
      deltaTextBuffer += String(firstChoice?.delta?.content || '');
      latestResolvedText = deltaTextBuffer;
    } else {
      latestResolvedText = payloadResolvedText;
    }

    const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
      ? firstChoice.delta.tool_calls
      : [];
    if (deltaToolCalls.length) {
      deltaToolCalls.forEach((item, idx) => upsertToolCallDelta(item, idx));
      if (!latestResolvedText) latestResolvedText = '[tool_calls_streaming]';
    }
  }

  if (toolCallBufferByIndex.size && !String(latestResolvedText || '').trim()) {
    const toolCalls = Array.from(toolCallBufferByIndex.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, item]) => normalizeToolCallItem(item))
      .filter(Boolean);
    if (toolCalls.length) {
      return JSON.stringify(
        {
          type: 'tool_calls',
          tool_calls: toolCalls,
        },
        null,
        2,
      );
    }
  }

  return latestResolvedText || dataPayloads[dataPayloads.length - 1];
}

function resolveFinalResponseBodyText(bodyText = '', contentType = '') {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const normalizedBodyText = String(bodyText || '');

  if (normalizedContentType.includes('text/event-stream')) {
    const finalSseText = extractFinalTextFromSseBody(normalizedBodyText);
    return finalSseText || normalizedBodyText;
  }

  if (normalizedContentType.includes('application/json')) {
    const payloadObject = tryParseJson(normalizedBodyText);
    const finalJsonText = extractFinalTextFromJsonPayload(payloadObject);
    if (finalJsonText) return finalJsonText;
    return normalizeBodyText(normalizedBodyText, contentType);
  }

  return normalizedBodyText;
}

module.exports = {
  decodeBodyByEncoding,
  resolveFinalResponseBodyText,
};
