/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const installerUrl = new URL("../../scripts/install-openvscode-server.js", import.meta.url).href;
const serviceRoot = fileURLToPath(new URL("../../", import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openvscode-installer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installDir = path.join(root, "openvscode");
  const run = ({ installed = false, release = {}, cwd = serviceRoot } = {}) => {
    if (installed) {
      fs.mkdirSync(path.join(installDir, "bin"), { recursive: true });
      fs.writeFileSync(path.join(installDir, "bin/openvscode-server"), "#!/bin/sh\necho 1.2.3\n", {
        mode: 0o755,
      });
    }
    const script = `
      globalThis.fetch = async (url) => {
        if (url !== 'https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest')
          throw new Error('unexpected network request: ' + url);
        return {ok: true, json: async () => (${JSON.stringify(release)})};
      };
      await import(${JSON.stringify(installerUrl)});
    `;
    const env = {
      ...process.env,
      OPENVSCODE_SERVER_INSTALL_DIR: installDir,
      OPENVSCODE_SERVER_VERSION: "latest",
      OPENVSCODE_SERVER_INSTALL_FORCE: "0",
      OPENVSCODE_SERVER_CHECK_UPDATE: "1",
      OPENVSCODE_SERVER_SKIP_UPDATE_CHECK_IF_UNREACHABLE: "0",
    };
    delete env.NOOBOT_GLOBAL_CONFIG_PATH;
    delete env.NOOBOT_WORKSPACE_ROOT;
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 10000,
    });
  };
  return { root, run };
}

test(
  "standalone OpenVSCode installer runs without a workspace or runtime-params store",
  { skip: process.platform !== "linux" },
  (t) => {
    const { run } = fixture(t);
    const child = run({ installed: true, release: { tag_name: "openvscode-server-v1.2.3" } });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /already up to date: openvscode-server-v1\.2\.3/);
  },
);

test(
  "standalone OpenVSCode installer enforces the fixed archive limit from another cwd",
  { skip: process.platform !== "linux" },
  (t) => {
    const { root, run } = fixture(t);
    const tag = "openvscode-server-v1.2.3";
    const arch = process.arch === "arm" ? "armhf" : process.arch;
    const name = `${tag}-linux-${arch}.tar.gz`;
    const child = run({
      cwd: root,
      release: {
        tag_name: tag,
        assets: [
          {
            name,
            size: LENGTH_THRESHOLDS.installers.openVscodeArchiveBytes + 1,
            digest: `sha256:${"a".repeat(64)}`,
            browser_download_url: `https://github.com/gitpod-io/openvscode-server/releases/download/${tag}/${name}`,
          },
        ],
      },
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /release asset size is invalid/);
    assert.doesNotMatch(child.stderr, /unexpected network request|must be initialized/);
  },
);
