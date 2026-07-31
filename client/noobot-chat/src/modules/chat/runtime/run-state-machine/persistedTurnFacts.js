import { normalizeTurnScopeIdKey } from "../../model/messageIdentity.js";

export function resolvePersistedTurnFact(messageItem = {}, sessionDocs = []) {
  const key = normalizeTurnScopeIdKey(messageItem?.turnScopeId);
  if (!key) return {};
  for (const doc of Array.isArray(sessionDocs) ? sessionDocs : []) {
    const timing = (Array.isArray(doc?.turnTimings) ? doc.turnTimings : []).find((item = {}) => normalizeTurnScopeIdKey(item.turnScopeId) === key);
    const status = (Array.isArray(doc?.turnStatuses) ? doc.turnStatuses : []).find((item = {}) => normalizeTurnScopeIdKey(item.turnScopeId) === key);
    if (timing || status) return { timing: timing || null, status: status || null };
  }
  return {};
}
