/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PATCH_UPDATE_EXAMPLE } from "../../../patch-file-manual.js";

export const FILE_TOOL_SCHEMA = {
  read_file: {
    description: {
      key: "tools.file.readDescription",
      text: 'Read a text file; each numberedContent line is "lineNumber\\ttext" and the prefix is not file content.',
    },
    params: {
      filePath: {
        key: "tools.file.readFilePathField",
        text: "File path.",
      },
      startLine: {
        key: "tools.file.readStartLineField",
        text: "Start line (1-based); a start past the end of file is an error.",
      },
      endLine: {
        key: "tools.file.readEndLineField",
        text: "End line (1-based); a value past the end of file stops at the last line.",
      },
      maxLines: {
        key: "tools.file.readMaxLinesField",
        text: "Maximum returned lines; hasMore is true when lines remain.",
      },
    },
    texts: {
      "tools.file.fieldEncoding":
        "Text encoding: auto detects UTF BOMs, otherwise UTF-8; UTF-16LE/BE and GB18030 may be explicit. Updates/moves preserve source encoding; new files use UTF-8 in auto mode. Invalid or lossy conversion is rejected.",
    },
  },
  write_file: {
    description: {
      key: "tools.file.writeDescription",
      text: "Write a workspace text file. Returns the file path and a mutation snapshot taken at write time; later edits do not change an existing snapshot. To link the file in a reply, copy the result path verbatim (workspace: relative path; host: absolute path; mount: mount path plus relative path).",
    },
    params: {
      content: {
        key: "tools.file.writeContentField",
        text: "Content to write.",
      },
      filePath: {
        key: "tools.file.writeFilePathField",
        text: "File path.",
      },
    },
    texts: {},
  },
  search: {
    description: {
      key: "tools.search.description",
      text: "Search workspace files, returning matched lines with context.",
    },
    params: {
      query: {
        key: "tools.search.fieldQuery",
        text: "Required non-empty keyword or regex. Do not call search with an empty string.",
      },
      isRegex: {
        key: "tools.search.fieldIsRegex",
        text: "Search query as regex.",
      },
      caseSensitive: {
        key: "tools.search.fieldCaseSensitive",
        text: "Case-sensitive search.",
      },
      path: {
        key: "tools.search.fieldPath",
        text: "File or directory to search.",
      },
      glob: {
        key: "tools.search.fieldGlob",
        text: "File pattern, e.g. *.js.",
      },
      contextLines: {
        key: "tools.search.fieldContextLines",
        text: "Number of context lines.",
      },
      maxResults: {
        key: "tools.search.fieldMaxResults",
        text: "Maximum matches.",
      },
      riskLevel: {
        key: "tools.search.fieldRiskLevel",
        text: "Operation risk level: low, medium, high, or critical. Searches that may retrieve or return privacy information, passwords, tokens, credentials, or secrets must be marked critical.",
      },
    },
    texts: {
      "tools.search.pathKindUnsupported": "path must be a file or directory.",
    },
  },
  patch_file: {
    description: {
      key: "tools.patch_file.description",
      text: "Read the source with {{tool:read_file}} and copy its returned path. Usually pass only patch and riskLevel; runtime validates the read version. Prefer @@ L<line>; bare @@ requires unique continuous context. Order non-overlapping hunks by source location. Reread and rebuild after version conflicts.",
    },
    params: {
      patch: {
        key: "tools.patch_file.fieldPatch",
        text: `Patch content; copy the path returned by read/search. Every apply_patch @@ section must contain a + or - line. Keep context continuous with the edit; context-only sections do not scope later sections. Complete single-file update example\n${PATCH_UPDATE_EXAMPLE}`,
      },
      contentEncoding: {
        key: "tools.patch_file.fieldContentEncoding",
        text: "Default raw; use read_file_numbered only when context/removal lines include read line numbers. Added lines are always literal.",
      },
      baseVersions: {
        key: "tools.patch_file.fieldBaseVersions",
        text: "Usually omit: runtime uses reads visible to this model request; missing or ambiguous parallel versions require rereading. If supplied, cover all sources and destinations [{filePath, sha256}]; values are strictly checked, never replaced. Use read baseSha256 or null for absent targets. Copy path.path, or join path.mount and path.path with / for mounts; strip/root do not rewrite filePath.",
      },
      filePath: {
        key: "tools.patch_file.fieldFilePath",
        text: "Only for headerless apply_patch update hunks: explicitly selects the single target so runtime can supply file and outer markers. Complete patches put paths in file headers.",
      },
      format: {
        key: "tools.patch_file.fieldFormat",
        text: "Patch format; omit it to detect the format from the content. An explicit mismatch is rejected.",
      },
      strip: {
        key: "tools.patch_file.fieldStrip",
        text: "Default 0; set 1 only for a/ or b/ prefixes.",
      },
      root: {
        key: "tools.patch_file.fieldRoot",
        text: "Usually omit; if set, use only a workspace-relative child directory, never an absolute path or .. .",
      },
      dryRun: {
        key: "tools.patch_file.fieldDryRun",
        text: "Validate only, do not write.",
      },
      riskLevel: {
        key: "tools.patch_file.fieldRiskLevel",
        text: "Operation risk level: low, medium, high, or critical. Classify impact and destructiveness using the same standard as script execution.",
      },
    },
    texts: {
      "tools.patch_file.fieldPatchPathHintHost":
        "Regular users must copy the workspace path returned by {{tool:read_file}}/{{tool:search}} exactly; do not rewrite it or add prefixes.",
      "tools.patch_file.fieldPatchPathHintSuperHost":
        "Super administrators must also copy the path returned by {{tool:read_file}}/{{tool:search}} exactly; host absolute paths must not be rewritten or prefixed.",
      "tools.patch_file.fieldRootPathHintSandbox":
        "Usually omit root; sandbox absolute paths are not allowed.",
      "tools.patch_file.fieldRootPathHintHost":
        "Usually omit root; use only a workspace-relative child directory.",
      "tools.patch_file.fieldRootPathHintSuperHost":
        "Usually omit root; host absolute paths are not allowed.",
      "tools.patch_file.rootInvalidHintHost":
        "Usually omit root; if set, use only a workspace-relative child directory, never an absolute path or .. .",
      "tools.patch_file.rootInvalidHintSuperHost":
        "Usually omit root; if set, use only a workspace-relative child directory, never a host absolute path or .. .",
    },
  },
};
