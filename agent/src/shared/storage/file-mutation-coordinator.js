/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileMutationCoordinator } from "@noobot/shared/file-mutation-coordinator";
import { filePath } from "@noobot/path-resolver";
import { fsMkdir, fsOpen, fsReadFile, fsReaddir, fsRename, fsRm, fsStat } from "./fs-adapter.js";

export const FileMutationCoordinator = createFileMutationCoordinator(
  {
    mkdir: fsMkdir,
    open: fsOpen,
    readFile: fsReadFile,
    readdir: fsReaddir,
    rename: fsRename,
    rm: fsRm,
    stat: fsStat,
  },
  filePath,
);
