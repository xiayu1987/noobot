/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const PATCH_UPDATE_EXAMPLE = [
  "*** Begin Patch",
  "*** Update File: example.txt",
  "@@ L1",
  "-old",
  "+new",
  "*** End Patch",
].join("\n");

export function buildPatchFileManual(schema, details, encoding) {
  return {
    patch_file: {
      summary: schema.description.text,
      usage: [
        '{{tool:read_file}}({ filePath: "example.txt", riskLevel: "low" })',
        `{{tool:patch_file}}({ patch: ${JSON.stringify(PATCH_UPDATE_EXAMPLE)}, riskLevel: "low" })`,
        `{{tool:patch_file}}({ filePath: "example.txt", patch: ${JSON.stringify("@@ L1\n-old\n+new")}, riskLevel: "low" })`,
        `{{tool:patch_file}}({ patch: ${JSON.stringify("*** Begin Patch\n*** Add File: new.txt\n+hello\n*** End Patch")}, riskLevel: "low" })`,
        "{{tool:patch_file}}({ patch, contentEncoding, encoding, strip, root, dryRun, riskLevel, format, baseVersions })",
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
