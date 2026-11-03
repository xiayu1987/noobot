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
import { getFirstPartyFilesUnder, getFirstPartySourceRoots } from "./quality/source-inventory.mjs";
import { parse } from "espree";
import { vueScriptRegions } from "./lib/vue-script-regions.mjs";

const CATEGORY_RULES = [
  {
    category: "length",
    importPath: "@noobot/shared/length-thresholds",
    symbol: "LENGTH_THRESHOLDS",
    namePattern:
      /(CHARS?|BYTES?|STRING(?:_?LENGTH)?|TEXT|PREVIEW|CONTENT|EXTENSION_?LENGTH|TRUNCATE_?LENGTH)/i,
    propPattern:
      /^(?:maxChars|maxLength|maxStringLength|maxBytes|previewChars|contentChars|textChars|maxBuffer|maxBufferBytes|maxFileSizeBytes|maxTotalSizeBytes|\w+Bytes|\w+Chars)$/i,
  },
  {
    category: "quantity",
    importPath: "@noobot/shared/quantity-thresholds",
    symbol: "QUANTITY_THRESHOLDS",
    namePattern:
      /(ITEMS?|COUNT|LIMIT|LINES?|RESULTS?|FILES?|ENTRIES|CONCURRENCY|CONNECTIONS|REQUESTS|DEPTH|SIZE)$/i,
    propPattern:
      /^(?:maxItems|maxFileCount|maxSubAgentDepth|maxLines|maxResults|maxFiles|maxEntries|maxBufferEntries|maxSize|limit|concurrency|maxRuns|maxConnections|maxChannelEvents|maxReplayEvents|maxRequests|\w+MaxRecords|maxRedirects)$/i,
  },
  {
    category: "time",
    importPath: "@noobot/shared/time-thresholds",
    symbol: "TIME_THRESHOLDS",
    namePattern:
      /(TIMEOUT|INTERVAL|DELAY|TTL|MAX_?AGE|(?:^|_)AGE(?:_|$)|RETENTION|GRACE|DURATION|POLL|DEBOUNCE).*?(MS|SECONDS|DAYS)?$/i,
    propPattern:
      /^(?:timeout|windowMs|staleMs|pollMs|retainMs|timeoutMs|intervalMs|delayMs|ttlMs|maxAgeMs|retentionMs|graceMs|durationSeconds|maxRunAgeDays|\w+(?:Timeout|Interval|Delay|Ttl|Retention|Window|Grace|Flush)Ms)$/i,
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

function classifyName(name, pattern) {
  if (/(?:VERSION|SCHEMA_VERSION)$/.test(name)) return null;
  if (name === "HTTP_TOO_MANY_REQUESTS") return null;
  return CATEGORY_RULES.find((rule) => rule[pattern].test(name)) ?? null;
}

function numeric(node) {
  if (!node) return false;
  if (node.type === "Literal")
    return (
      typeof node.value === "number" || (typeof node.value === "string" && /^\d+$/.test(node.value))
    );
  if (node.type === "UnaryExpression")
    return ["+", "-"].includes(node.operator) && numeric(node.argument);
  return node.type === "BinaryExpression" && numeric(node.left) && numeric(node.right);
}

function collectCallThreshold(node, add) {
  const name = node.callee.name || node.callee.property?.name || "";
  if (["setTimeout", "setInterval"].includes(name)) {
    add("timeoutMs", node.arguments[1], node.arguments[1]);
    return;
  }
  if (/^env(?:TimeMs|Number)$/.test(name)) {
    const value = node.arguments[name === "envNumber" ? 2 : 1];
    add(String(node.arguments[0]?.value), value, value, "namePattern");
    return;
  }
  if (/timeout|delay|sleep/i.test(name)) add("timeoutMs", node.arguments[0], node.arguments[0]);
}

function scanScript(script) {
  const tree = parse(script, {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    loc: true,
    range: true,
  });
  const findings = [];
  const seen = new Set();
  const add = (name, value, location, pattern = "propPattern") => {
    const rule = classifyName(name, pattern);
    if (!rule || !numeric(value) || (value.type === "Literal" && Number(value.value) === 0)) return;
    const identity = `${value.range[0]}:${rule.category}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    findings.push({
      line: location.loc.start.line,
      column: location.loc.start.column + 1,
      name,
      expr: script.slice(...value.range),
      rule,
    });
  };
  function visit(node, parent, fixed = false) {
    if (!node || typeof node !== "object") return;
    const fixedEnumeration =
      fixed ||
      (node.type === "VariableDeclarator" &&
        /_(?:CODES?|STATUS(?:ES)?|STATES?)$/.test(node.id?.name || ""));
    if (!fixedEnumeration) {
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
        add(
          node.id.name,
          node.init,
          parent,
          /^[A-Z_$][\w$]*$/.test(node.id.name) ? "namePattern" : "propPattern",
        );
      }
      if (node.type === "Property" && !node.computed)
        add(node.key.name || String(node.key.value), node.value, node);
      if (node.type === "AssignmentPattern" && node.left.type === "Identifier")
        add(node.left.name, node.right, node);
      if (node.type === "CallExpression") collectCallThreshold(node, add);
      if (
        node.type === "BinaryExpression" &&
        ["+", "-"].includes(node.operator) &&
        /^Date\.now\(\)$|^performance\.now\(\)$/.test(script.slice(...node.left.range))
      )
        add("timeoutMs", node.right, node.right);
      if (
        node.type === "LogicalExpression" &&
        ["||", "??"].includes(node.operator) &&
        /process\.env\b/.test(script.slice(...node.left.range))
      ) {
        const envKey = script
          .slice(...node.left.range)
          .match(/process\.env(?:\.([A-Z][A-Z_0-9]+)|\[["']([^"']+)["']\])/);
        const name = envKey?.[1] || envKey?.[2] || parent?.id?.name || parent?.key?.name || "";
        add(name, node.right, node.right, "namePattern");
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "range"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node, fixedEnumeration));
      else if (value && typeof value === "object") visit(value, node, fixedEnumeration);
    }
  }
  visit(tree);
  return findings;
}

export function findScatteredThresholds(text, filename = "source.js") {
  return vueScriptRegions(filename, text).flatMap(({ source, offset }) =>
    scanScript(text.slice(0, offset).replace(/[^\r\n]/g, " ") + source),
  );
}

export async function measureSharedThresholds(files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    for (const { line, name, expr, rule } of findScatteredThresholds(
      await readRepositoryText(file),
      file,
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

const THRESHOLD_DECLARATION_FILES =
  /^(?:shared\/(?:time|turn|quantity|length)-thresholds\.js|scripts\/lib\/development-thresholds\.mjs)$/;

export const CHECK = defineCheck({
  id: "shared-thresholds",
  description:
    "Length, quantity, time, and turn thresholds live in shared/*-thresholds.js or development-thresholds",
  rules: Object.fromEntries(
    CATEGORY_RULES.map(({ category }) => [category, categoryRule(category)]),
  ),
  exemptions: [],
  baseline: { length: 0, quantity: 0, time: 0, turn: 0, exemptions: 0 },
  measure: async () =>
    measureSharedThresholds(
      (
        await getFirstPartyFilesUnder(await getFirstPartySourceRoots({ repositoryRoot }), {
          repositoryRoot,
          extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
          includeTests: false,
        })
      ).filter((file) => !THRESHOLD_DECLARATION_FILES.test(file)),
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
