import fs from "node:fs/promises";

export function buildAgentContext(basePath = "") {
  return {
    environment: {
      workspace: { basePath },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          globalConfig: {},
          userConfig: {},
          sharedTools: {},
        },
      },
    },
  };
}

export async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
