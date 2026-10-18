/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CANONICAL_CONTACT } from "./check-source-license-headers.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

const HEADER_REGION_LENGTH = 1024;
const MASKED_CONTACT_LINE = /^([ \t]*(?:\*|\/\/)?[ \t]*)Contact:[^\r\n]*x{3,}[^\r\n]*$/gim;

export function repairMaskedContact(source) {
  const region = source.slice(0, HEADER_REGION_LENGTH);
  const repaired = region.replace(
    MASKED_CONTACT_LINE,
    (_, linePrefix) => `${linePrefix}${CANONICAL_CONTACT}`,
  );
  return repaired + source.slice(HEADER_REGION_LENGTH);
}

export function fixSourceLicenseHeaders(root, files) {
  let repaired = 0;
  for (const file of files) {
    const absolute = path.join(root, file);
    const source = fs.readFileSync(absolute, "utf8");
    const result = repairMaskedContact(source);
    if (result === source) continue;
    fs.writeFileSync(absolute, result, "utf8");
    repaired += 1;
  }
  return repaired;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await getFirstPartyCodeFiles({ repositoryRoot, includeTests: true });
  const repaired = fixSourceLicenseHeaders(repositoryRoot, files);
  process.stdout.write(
    `[fix-source-license-headers] repaired ${repaired} masked contact header(s)\n`,
  );
}
