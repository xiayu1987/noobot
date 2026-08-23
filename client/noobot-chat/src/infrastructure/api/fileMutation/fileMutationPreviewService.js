/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getWorkspaceFileMutationDiffApi, getWorkspaceFileMutationFileApi } from "../chat/chatApi.js";

let authenticatedFetcher = null;
async function getMutationFile({ userId = "", sessionId = "", sessionScope = null, mutationId = "" } = {}) {
  const response = await getWorkspaceFileMutationFileApi(
    { userId, sessionId, sessionScope, mutationId },
    authenticatedFetcher ? { fetcher: authenticatedFetcher } : {},
  );
  if (!response?.ok) throw new Error(`failed to load file: ${response?.status || 500}`);
  const data = await response.json();
  if (!data?.ok) throw new Error(data?.error || "file not found");
  return data;
}
export const fileMutationPreviewService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getFile({ userId = "", sessionId = "", sessionScope = null, mutationId = "" } = {}) {
    return getMutationFile({ userId, sessionId, sessionScope, mutationId });
  },
  async getDiff({ userId = "", sessionId = "", sessionScope = null, mutationId = "" } = {}) {
    const response = await getWorkspaceFileMutationDiffApi({ userId, sessionId, sessionScope, mutationId }, authenticatedFetcher ? { fetcher: authenticatedFetcher } : {});
    if (!response?.ok) throw new Error(`failed to load file diff: ${response?.status || 500}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || "file diff not found");
    return data;
  },
  async downloadFile({ userId = "", sessionId = "", sessionScope = null, mutationId = "", fileName = "" } = {}) {
    const data = await getMutationFile({ userId, sessionId, sessionScope, mutationId });
    const content = String(data?.content || "");
    const name = String(fileName || data?.path || "download").split(/[\\/]/).at(-1) || "download";
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
});
