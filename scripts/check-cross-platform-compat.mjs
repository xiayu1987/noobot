#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  EXEMPTION_KINDS,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addExemptablePatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const ROOT_PACKAGE_FILE = "package.json";
const SOURCE_PATTERNS = Object.freeze({
  unixTempPath: /(["'`])\/(?:tmp|var\/tmp)(?:\/)?\1/,
  posixCommandLookup: /command\s+-v/,
  bashShell: /(["'`])bash\1|(["'`])-lc\2/,
  signalKill: /\.kill\([^)]*["']SIG(?:TERM|KILL)["']/,
  shellSpawn: /\bshell\s*:\s*true\b/,
});
const PACKAGE_SCRIPT_EXPANSION = /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+}/;

function codeLines(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\*.*?\*\//g, " "))
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

function addPackageScriptHits(measurement, file, source) {
  const { scripts } = JSON.parse(source);
  if (scripts === undefined) return;
  for (const [name, command] of Object.entries(scripts)) {
    if (PACKAGE_SCRIPT_EXPANSION.test(command)) {
      addHit(measurement, { file, message: `script ${name} uses POSIX parameter expansion` });
    }
  }
}

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyCodeFiles({
    repositoryRoot,
    extensions: [...CODE_EXTENSIONS, ".json"],
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    if (path.posix.basename(file) === ROOT_PACKAGE_FILE) {
      addPackageScriptHits(measured.posixParameterExpansion, file, source);
      continue;
    }
    if (!CODE_EXTENSIONS.includes(path.posix.extname(file))) continue;
    const code = codeLines(source);
    for (const [rule, pattern] of Object.entries(SOURCE_PATTERNS)) {
      const message = `cross-platform ${rule}`;
      const measurement = measured[rule];
      addExemptablePatternLineHits({
        usage,
        rule,
        measurement,
        file,
        source: code,
        pattern,
        message,
      });
    }
  }
  const rootPackage = await readRepositoryText(ROOT_PACKAGE_FILE);
  addPackageScriptHits(measured.posixParameterExpansion, ROOT_PACKAGE_FILE, rootPackage);
  return measured;
}

const platformGate = "gate the platform explicitly or use a cross-platform API";

export const CHECK = defineCheck({
  id: "cross-platform-compat",
  description: "Production code and npm scripts run on Windows, macOS and Linux",
  rules: {
    unixTempPath: {
      description: "Production code never hard-codes Unix temp directories",
      hint: "use os.tmpdir()",
    },
    posixCommandLookup: {
      description: "Command lookup never relies on the POSIX command builtin",
      hint: "use a cross-platform command lookup",
    },
    bashShell: {
      description: "Production code never assumes bash exists",
      hint: `read the shell from platform-compatibility; ${platformGate}`,
    },
    signalKill: {
      description: "Process termination never relies on POSIX signals alone",
      hint: `terminate through a Windows-aware strategy; ${platformGate}`,
    },
    shellSpawn: {
      description: "Child processes never spawn through an implicit shell",
      hint: "pass an argv array instead of a shell command string",
    },
    posixParameterExpansion: {
      description: "npm scripts never use POSIX shell parameter expansion",
      hint: "move the default into a Node launcher",
    },
  },
  exemptions: [
    {
      id: "platform-shell-catalog",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["bashShell"],
      reason: "platform.js is the single definition of supported shell names",
      match: ["platform-compatibility/src/platform.js"],
    },
    {
      id: "code-preview-language-names",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["bashShell"],
      reason: "code preview lists bash as a syntax-highlighting language name, not a shell",
      match: [
        "client/noobot-chat/src/modules/chat/composables/message/useMessagePreview/constants.js",
      ],
    },
  ],
  baseline: {
    unixTempPath: 0,
    posixCommandLookup: 0,
    bashShell: 0,
    signalKill: 0,
    shellSpawn: 0,
    posixParameterExpansion: 0,
    exemptions: 2,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
