#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_API = "https://api.github.com/repos/gitpod-io/openvscode-server";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(currentDir, "..");
const installDir = path.resolve(
  serviceRoot,
  process.env.OPENVSCODE_SERVER_INSTALL_DIR || "vendor/openvscode-server",
);
const version = String(process.env.OPENVSCODE_SERVER_VERSION || "latest").trim() || "latest";
const force = ["1", "true", "yes", "on"].includes(
  String(process.env.OPENVSCODE_SERVER_INSTALL_FORCE || "").trim().toLowerCase(),
);
const checkUpdate = ["1", "true", "yes", "on"].includes(
  String(process.env.OPENVSCODE_SERVER_CHECK_UPDATE || "").trim().toLowerCase(),
);
const skipUpdateCheckIfUnreachable = ["1", "true", "yes", "on", ""].includes(
  String(process.env.OPENVSCODE_SERVER_SKIP_UPDATE_CHECK_IF_UNREACHABLE || "").trim().toLowerCase(),
);

function resolvePlatform() {
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported platform for bundled installer: ${process.platform}`);
}

function resolveArch() {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "arm") return "armhf";
  throw new Error(`Unsupported architecture for bundled installer: ${process.arch}`);
}

function fetchJson(url) {
  return fetch(url, {
    headers: {
      "user-agent": "noobot-openvscode-installer",
      accept: "application/vnd.github+json",
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`GitHub API failed: HTTP ${response.status} ${await response.text()}`);
    }
    return response.json();
  });
}

async function resolveRelease() {
  if (version === "latest") return fetchJson(`${REPO_API}/releases/latest`);
  const tags = Array.from(
    new Set([
      version,
      version.startsWith("openvscode-server-v") ? version : `openvscode-server-v${version.replace(/^v/, "")}`,
      version.startsWith("v") ? `openvscode-server-${version}` : `openvscode-server-v${version}`,
    ]),
  );
  let lastError = null;
  for (const tag of tags) {
    try {
      return await fetchJson(`${REPO_API}/releases/tags/${encodeURIComponent(tag)}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`OpenVSCode Server release not found: ${version}`);
}

function pickAsset(release) {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const suffix = `${platform}-${arch}.tar.gz`;
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find((item) => String(item?.name || "").endsWith(suffix));
  if (!asset?.browser_download_url) {
    throw new Error(`No OpenVSCode Server asset matched *${suffix} in ${release?.tag_name || "release"}`);
  }
  return asset;
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { "user-agent": "noobot-openvscode-installer" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  await new Promise((resolve, reject) => {
    const file = createWriteStream(destination);
    response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          file.write(Buffer.from(chunk));
        },
        close() {
          file.end(resolve);
        },
        abort(error) {
          file.destroy(error);
          reject(error);
        },
      }),
    ).catch(reject);
  });
}

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensureVsdaWebFallback(baseInstallDir) {
  const vsdaRootDir = path.join(baseInstallDir, "node_modules", "vsda");
  const webDir = path.join(baseInstallDir, "node_modules", "vsda", "rust", "web");
  const vsdaJsPath = path.join(webDir, "vsda.js");
  const vsdaWasmPath = path.join(webDir, "vsda_bg.wasm");
  const vsdaPackageJsonPath = path.join(vsdaRootDir, "package.json");
  const vsdaIndexPath = path.join(vsdaRootDir, "index.js");
  const vsdaJsContent = `// noobot fallback: openvscode-server release may miss vsda web assets
class NoopValidator {
  createNewMessage(message) {
    return message;
  }
  validate() {
    return "ok";
  }
  dispose() {}
}

class NoopSigner {
  sign(value) {
    return value;
  }
  dispose() {}
}

export default {
  validator: NoopValidator,
  signer: NoopSigner,
};
`;
  const vsdaIndexContent = `// noobot fallback: minimal CommonJS entry for require("vsda")
class NoopValidator {
  createNewMessage(message) {
    return message;
  }
  validate() {
    return "ok";
  }
  dispose() {}
}

class NoopSigner {
  sign(value) {
    return value;
  }
  dispose() {}
}

const api = {
  validator: NoopValidator,
  signer: NoopSigner,
};

module.exports = api;
module.exports.default = api;
`;
  const vsdaPackageJson = {
    name: "vsda",
    version: "0.0.0-noobot-fallback",
    private: true,
    main: "./index.js",
    type: "commonjs",
  };
  await mkdir(vsdaRootDir, { recursive: true });
  await mkdir(webDir, { recursive: true });
  await writeFile(vsdaPackageJsonPath, `${JSON.stringify(vsdaPackageJson, null, 2)}\n`, "utf8");
  await writeFile(vsdaIndexPath, vsdaIndexContent, "utf8");
  await writeFile(vsdaJsPath, vsdaJsContent, "utf8");
  await writeFile(vsdaWasmPath, Buffer.alloc(0));
  console.log("[openvscode] patched missing vsda web assets");
}

function readInstalledTagName(baseInstallDir) {
  try {
    const filePath = path.join(baseInstallDir, "noobot-install-info.json");
    if (!existsSync(filePath)) return "";
    const parsed = JSON.parse(String(readFileSync(filePath, "utf8") || "{}"));
    return String(parsed?.tagName || "").trim();
  } catch {
    return "";
  }
}

async function main() {
  const binaryPath = path.join(installDir, "bin/openvscode-server");
  let release = null;
  let asset = null;
  if (!force) {
    try {
      await chmod(binaryPath, 0o755);
      await ensureVsdaWebFallback(installDir);
      if (!checkUpdate) {
        console.log(`[openvscode] already available: ${binaryPath}`);
        return;
      }
      try {
        release = await resolveRelease();
      } catch (error) {
        if (skipUpdateCheckIfUnreachable) {
          console.warn(
            `[openvscode] update check skipped (unreachable): ${error?.message || error}`,
          );
          console.log(`[openvscode] already available: ${binaryPath}`);
          return;
        }
        throw error;
      }
      const installedTagName = readInstalledTagName(installDir);
      if (installedTagName && installedTagName === String(release?.tag_name || "").trim()) {
        console.log(`[openvscode] already up to date: ${installedTagName}`);
        return;
      }
      asset = pickAsset(release);
      console.log(
        `[openvscode] update available: ${installedTagName || "unknown"} -> ${release?.tag_name || "unknown"}`,
      );
    } catch {
      // continue install
    }
  }

  if (!release) release = await resolveRelease();
  if (!asset) asset = pickAsset(release);
  const tmpDir = path.join(serviceRoot, ".tmp-openvscode-install");
  const archivePath = path.join(tmpDir, asset.name);

  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  console.log(`[openvscode] downloading ${asset.name}`);
  await downloadFile(asset.browser_download_url, archivePath);

  await rm(installDir, { recursive: true, force: true });
  await mkdir(installDir, { recursive: true });
  console.log(`[openvscode] extracting to ${installDir}`);
  await run("tar", ["-xzf", archivePath, "-C", installDir, "--strip-components=1"]);
  await chmod(binaryPath, 0o755);
  await ensureVsdaWebFallback(installDir);
  await writeFile(
    path.join(installDir, "noobot-install-info.json"),
    JSON.stringify(
      {
        tagName: release?.tag_name || "",
        assetName: asset.name,
        installedAt: new Date().toISOString(),
        binaryPath,
      },
      null,
      2,
    ),
    "utf8",
  );
  await rm(tmpDir, { recursive: true, force: true });
  console.log(`[openvscode] ready: ${binaryPath}`);
}

main().catch((error) => {
  console.error(`[openvscode] prepare failed: ${error?.message || error}`);
  process.exit(1);
});
