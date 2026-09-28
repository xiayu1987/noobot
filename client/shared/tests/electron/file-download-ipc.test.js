/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import { registerFileIpcHandlers } from "../../electron/ipc/files.js";
import { clientFilePath as path } from "../../path-resolver.js";

async function createHarness(t, chooseDestination) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-download-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mainWindow = {};
  const dialogs = [];
  const handlers = new Map();
  registerFileIpcHandlers({
    app: { getPath: () => root },
    dialog: {
      async showSaveDialog(window, options) {
        assert.equal(window, mainWindow);
        dialogs.push(options);
        return chooseDestination(root);
      },
    },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getMainWindow: () => mainWindow,
  });
  return { root, dialogs, save: (payload) => handlers.get("noobot:save-download")({}, payload) };
}

test("desktop download writes the exact binary payload to the chosen destination", async (t) => {
  const { save, dialogs, root } = await createHarness(t, (directory) => ({
    canceled: false,
    filePath: path.join(directory, "chosen", "报告.bin"),
  }));
  const bytes = Uint8Array.from([0, 255, 17, 128]).buffer;
  const result = await save({ fileName: "report.bin", bytes });

  assert.equal(result.ok, true);
  assert.deepEqual(await fs.readFile(result.filePath), Buffer.from(bytes));
  assert.equal(dialogs[0].defaultPath, path.join(root, "report.bin"));
  assert.ok(dialogs[0].properties.includes("showOverwriteConfirmation"));
});

test("canceling a desktop download creates no file", async (t) => {
  const { save, root } = await createHarness(t, () => ({ canceled: true }));
  assert.deepEqual(await save({ fileName: "report.txt", bytes: new ArrayBuffer(0) }), {
    ok: false,
    canceled: true,
  });
  assert.deepEqual(await fs.readdir(root), []);
});

test("desktop downloads preserve empty files", async (t) => {
  const { save } = await createHarness(t, (root) => ({
    canceled: false,
    filePath: path.join(root, "empty.txt"),
  }));
  const result = await save({ fileName: "empty.txt", bytes: new ArrayBuffer(0) });
  assert.equal(result.ok, true);
  assert.equal((await fs.stat(result.filePath)).size, 0);
});

test("desktop download write failures reject instead of reporting success", async (t) => {
  const { save, root } = await createHarness(t, (directory) => ({
    canceled: false,
    filePath: path.join(directory, "file-as-directory", "report.txt"),
  }));
  await fs.writeFile(path.join(root, "file-as-directory"), "existing");
  await assert.rejects(save({ fileName: "report.txt", bytes: new ArrayBuffer(0) }));
});

test("desktop download rejects noncanonical byte payloads before opening a dialog", async (t) => {
  const { save, dialogs } = await createHarness(t, () => ({ canceled: true }));
  for (const bytes of [undefined, [1, 2], { type: "Buffer", data: [1, 2] }, "content"]) {
    await assert.rejects(save({ fileName: "report.txt", bytes }), /must be an ArrayBuffer/);
  }
  assert.deepEqual(dialogs, []);
});
