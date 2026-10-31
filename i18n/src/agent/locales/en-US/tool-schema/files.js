/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_TOOL_SCHEMA = {
  read_file: {
    description: {
      key: "tools.file.readDescription",
      text: "Read text file content (line numbers enabled by default).",
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
      includeLineNumbers: {
        key: "tools.file.readIncludeLineNumbersField",
        text: "Whether content includes line numbers.",
      },
      maxLines: {
        key: "tools.file.readMaxLinesField",
        text: "Maximum returned lines; hasMore is true when lines remain.",
      },
    },
    texts: {},
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
      text: "Search files or text, returning matched lines with context.",
    },
    params: {
      source: {
        key: "tools.search.fieldSource",
        text: "Search source: files or text.",
      },
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
        text: "File or directory to search. Only applies when source=files; ignored when source=text.",
      },
      glob: {
        key: "tools.search.fieldGlob",
        text: "File pattern, e.g. *.js. Only applies when source=files; ignored when source=text.",
      },
      text: {
        key: "tools.search.fieldText",
        text: "Text to search. Required and must be non-empty when source=text.",
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
      "tools.search.textRequired": "When source=text, a non-empty text to search is required.",
      "tools.search.pathKindUnsupported": "path must be a file or directory.",
    },
  },
  patch_file: {
    description: {
      key: "tools.patch_file.description",
      text: "Read/search the file first, then use its complete returned path; omit root and do not add project, a/, or b/ prefixes.",
    },
    params: {
      patch: {
        key: "tools.patch_file.fieldPatch",
        text: "Patch content; reuse the complete path and exact context returned by read_file/search.",
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
        "Regular users must copy the workspace path returned by read_file/search exactly; do not rewrite it or add prefixes.",
      "tools.patch_file.fieldPatchPathHintSuperHost":
        "Super administrators must also copy the path returned by read_file/search exactly; host absolute paths must not be rewritten or prefixed.",
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
