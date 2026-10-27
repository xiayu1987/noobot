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
} from "../chat/chatApi.js";
import { requireAuthenticatedFetcher } from "../../http/authenticatedHttpService.js";

function fetcherOptions() {
  return { fetcher: requireAuthenticatedFetcher() };
}

export const attachmentService = Object.freeze({
  fetchUrl(url, options = {}) {
    return requireAuthenticatedFetcher()(url, options);
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
