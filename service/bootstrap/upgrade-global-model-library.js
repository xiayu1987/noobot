/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, writeFile, rename, rm, copyFile } from "node:fs/promises";
import {
  CONFIG_DOCUMENT_SCOPE,
  repairConfigDocument,
  upgradeConfigModelLibrary,
} from "@noobot/agent-config-protocol";
import { writeFileAtomic } from "@noobot/platform-compatibility/atomic-file-write";

export async function upgradeGlobalModelLibrary(filePath) {
  const target = JSON.parse(await readFile(filePath, "utf8"));
  const { document, report } = upgradeConfigModelLibrary(target);
  if (report.changed) {
    const baseValues = JSON.parse(
      await readFile(new URL("../config/global.config.example.json", import.meta.url), "utf8"),
    );
    const repaired = repairConfigDocument({
      scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
      baseValues,
      target: document,
    });
    await copyFile(filePath, `${filePath}.model-library-${Date.now()}.bak`);
    await writeFileAtomic({
      filePath,
      content: `${JSON.stringify(repaired.document, null, 2)}\n`,
      writeFile,
      rename,
      remove: rm,
    });
    return { ...report, issues: repaired.report.issues };
  }
  return report;
}
