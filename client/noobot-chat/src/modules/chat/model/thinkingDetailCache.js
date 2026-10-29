/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import {
  collectTurnLookupKeyErrors,
  requireTurnLookupKey,
} from "@noobot/session-protocol/turn-lookup-key";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isCanonicalText, isFunction } from "@noobot/shared/value";
import { isApiRequestNotFound } from "@noobot/shared/request-error";

const cache = reactive({ entries: {} });
const inflight = new Map();

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithMissingDetailRetry(runFetch, identity, { retryLimit, retryDelayMs }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runFetch({
        sessionId: identity.sessionId,
        dialogProcessId: identity.dialogProcessId,
        turnScopeId: identity.turnScopeId,
      });
    } catch (error) {
      if (!isApiRequestNotFound(error) || attempt >= retryLimit) throw error;
      await wait(retryDelayMs);
    }
  }
}

function messageTurnLookupKey(messageItem) {
  return { turnScopeId: messageItem.turnScopeId, dialogProcessId: messageItem.dialogProcessId };
}

function createThinkingDetailIdentity(sessionId, lookupKey) {
  return Object.freeze({
    sessionId,
    turnScopeId: lookupKey.turnScopeId,
    dialogProcessId: lookupKey.dialogProcessId,
    key: `${sessionId}::${lookupKey.turnScopeId}::${lookupKey.dialogProcessId}`,
  });
}

export function resolveThinkingDetailIdentity(messageItem, sessionId) {
  const candidate = messageTurnLookupKey(messageItem);
  if (!isCanonicalText(sessionId) || collectTurnLookupKeyErrors(candidate).length > 0) return null;
  return createThinkingDetailIdentity(sessionId, requireTurnLookupKey(candidate));
}

export function getCachedThinkingDetail(identity) {
  if (identity === null) return null;
  return cache.entries[identity.key]?.data || null;
}

export async function loadThinkingDetail({
  sessionId,
  messageItem,
  fetchThinkingDetail,
  retryLimit = QUANTITY_THRESHOLDS.client.thinkingDetailRetryLimit,
  retryDelayMs = TIME_THRESHOLDS.client.thinkingDetailRetryDelayMs,
}) {
  if (!isFunction(fetchThinkingDetail)) throw new TypeError("fetchThinkingDetail is required");
  if (!isCanonicalText(sessionId)) throw new TypeError("thinking detail sessionId is required");
  const identity = createThinkingDetailIdentity(
    sessionId,
    requireTurnLookupKey(messageTurnLookupKey(messageItem)),
  );
  if (inflight.has(identity.key)) return inflight.get(identity.key);
  const request = (async () => {
    const data = await fetchWithMissingDetailRetry(fetchThinkingDetail, identity, {
      retryLimit,
      retryDelayMs,
    });
    cache.entries[identity.key] = { data, updatedAt: Date.now(), identity };
    return data;
  })().finally(() => inflight.delete(identity.key));
  inflight.set(identity.key, request);
  return request;
}

export function __resetThinkingDetailCacheForTests() {
  cache.entries = {};
  inflight.clear();
}
