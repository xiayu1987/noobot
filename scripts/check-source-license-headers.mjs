/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

export const CANONICAL_CONTACT = "Contact: 126240622+xiayu1987@users.noreply.github.com";
const REQUIRED_HEADER_LINES = Object.freeze([
  "Copyright (c) 2026 xiayu",
  CANONICAL_CONTACT,
  "SPDX-License-Identifier: MIT",
]);

function sourceWithoutInterpreterDirective(source) {
  const normalizedSource = source.startsWith("\uFEFF") ? source.slice(1) : source;
  if (!normalizedSource.startsWith("#!")) return normalizedSource;
  const lineEnd = normalizedSource.indexOf("\n");
  return lineEnd === -1 ? "" : normalizedSource.slice(lineEnd + 1);
}

function leadingComment(source) {
  const closers = { "/*": "*/", "<!--": "-->" };
  const opener = Object.keys(closers).find((candidate) => source.startsWith(candidate));
  if (!opener) return "";
  const commentEnd = source.indexOf(closers[opener]);
  return commentEnd === -1 ? "" : source.slice(0, commentEnd + closers[opener].length);
}

export function licenseHeaderViolation(source) {
  const header = leadingComment(sourceWithoutInterpreterDirective(source));
  if (!header) return "license header must be the first syntax element (after an optional shebang)";
  const missingLines = REQUIRED_HEADER_LINES.filter((line) => !header.includes(line));
  return missingLines.length ? `header missing ${missingLines.join("; ")}` : "";
}

export function measureLicenseHeaders(root, files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    const message = licenseHeaderViolation(fs.readFileSync(path.join(root, file), "utf8"));
    if (message) addHit(measured.missingHeader, { file, line: 1, message });
  }
  return measured;
}

async function measure() {
  return measureLicenseHeaders(
    repositoryRoot,
    await getFirstPartyCodeFiles({ repositoryRoot, includeTests: true }),
  );
}

export const CHECK = defineCheck({
  id: "source-license-headers",
  description: "First-party code files start with the standard license header",
  rules: {
    missingHeader: {
      description:
        "A code file does not start with the copyright, contact, and SPDX header after an optional shebang",
      hint: "add the standard header; masked contact lines are repaired by npm run fix:source-license-headers",
    },
  },
  exemptions: [],
  baseline: { missingHeader: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
