/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SEARCH_MANUAL = {
  search: {
    summary: "Search workspace files or a given string, returning matched lines with context.",
    usage: [
      "search({ source: 'files', query, glob, path, isRegex, caseSensitive, contextLines, maxResults, riskLevel })",
      "search({ source: 'text', query, text, isRegex, caseSensitive, contextLines, maxResults, riskLevel })",
    ],
    params: {
      source:
        "Search source. files searches workspace files; text searches the string given in the text param.",
      query: "Required non-empty keyword or regex. Do not call with an empty string.",
      text: "Text to search, used only when source is text.",
      path: "Restrict the search directory, optional. Narrowing the scope speeds things up noticeably.",
      glob: "File name pattern, e.g. *.js.",
      isRegex: "Whether query is interpreted as a regex.",
      caseSensitive: "Whether the search is case-sensitive.",
      contextLines: "Context lines returned per match, default 2.",
      maxResults: "Maximum matches, default 50.",
      riskLevel:
        "Operation risk level. Must be critical when the search may surface privacy data, credentials, or secrets.",
    },
    notes: [
      "Prefer search over grep or find inside a script: it is visible to the user and bound by the path policy.",
      "Start with a broad query to map the distribution, then narrow with glob and path rather than writing one elaborate regex.",
      "When matches are truncated by maxResults, raise the limit or narrow the query instead of concluding that is all of them.",
    ],
    pitfalls: [
      "An empty query fails outright; there is no list-everything semantics.",
      "When sizing a change, exclude session snapshots, build output, and dependency directories, or historical files will inflate the count.",
    ],
  },
};
