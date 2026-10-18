/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isFunction } from "@noobot/shared/value";

export const EXEMPTION_BASELINE_KEY = "exemptions";
const SPEC_KEYS = new Set(["id", "description", "rules", "exemptions", "baseline", "measure"]);
const RULE_KEYS = new Set(["description", "hint"]);
const EXEMPTION_KEYS = new Set(["id", "kind", "rules", "reason", "match"]);
export const EXEMPTION_KINDS = Object.freeze({
  PATH_PREFIX: "path-prefix",
  PROPERTY_NAME: "property-name",
  ROOT_IDENTIFIER: "root-identifier",
});
const EXEMPTION_KIND_SET = new Set(Object.values(EXEMPTION_KINDS));
const MEASUREMENT_KEYS = new Set(["total", "files", "samples"]);
const REPORTED_SAMPLE_LIMIT = 80;
const TOP_FILE_LIMIT = 10;
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function requireCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function rejectUnknownKeys(object, allowed, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function requireTextList(values, label) {
  if (!Array.isArray(values) || !values.length) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  values.forEach((value, index) => requireText(value, `${label}[${index}]`));
}

function defineRule(id, name, rule) {
  const label = `${id}.rules.${name}`;
  rejectUnknownKeys(rule, RULE_KEYS, label);
  requireText(rule.description, `${label}.description`);
  requireText(rule.hint, `${label}.hint`);
  return Object.freeze({ description: rule.description, hint: rule.hint });
}

function defineExemption(id, ruleNames, exemption, index) {
  const label = `${id}.exemptions[${index}]`;
  rejectUnknownKeys(exemption, EXEMPTION_KEYS, label);
  requireText(exemption.id, `${label}.id`);
  requireText(exemption.reason, `${label}.reason`);
  if (!EXEMPTION_KIND_SET.has(exemption.kind))
    throw new TypeError(`${label}.kind is not supported`);
  requireTextList(exemption.rules, `${label}.rules`);
  requireTextList(exemption.match, `${label}.match`);
  const unknownRules = exemption.rules.filter((rule) => !ruleNames.has(rule));
  if (unknownRules.length) {
    throw new TypeError(`${label}.rules references unknown rules: ${unknownRules.join(", ")}`);
  }
  return Object.freeze({
    id: exemption.id,
    kind: exemption.kind,
    rules: Object.freeze([...exemption.rules]),
    reason: exemption.reason,
    match: Object.freeze([...exemption.match]),
  });
}

export function defineCheck(spec) {
  rejectUnknownKeys(spec, SPEC_KEYS, "check");
  requireText(spec.id, "check.id");
  requireText(spec.description, `${spec.id}.description`);
  if (!isFunction(spec.measure)) throw new TypeError(`${spec.id}.measure is required`);
  const ruleEntries = Object.entries(spec.rules);
  if (!ruleEntries.length) throw new TypeError(`${spec.id}.rules must not be empty`);
  const rules = Object.fromEntries(
    ruleEntries.map(([name, rule]) => [name, defineRule(spec.id, name, rule)]),
  );
  const ruleNames = new Set(Object.keys(rules));
  const exemptions = spec.exemptions.map((exemption, index) =>
    defineExemption(spec.id, ruleNames, exemption, index),
  );
  if (new Set(exemptions.map((exemption) => exemption.id)).size !== exemptions.length) {
    throw new TypeError(`${spec.id}.exemptions ids must be unique`);
  }
  const baselineKeys = new Set([...ruleNames, EXEMPTION_BASELINE_KEY]);
  rejectUnknownKeys(spec.baseline, baselineKeys, `${spec.id}.baseline`);
  for (const key of baselineKeys) requireCount(spec.baseline[key], `${spec.id}.baseline.${key}`);
  return Object.freeze({
    id: spec.id,
    description: spec.description,
    rules: Object.freeze(rules),
    exemptions: Object.freeze(exemptions),
    baseline: Object.freeze({ ...spec.baseline }),
    measure: spec.measure,
  });
}

export function exemptionsFor(check, rule) {
  return check.exemptions.filter((exemption) => exemption.rules.includes(rule));
}

export function exemptsPath(check, rule, file) {
  return exemptionsFor(check, rule)
    .filter((exemption) => exemption.kind === EXEMPTION_KINDS.PATH_PREFIX)
    .some((exemption) => exemption.match.some((prefix) => file.startsWith(prefix)));
}

export function exemptMatches(check, rule, kind) {
  return new Set(
    exemptionsFor(check, rule)
      .filter((exemption) => exemption.kind === kind)
      .flatMap((exemption) => exemption.match),
  );
}

export function countExemptions(check) {
  return check.exemptions.reduce((total, exemption) => total + exemption.match.length, 0);
}

export function emptyMeasurement() {
  return { total: 0, files: {}, samples: [] };
}

export function emptyRuleMeasurements(check) {
  return Object.fromEntries(Object.keys(check.rules).map((name) => [name, emptyMeasurement()]));
}

export function measurementFromHits(hits) {
  const measurement = emptyMeasurement();
  for (const hit of hits) addHit(measurement, hit);
  return measurement;
}

export function addHit(measurement, { file, line, message }) {
  requireText(file, "hit.file");
  requireText(message, "hit.message");
  measurement.total += 1;
  measurement.files[file] = (measurement.files[file] ?? 0) + 1;
  measurement.samples.push(line ? `${file}:${line} ${message}` : `${file} ${message}`);
}

function requireMeasurement(check, name, measurement) {
  const label = `${check.id}.measure().${name}`;
  rejectUnknownKeys(measurement, MEASUREMENT_KEYS, label);
  requireCount(measurement.total, `${label}.total`);
  for (const [file, count] of Object.entries(measurement.files)) {
    requireCount(count, `${label}.files[${file}]`);
  }
  if (!Array.isArray(measurement.samples)) throw new TypeError(`${label}.samples must be an array`);
}

function reportedSamples(samples) {
  const shown = samples.slice(0, REPORTED_SAMPLE_LIMIT).map((sample) => `  - ${sample}`);
  const hidden = samples.length - shown.length;
  return hidden > 0 ? [...shown, `  ... and ${hidden} more`] : shown;
}

export function topFiles(files, limit = TOP_FILE_LIMIT) {
  return Object.entries(files)
    .sort(
      ([leftFile, left], [rightFile, right]) => right - left || leftFile.localeCompare(rightFile),
    )
    .slice(0, limit)
    .map(([file, count]) => `  ${file}: ${count}`);
}

export function evaluateCheck(check, measured) {
  rejectUnknownKeys(measured, new Set(Object.keys(check.rules)), `${check.id}.measure()`);
  const totals = {};
  const increases = [];
  const decreases = [];
  for (const [name, rule] of Object.entries(check.rules)) {
    const measurement = measured[name];
    if (!measurement) throw new TypeError(`${check.id}.measure() is missing rule ${name}`);
    requireMeasurement(check, name, measurement);
    totals[name] = measurement.total;
    const allowed = check.baseline[name];
    if (measurement.total > allowed) {
      increases.push(
        [
          `${name}: ${measurement.total} exceeds baseline ${allowed}; ${rule.hint}`,
          ...(measurement.samples.length
            ? reportedSamples(measurement.samples)
            : topFiles(measurement.files)),
        ].join("\n"),
      );
    }
    if (measurement.total < allowed)
      decreases.push(`${name}: ${measurement.total} below baseline ${allowed}`);
  }
  totals[EXEMPTION_BASELINE_KEY] = countExemptions(check);
  const allowedExemptions = check.baseline[EXEMPTION_BASELINE_KEY];
  if (totals.exemptions > allowedExemptions) {
    increases.push(
      `exemptions: ${totals.exemptions} exceeds baseline ${allowedExemptions}; converge the exempted code instead of widening the allowlist`,
    );
  }
  if (totals.exemptions < allowedExemptions) {
    decreases.push(`exemptions: ${totals.exemptions} below baseline ${allowedExemptions}`);
  }
  return { totals, increases, decreases };
}

export function formatCheckResult(check, result, scriptPath) {
  const summary = Object.entries(result.totals)
    .map(([name, total]) => `${name}=${total}`)
    .join(", ");
  if (!result.increases.length && !result.decreases.length) {
    return { ok: true, text: `[${check.id}] passed (${summary})` };
  }
  const stale = result.decreases.map(
    (line) => `stale baseline, lower it in ${scriptPath}: ${line}`,
  );
  return {
    ok: false,
    text: [`[${check.id}] failed (${summary})`, ...result.increases, ...stale].join("\n"),
  };
}

export async function runCheck(check, moduleUrl) {
  const scriptPath = path.relative(repositoryRoot, fileURLToPath(moduleUrl));
  const result = evaluateCheck(check, await check.measure());
  const { ok, text } = formatCheckResult(check, result, scriptPath);
  if (ok) {
    process.stdout.write(`${text}\n`);
    return;
  }
  process.stderr.write(`${text}\n`);
  process.exitCode = 1;
}

export async function runCheckWhenMain(check, moduleUrl) {
  if (moduleUrl === pathToFileURL(process.argv[1] ?? "").href) await runCheck(check, moduleUrl);
}
