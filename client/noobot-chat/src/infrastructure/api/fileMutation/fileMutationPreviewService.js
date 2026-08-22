/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getWorkspaceFileMutationDiffApi, getWorkspaceFileMutationFileApi } from "../chat/chatApi.js";

let authenticatedFetcher = null;
export const fileMutationPreviewService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getFile({ userId = "", mutationId = "" } = {}) {
    const response = await getWorkspaceFileMutationFileApi({ userId, mutationId }, authenticatedFetcher ? { fetcher: authenticatedFetcher } : {});
    if (!response?.ok) throw new Error(`failed to load file: ${response?.status || 500}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || "file not found");
    return data;
  },
  async getDiff({ userId = "", mutationId = "" } = {}) {
    const response = await getWorkspaceFileMutationDiffApi({ userId, mutationId }, authenticatedFetcher ? { fetcher: authenticatedFetcher } : {});
    if (!response?.ok) throw new Error(`failed to load file diff: ${response?.status || 500}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || "file diff not found");
    return data;
  },
});
