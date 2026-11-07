/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function buildPatchFileManual(schema, details, encoding) {
  return {
    patch_file: {
      summary: schema.description.text,
      usage: [
        "{{tool:patch_file}}({ patch, baseVersions, contentEncoding, encoding, strip, root, dryRun, riskLevel, format })",
      ],
      params: {
        ...Object.fromEntries(
          Object.entries(schema.params).map(([name, value]) => [name, value.text]),
        ),
        encoding,
      },
      ...details,
    },
  };
}
