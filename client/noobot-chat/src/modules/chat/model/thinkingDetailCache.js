/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { normalizeTurnScopeIdKey, getMessageDialogProcessId, getMessageSessionId, getMessageTurnScopeId } from "./messageIdentity.js";
import { thinkingDetailService as defaultThinkingDetailService } from "../../../infrastructure/api/thinking/thinkingDetailService.js";

const cache = reactive({ entries: {} });
const inflight = new Map();

function text(value) { return String(value || "").trim(); }

export function thinkingDetailCacheKey({ sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const sid = text(sessionId);
  const turnKey = normalizeTurnScopeIdKey(turnScopeId);
  const route = turnKey || text(dialogProcessId);
  return sid && route ? `${sid}::${route}` : "";
}

export function resolveThinkingDetailIdentity(messageItem = {}, sessionId = "") {
  const resolvedSessionId = text(sessionId) || getMessageSessionId(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  return {
    sessionId: resolvedSessionId,
    turnScopeId,
    turnScopeKey: normalizeTurnScopeIdKey(turnScopeId),
    dialogProcessId,
    key: thinkingDetailCacheKey({ sessionId: resolvedSessionId, turnScopeId, dialogProcessId }),
  };
}

export function getCachedThinkingDetail(identity = {}) {
  const key = identity.key || thinkingDetailCacheKey(identity);
  return key ? cache.entries[key]?.data || null : null;
}

export async function loadThinkingDetail({
  userId = "",
  sessionId = "",
  messageItem = {},
  dialogProcessId = "",
  turnScopeId = "",
  fetchThinkingDetail = null,
  thinkingDetailService = defaultThinkingDetailService,
  refresh = false,
} = {}) {
  const detailService = thinkingDetailService || defaultThinkingDetailService;
  const identity = resolveThinkingDetailIdentity({ ...messageItem, dialogProcessId: dialogProcessId || messageItem?.dialogProcessId, turnScopeId: turnScopeId || messageItem?.turnScopeId }, sessionId);
  if (!identity.key) return null;
  const cached = cache.entries[identity.key];
  if (cached?.data && refresh !== true) return cached.data;
  if (inflight.has(identity.key)) return inflight.get(identity.key);
  const request = (async () => {
    const runFetch = typeof fetchThinkingDetail === "function"
      ? fetchThinkingDetail
      : async (sid, params) => detailService.getDetail({
          userId,
          sessionId: sid,
          dialogProcessId: params.dialogProcessId,
          turnScopeId: params.turnScopeId,
        });
    const data = await runFetch(identity.sessionId, {
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
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
