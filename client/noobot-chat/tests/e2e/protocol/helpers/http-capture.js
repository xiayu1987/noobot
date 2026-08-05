/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function findHttpExchanges(capture, predicate = () => true) {
  const requests = (capture?.httpRequests || []).filter(predicate);
  return requests.map((request) => ({
    request,
    responses: (capture?.httpResponses || []).filter((response) => response.url === request.url),
  }));
}

export function findReplaceTurnExchanges(capture) {
  return findHttpExchanges(capture, (request) => /replace-turn/i.test(request.url));
}
