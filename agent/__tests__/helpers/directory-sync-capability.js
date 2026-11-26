/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { syncDirectory } from "@noobot/platform-compatibility/file-system";
import { fsOpen, getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

export function enableDirectorySyncCapability(t) {
  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      if (process.platform === "win32" && flags === "r") {
        const info = await adapter.stat(file);
        if (info.isDirectory()) return { async sync() {}, async close() {} };
      }
      return adapter.open(file, flags, ...args);
    },
    syncDirectory: (directory) => syncDirectory({ directory, open: fsOpen, platform: "linux" }),
  });
  t.after(() => setFsAdapter(adapter));
}
