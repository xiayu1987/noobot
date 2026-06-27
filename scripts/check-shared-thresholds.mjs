#!/usr/bin/env node
/*
 * Shared threshold guard.
 *
 * Length, quantity, turn/count, and time thresholds must live in @noobot/shared
 * so agent, service, plugins, and client do not drift apart. This guard is
 * intentionally conservative: it only flags numeric literals whose
 * identifier/property names clearly look like one of those threshold categories.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, "package.json")) && exists(path.join(cwd, "shared"))) return cwd;
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "package.json")) && exists(path.join(parent, "shared"))) return parent;
  return cwd;
}

const ROOT = resolveRepoRoot();
const TARGET_DIRS = ["agent", "service", "agent-proxy", "model-proxy", "client", "plugin", "workflow", "i18n"];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const SHARED_THRESHOLD_FILES = new Set([
  "shared/length-thresholds.mjs",
  "shared/quantity-thresholds.mjs",
  "shared/time-thresholds.mjs",
  "shared/turn-thresholds.mjs",
]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}out${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}tests${path.sep}`,
];

const CATEGORY_RULES = [
  {
    category: "length",
    importPath: "@noobot/shared/length-thresholds",
    symbol: "LENGTH_THRESHOLDS",
    namePattern: /(CHARS?|BYTES?|STRING(?:_?LENGTH)?|TEXT|PREVIEW|CONTENT|EXTENSION_?LENGTH|TRUNCATE_?LENGTH)/i,
    propPattern: /^(?:maxChars|maxLength|maxStringLength|maxBytes|previewChars|contentChars|textChars|maxBufferBytes|maxFileSizeBytes|maxTotalSizeBytes)$/i,
  },
  {
    category: "quantity",
    importPath: "@noobot/shared/quantity-thresholds",
    symbol: "QUANTITY_THRESHOLDS",
    namePattern: /(ITEMS?|COUNT|LIMIT|LINES?|RESULTS?|FILES?|ENTRIES|CONCURRENCY|DEPTH|SIZE)$/i,
    propPattern: /^(?:maxItems|maxFileCount|maxSubAgentDepth|maxLines|maxResults|maxFiles|maxEntries|maxBufferEntries|maxSize|limit|concurrency|jsonlBatchSize|maxRuns)$/i,
  },
  {
    category: "time",
    importPath: "@noobot/shared/time-thresholds",
    symbol: "TIME_THRESHOLDS",
    namePattern: /(TIMEOUT|INTERVAL|DELAY|TTL|AGE|RETENTION|GRACE|DURATION|POLL|DEBOUNCE).*?(MS|SECONDS|DAYS)?$/i,
    propPattern: /^(?:timeoutMs|intervalMs|delayMs|ttlMs|maxAgeMs|retentionMs|graceMs|durationSeconds|maxRunAgeDays)$/i,
  },
  {
    category: "turn",
    importPath: "@noobot/shared/turn-thresholds",
    symbol: "TURN_THRESHOLDS",
    namePattern: /(TURNS?|ROUNDS?|ATTEMPTS?|RETRIES|RETRY_?COUNT|MAX_?RETRY)/i,
    propPattern: /^(?:maxTurns|turnsThreshold|triggerTurnsThreshold|rounds|maxAttempts|maxRetry|retryCount)$/i,
  },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function stripCommentsAndStrings(text = "") {
  let out = "";
  let state = "code";
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "lineComment") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        out += "  ";
        index += 1;
        state = "code";
      } else {
        out += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "string" || state === "template") {
      if (char === "\\") {
        out += "  ";
        index += 1;
        continue;
      }
      const isEnd = state === "template" ? char === "`" : char === quote;
      out += char === "\n" ? "\n" : " ";
      if (isEnd) {
        state = "code";
        quote = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      out += "  ";
      index += 1;
      state = "lineComment";
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  ";
      index += 1;
      state = "blockComment";
      continue;
    }
    if (char === "\"" || char === "'") {
      out += " ";
      quote = char;
      state = "string";
      continue;
    }
    if (char === "`") {
      out += " ";
      state = "template";
      continue;
    }

    out += char;
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

function isAllowedNumericExpression(expr = "") {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  if (trimmed === "0") return true;
  if (/^(?:Number\.)?MAX_SAFE_INTEGER\b/.test(trimmed)) return true;
  if (/\b(?:LENGTH|QUANTITY|TIME|TURN)_THRESHOLDS\b/.test(trimmed)) return true;
  return false;
}

function expressionLooksNumeric(expr = "") {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (isAllowedNumericExpression(trimmed)) return false;
  return /^[0-9]/.test(trimmed) || /^[A-Z0-9_]+\s*[*/+-]\s*[0-9]/i.test(trimmed);
}

function classifyName(name = "", kind = "name") {
  for (const rule of CATEGORY_RULES) {
    const pattern = kind === "prop" ? rule.propPattern : rule.namePattern;
    if (pattern.test(name)) return rule;
  }
  return null;
}

function collectViolations(filePath, text) {
  const relativePath = rel(filePath);
  if (SHARED_THRESHOLD_FILES.has(relativePath)) return [];
  const code = stripCommentsAndStrings(text);
  const violations = [];

  const declarations =
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let match;
  while ((match = declarations.exec(code))) {
    const [, name, expr] = match;
    const rule = classifyName(name, "name");
    if (!rule || !expressionLooksNumeric(expr)) continue;
    violations.push({
      file: relativePath,
      ...lineAndColumn(code, match.index),
      name,
      expr: expr.trim(),
      rule,
    });
  }

  const properties =
    /\b([A-Za-z_$][\w$]*)\s*:\s*([^,\n}]+)/g;
  while ((match = properties.exec(code))) {
    const [, name, expr] = match;
    const rule = classifyName(name, "prop");
    if (!rule || !expressionLooksNumeric(expr)) continue;
    violations.push({
      file: relativePath,
      ...lineAndColumn(code, match.index),
      name,
      expr: expr.trim(),
      rule,
    });
  }

  return violations;
}

const files = [];
for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (exists(full)) walk(full, files);
}

const violations = [];
for (const file of files) {
  violations.push(...collectViolations(file, readFileSync(file, "utf8")));
}

if (violations.length) {
  console.error("[check-shared-thresholds] scattered threshold literals found:");
  for (const item of violations) {
    console.error(
      `- ${item.file}:${item.line}:${item.column} ${item.name} = ${item.expr} -> use ${item.rule.symbol} from ${item.rule.importPath}`,
    );
  }
  console.error("\nPut length/quantity/time/turn thresholds in shared/*-thresholds.mjs and import them via @noobot/shared/*-thresholds.");
  process.exit(1);
}

console.log("[check-shared-thresholds] ok");
