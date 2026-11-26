/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function assertMissingAncestors(file, cause) {
  let directory = path.dirname(path.resolve(file instanceof URL ? fileURLToPath(file) : file));
  while (true) {
    let info;
    try {
      info = await fs.stat(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (info?.isDirectory()) return;
    if (info) {
      throw Object.assign(new Error(`Not a directory: ${directory}`, { cause }), {
        code: "ENOTDIR",
        path: cause.path,
        syscall: cause.syscall,
      });
    }
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

function pathOperation(operation) {
  return async (file, ...args) => {
    try {
      return await fs[operation](file, ...args);
    } catch (error) {
      if (error.code === "ENOENT") await assertMissingAncestors(file, error);
      throw error;
    }
  };
}

export const access = pathOperation("access");
export const lstat = pathOperation("lstat");
export const open = pathOperation("open");
export const readFile = pathOperation("readFile");
export const readdir = pathOperation("readdir");
export const realpath = pathOperation("realpath");
export const stat = pathOperation("stat");
export const unlink = pathOperation("unlink");

export async function rm(file, options = {}) {
  try {
    await fs.rm(file, { ...options, force: false });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await assertMissingAncestors(file, error);
    if (!options.force) throw error;
  }
}
