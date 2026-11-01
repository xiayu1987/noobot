#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCANNED_DIRECTORIES = Object.freeze([
  "agent",
  "agent-proxy",
  "client",
  "i18n",
  "model-proxy",
  "plugin",
  "service",
  "workflow",
]);
const CATEGORY_RULES = [
  {
    category: "length",
    importPath: "@noobot/shared/length-thresholds",
    symbol: "LENGTH_THRESHOLDS",
    namePattern:
      /(CHARS?|BYTES?|STRING(?:_?LENGTH)?|TEXT|PREVIEW|CONTENT|EXTENSION_?LENGTH|TRUNCATE_?LENGTH)/i,
    propPattern:
      /^(?:maxChars|maxLength|maxStringLength|maxBytes|previewChars|contentChars|textChars|maxBufferBytes|maxFileSizeBytes|maxTotalSizeBytes)$/i,
  },
  {
    category: "quantity",
    importPath: "@noobot/shared/quantity-thresholds",
    symbol: "QUANTITY_THRESHOLDS",
    namePattern: /(ITEMS?|COUNT|LIMIT|LINES?|RESULTS?|FILES?|ENTRIES|CONCURRENCY|DEPTH|SIZE)$/i,
    propPattern:
      /^(?:maxItems|maxFileCount|maxSubAgentDepth|maxLines|maxResults|maxFiles|maxEntries|maxBufferEntries|maxSize|limit|concurrency|maxRuns)$/i,
  },
  {
    category: "time",
    importPath: "@noobot/shared/time-thresholds",
    symbol: "TIME_THRESHOLDS",
    namePattern:
      /(TIMEOUT|INTERVAL|DELAY|TTL|AGE|RETENTION|GRACE|DURATION|POLL|DEBOUNCE).*?(MS|SECONDS|DAYS)?$/i,
    propPattern:
      /^(?:timeoutMs|intervalMs|delayMs|ttlMs|maxAgeMs|retentionMs|graceMs|durationSeconds|maxRunAgeDays)$/i,
  },
  {
    category: "turn",
    importPath: "@noobot/shared/turn-thresholds",
    symbol: "TURN_THRESHOLDS",
    namePattern: /(TURNS?|ROUNDS?|ATTEMPTS?|RETRIES|RETRY_?COUNT|MAX_?RETRY)/i,
    propPattern:
      /^(?:maxTurns|turnsThreshold|triggerTurnsThreshold|rounds|maxAttempts|maxRetry|retryCount)$/i,
  },
];

function maskRegionCharacter(cursor, char, next) {
  const masked = char === "\n" ? "\n" : " ";
  if (cursor.state === "lineComment") {
    if (char === "\n") cursor.state = "code";
    return masked;
  }
  if (cursor.state === "blockComment") {
    if (char !== "*" || next !== "/") return masked;
    cursor.index += 1;
    cursor.state = "code";
    return "  ";
  }
  if (char === "\\") {
    cursor.index += 1;
    return "  ";
  }
  if (char === cursor.quote) {
    cursor.state = "code";
    cursor.quote = "";
  }
  return masked;
}

function maskCodeCharacter(cursor, char, next) {
  if (char === "/" && (next === "/" || next === "*")) {
    cursor.index += 1;
    cursor.state = next === "/" ? "lineComment" : "blockComment";
    return "  ";
  }
  if (char !== '"' && char !== "'" && char !== "`") return char;
  cursor.quote = char;
  cursor.state = "string";
  return " ";
}

function stripCommentsAndStrings(text) {
  let out = "";
  const cursor = { index: 0, state: "code", quote: "" };
  for (; cursor.index < text.length; cursor.index += 1) {
    const char = text[cursor.index];
    const next = text[cursor.index + 1];
    out +=
      cursor.state === "code"
        ? maskCodeCharacter(cursor, char, next)
        : maskRegionCharacter(cursor, char, next);
  }
  return out;
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function isAllowedNumericExpression(expr) {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  if (trimmed === "0") return true;
  if (/^(?:Number\.)?MAX_SAFE_INTEGER\b/.test(trimmed)) return true;
  if (/\b(?:LENGTH|QUANTITY|TIME|TURN)_THRESHOLDS\b/.test(trimmed)) return true;
  return false;
}

function expressionLooksNumeric(expr) {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (isAllowedNumericExpression(trimmed)) return false;
  return /^[0-9]/.test(trimmed) || /^[A-Z0-9_]+\s*[*/+-]\s*[0-9]/i.test(trimmed);
}

function classifyName(name, pattern) {
  for (const rule of CATEGORY_RULES) {
    if (rule[pattern].test(name)) return rule;
  }
  return null;
}

const DECLARATION =
  /\b(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Z_$][\w$]*)\s*=\s*(?<expr>[^;\n]+)/g;
const PROPERTY = /\b(?<name>[A-Za-z_$][\w$]*)\s*:\s*(?<expr>[^,\n}]+)/g;

function findPatternThresholds(code, pattern, namePattern) {
  const findings = [];
  for (const match of code.matchAll(pattern)) {
    const { name, expr } = match.groups;
    const rule = classifyName(name, namePattern);
    if (!rule || !expressionLooksNumeric(expr)) continue;
    findings.push({ ...lineAndColumn(code, match.index), name, expr: expr.trim(), rule });
  }
  return findings;
}

export function findScatteredThresholds(text) {
  const code = stripCommentsAndStrings(text);
  return [
    [DECLARATION, "namePattern"],
    [PROPERTY, "propPattern"],
  ].flatMap(([pattern, namePattern]) => findPatternThresholds(code, pattern, namePattern));
}

export async function measureSharedThresholds(files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    for (const { line, name, expr, rule } of findScatteredThresholds(
      await readRepositoryText(file),
    )) {
      addHit(measured[rule.category], {
        file,
        line,
        message: `${name} = ${expr} -> use ${rule.symbol} from ${rule.importPath}`,
      });
    }
  }
  return measured;
}

function categoryRule(category) {
  const { importPath, symbol } = CATEGORY_RULES.find((rule) => rule.category === category);
  return {
    description: `${category} threshold literal declared outside shared/${category}-thresholds.js`,
    hint: `move the value into ${symbol} and import it from ${importPath}`,
  };
}

export const CHECK = defineCheck({
  id: "shared-thresholds",
  description: "Length, quantity, time, and turn thresholds live in shared/*-thresholds.js",
  rules: Object.fromEntries(
    CATEGORY_RULES.map(({ category }) => [category, categoryRule(category)]),
  ),
  exemptions: [],
  baseline: { length: 0, quantity: 0, time: 0, turn: 0, exemptions: 0 },
  measure: async () =>
    measureSharedThresholds(
      await getFirstPartyFilesUnder(SCANNED_DIRECTORIES, {
        repositoryRoot,
        extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
        includeTests: false,
      }),
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
