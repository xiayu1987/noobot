#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const ALL_PROJECTS = {
  agent: {
    root: "agent",
    allow: ["src/**"],
  },
  service: {
    root: "service",
    allow: ["bootstrap/create-app-dependencies.js"],
  },
  "agent-proxy": {
    root: "agent-proxy",
    allow: ["src/**", "agent-proxy.js"],
  },
  client: {
    root: "client/noobot-chat",
    allow: ["src/**"],
  },
};

const args = process.argv.slice(2);
const projectArg = args.find((item) => item.startsWith("--project="));
const selected = projectArg
  ? String(projectArg.split("=")[1] || "").trim()
  : "";

const projects = selected
  ? Object.fromEntries(
      Object.entries(ALL_PROJECTS).filter(([name]) => name === selected),
    )
  : ALL_PROJECTS;

if (selected && !projects[selected]) {
  console.error(`[i18n-check] unknown project: ${selected}`);
  process.exit(2);
}

const SOURCE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_DIR = new Set(["node_modules", ".git", "dist", "coverage", ".next", "build"]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const name = path.basename(current);
      if (IGNORE_DIR.has(name)) continue;
      for (const child of fs.readdirSync(current)) {
        stack.push(path.join(current, child));
      }
      continue;
    }
    const ext = path.extname(current).toLowerCase();
    if (SOURCE_EXT.has(ext)) out.push(current);
  }
  return out;
}

function isAllowed(relPath, allowPatterns = []) {
  const rel = toPosix(relPath);
  for (const p of allowPatterns) {
    if (p.endsWith("/**")) {
      const base = p.slice(0, -3);
      if (rel === base || rel.startsWith(`${base}/`)) return true;
      continue;
    }
    if (rel === p) return true;
  }
  return false;
}

const directImportRegexes = [
  /from\s*["']noobot-i18n(?:\/[^"']*)?["']/g,
  /import\s*\(\s*["']noobot-i18n(?:\/[^"']*)?["']\s*\)/g,
];

let violations = [];

for (const [name, cfg] of Object.entries(projects)) {
  const projectRoot = path.join(repoRoot, cfg.root);
  const files = walkFiles(projectRoot);
  for (const file of files) {
    const rel = toPosix(path.relative(projectRoot, file));
    const content = fs.readFileSync(file, "utf8");
    let matched = false;
    let sample = "";
    for (const re of directImportRegexes) {
      const m = content.match(re);
      if (m && m.length) {
        matched = true;
        sample = m[0];
        break;
      }
    }
    if (!matched) continue;
    if (isAllowed(rel, cfg.allow)) continue;
    violations.push({ project: name, file: `${cfg.root}/${rel}`, sample });
  }
}

if (violations.length) {
  console.error(`[i18n-check] found ${violations.length} forbidden direct import(s) of noobot-i18n:`);
  for (const v of violations) {
    console.error(`- [${v.project}] ${v.file}`);
    if (v.sample) console.error(`  ${v.sample}`);
  }
  process.exit(1);
}

console.log("[i18n-check] ok: no forbidden direct imports");
