/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  downloadHostFileApi,
  downloadWorkspaceFileApi,
  getHostFileApi,
  getWorkspaceFileApi,
} from "./api/chatApi.js";

let authenticatedFetcher = null;

function fetcherOptions() {
  return authenticatedFetcher ? { fetcher: authenticatedFetcher } : {};
}

/** Host-owned, least-privilege access to attachment and generated-file content. */
export const attachmentService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  fetchUrl(url, options = {}) {
    const runFetch = authenticatedFetcher || fetch;
    return runFetch(url, options);
  },
  getWorkspaceFile(params = {}) {
    return getWorkspaceFileApi(params, fetcherOptions());
  },
  downloadWorkspaceFile(params = {}) {
    return downloadWorkspaceFileApi(params, fetcherOptions());
  },
  getHostFile(params = {}) {
    return getHostFileApi(params, fetcherOptions());
  },
  downloadHostFile(params = {}) {
    return downloadHostFileApi(params, fetcherOptions());
  },
});
