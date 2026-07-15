import fs from "node:fs";
import path from "node:path";

const CJK_RE = /[\u4e00-\u9fff]/;

function walkFiles(dir, fileExtensions) {
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!fileExtensions.has(path.extname(entry.name))) continue;
      result.push(abs);
    }
  }
  return result;
}

function findCjkLiterals(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const hits = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (CJK_RE.test(line)) {
      hits.push({ line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

export function runCjkLiteralCheck({
  root = process.cwd(),
  targetDirs,
  fileExtensions,
  isAllowed = () => false,
  successMessage,
  failureMessage,
  maxHitsPerFile = 10,
}) {
  const problems = [];
  for (const targetDir of targetDirs) {
    const files = walkFiles(path.resolve(root, targetDir), fileExtensions);
    for (const file of files) {
      const relativePath = path.relative(root, file);
      if (isAllowed(relativePath)) continue;
      const hits = findCjkLiterals(file);
      if (hits.length) problems.push({ file: relativePath, hits });
    }
  }

  if (!problems.length) {
    console.log(successMessage);
    return true;
  }

  console.error(failureMessage);
  for (const item of problems) {
    console.error(`\n- ${item.file}`);
    item.hits.slice(0, maxHitsPerFile).forEach((hit) => {
      console.error(`  ${hit.line}: ${hit.text}`);
    });
    if (item.hits.length > maxHitsPerFile) {
      console.error(`  ... and ${item.hits.length - maxHitsPerFile} more`);
    }
  }
  return false;
}
