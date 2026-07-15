import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Runtime source is guarded here. Repository scripts and legacy tests still use
// Node's path module directly because they are not shipped path-payload code.
const runtimeSourceRoots = ["client", "agent/src"];
const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
const sourceExtension = /\.(?:[cm]?js|jsx|ts|tsx)$/;
const resolverFiles = new Set([
  "client/shared/path-resolver.js",
  "agent/src/system-core/utils/path-resolver.js",
  "agent/src/system-core/utils/path-resolver/platform.js",
]);
const violations = [];
export const directPathModulePattern = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'](?:node:)?path(?:\/(?:posix|win32))?["']/g;

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function report(file, text, pattern, message) {
  for (const match of text.matchAll(pattern)) {
    violations.push(`${file}:${lineAt(text, match.index)}: ${message}: ${match[0]}`);
  }
}

function inspect(file) {
  if (resolverFiles.has(file)) return;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  // Resolver facades intentionally retain the familiar `path.*` call shape;
  // the enforceable bypass is importing Node's path module anywhere else.
  report(file, text, directPathModulePattern, "direct path module access");
}

function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const file = path.join(relative, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && sourceExtension.test(entry.name)) inspect(file);
  }
}

for (const dir of runtimeSourceRoots) walk(dir);
if (violations.length) {
  console.error(`File path APIs must use the shared path resolver:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log(`Bare file path guard passed (${runtimeSourceRoots.join(", ")} runtime sources; resolver-only exceptions).`);
