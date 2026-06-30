/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { dependencySpecs, desktopDependencyTimeouts } from "./dependency-specs.js";
import { createDependencyError } from "./dependency-process.js";
import { getCurlProxyArgs, getDependencyProxyEnv, maskDependencyProxyUrl } from "./dependency-proxy.js";

export function createMacDependencyInstallerTools({
  app,
  runProcess,
  hasExistingFile,
  writeDependencyLog = () => {},
  sendStatus = () => {},
  getDependencyProxyUrl = () => "",
} = {}) {
  function getProxyOptions() {
    const proxyUrl = String(getDependencyProxyUrl() || "").trim();
    return { proxyUrl, args: getCurlProxyArgs(proxyUrl), env: getDependencyProxyEnv(proxyUrl), masked: maskDependencyProxyUrl(proxyUrl) };
  }
  function getManagedDependenciesRoot() {
    const base = app.isReady() ? app.getPath("userData") : (process.env.HOME || os.tmpdir());
    return path.join(base, "managed-dependencies");
  }

  function getManagedDependencyDir(key) {
    return path.join(getManagedDependenciesRoot(), key);
  }

  function getManagedBinDirs() {
    return [
      path.join(getManagedDependencyDir("ffmpeg"), "bin"),
      path.join(getManagedDependencyDir("nodejs"), "bin"),
    ];
  }

  function getDarwinManagedKeyForSpec(spec) {
    if (spec === dependencySpecs.ffmpeg) return "ffmpeg";
    if (spec === dependencySpecs.nodejs) return "nodejs";
    return "";
  }

  function prependManagedDependencyPath() {
    if (process.platform !== "darwin") return;
    const delimiter = path.delimiter;
    const current = String(process.env.PATH || "");
    const parts = current.split(delimiter).filter(Boolean);
    const managed = getManagedBinDirs().filter((dir) => hasExistingFile(dir));
    const next = [...managed, ...parts.filter((part) => !managed.includes(part))].join(delimiter);
    if (next && next !== current) {
      process.env.PATH = next;
      writeDependencyLog("managed:path", { dirs: managed.join(" | ") });
    }
  }

  function compareVersionDesc(a, b) {
    const left = String(a || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
    const right = String(b || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const diff = (right[index] || 0) - (left[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  function getMacLibreOfficeDmgUrlForVersion(version) {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    return `https://download.documentfoundation.org/libreoffice/stable/${version}/mac/${arch}/LibreOffice_${version}_MacOS_${arch}.dmg`;
  }

  function getMacLibreOfficeDmgUrl(spec) {
    const configuredUrl = String(spec.darwinDmg?.url || "").trim();
    if (configuredUrl) return configuredUrl;
    const version = String(spec.darwinDmg?.version || "").trim();
    return version ? getMacLibreOfficeDmgUrlForVersion(version) : "";
  }

  async function fetchLibreOfficeStableVersions() {
    const indexUrl = "https://download.documentfoundation.org/libreoffice/stable/";
    writeDependencyLog("dmg:versions:start", { url: indexUrl });
    const proxy = getProxyOptions();
    writeDependencyLog("proxy:curl", { enabled: Boolean(proxy.proxyUrl), proxy: proxy.masked, target: "libreoffice-index" });
    const result = await runProcess("curl", ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "30", ...proxy.args, indexUrl], {
      timeoutMs: desktopDependencyTimeouts.packageQueryMs,
      env: proxy.env,
    });
    writeDependencyLog("dmg:versions:finish", { ok: result.ok, code: result.code, error: result.error });
    if (!result.ok) return [];
    const versions = Array.from(new Set(
      String(result.stdout || "")
        .matchAll(/href=["'](\d+\.\d+\.\d+)\/["']/gi)
        .map((match) => match[1]),
    )).sort(compareVersionDesc);
    writeDependencyLog("dmg:versions:list", { versions: versions.join(",") });
    return versions;
  }

  async function getMacLibreOfficeDmgUrlCandidates(spec) {
    const configuredUrl = String(spec.darwinDmg?.url || "").trim();
    if (configuredUrl) return [configuredUrl];

    const candidates = [];
    const configuredVersion = String(spec.darwinDmg?.version || "").trim();
    if (configuredVersion) candidates.push(getMacLibreOfficeDmgUrlForVersion(configuredVersion));

    const stableVersions = await fetchLibreOfficeStableVersions();
    for (const version of stableVersions) candidates.push(getMacLibreOfficeDmgUrlForVersion(version));

    // Last-resort fallbacks for offline directory parsing or transient index failures.
    for (const version of ["26.2.4", "26.2.3", "26.2.2", "25.8.7", "25.8.6"]) {
      candidates.push(getMacLibreOfficeDmgUrlForVersion(version));
    }
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  function findLibreOfficeAppInVolume(volumePath) {
    const direct = path.join(volumePath, "LibreOffice.app");
    if (hasExistingFile(direct)) return direct;
    try {
      const entries = fs.readdirSync(volumePath, { withFileTypes: true });
      const match = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === "libreoffice.app");
      return match ? path.join(volumePath, match.name) : "";
    } catch {
      return "";
    }
  }

  function parseHdiutilMountPoint(output) {
    const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/(\/Volumes\/.+)$/);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  async function downloadFileWithCurl(url, destinationPath, { timeoutMs, label = "file", eventPrefix = "download" } = {}) {
    writeDependencyLog(`${eventPrefix}:start`, { url, destination: destinationPath, timeoutMs });
    const proxy = getProxyOptions();
    writeDependencyLog("proxy:curl", { enabled: Boolean(proxy.proxyUrl), proxy: proxy.masked, target: eventPrefix });
    const result = await runProcess("curl", ["-L", "--fail", "--show-error", "--connect-timeout", "30", ...proxy.args, "-o", destinationPath, url], { timeoutMs, env: proxy.env });
    writeDependencyLog(`${eventPrefix}:finish`, { ok: result.ok, code: result.code, error: result.error });
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
      const error = new Error(`Failed to download ${label}.${detail ? ` ${detail}` : ""}`);
      error.failureKind = "download";
      error.retryable = true;
      throw error;
    }
  }

  async function downloadFirstAvailableLibreOfficeDmg(spec, destinationPath) {
    const candidates = await getMacLibreOfficeDmgUrlCandidates(spec);
    const failures = [];
    writeDependencyLog("dmg:download:candidates", { count: candidates.length, urls: candidates.join(" | ") });
    for (const url of candidates) {
      try {
        await fs.promises.rm(destinationPath, { force: true });
        await downloadFileWithCurl(url, destinationPath, { timeoutMs: desktopDependencyTimeouts.downloadMs, label: "LibreOffice DMG", eventPrefix: "dmg:download" });
        return url;
      } catch (error) {
        const message = error?.message || String(error);
        failures.push(`${url} => ${message.slice(0, 500)}`);
        writeDependencyLog("dmg:download:candidate-failed", { url, error: message.slice(0, 1000) });
        await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
      }
    }
    throw createDependencyError(`Failed to download LibreOffice DMG from official candidates. Tried: ${failures.join(" ; ")}. You can set NOOBOT_LIBREOFFICE_MAC_DMG_URL to a verified LibreOffice macOS DMG URL, or install manually from https://www.libreoffice.org/download/download-libreoffice/`, { failureKind: "download", retryable: true });
  }

  async function installLibreOfficeFromDmg(spec) {
    if (process.platform !== "darwin" || spec.label !== "LibreOffice") return null;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-libreoffice-"));
    const dmgPath = path.join(tempDir, "LibreOffice.dmg");
    let mountPoint = "";
    try {
      sendStatus({ phase: "dependency", message: `Downloading ${spec.label} from the official LibreOffice site...` });
      const dmgUrl = await downloadFirstAvailableLibreOfficeDmg(spec, dmgPath);
      writeDependencyLog("dmg:download:selected", { url: dmgUrl });

      sendStatus({ phase: "dependency", message: `Mounting ${spec.label} installer...` });
      writeDependencyLog("dmg:attach:start", { path: dmgPath, timeoutMs: desktopDependencyTimeouts.dmgAttachMs });
      const attachResult = await runProcess("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly"], { timeoutMs: desktopDependencyTimeouts.dmgAttachMs });
      writeDependencyLog("dmg:attach:finish", { ok: attachResult.ok, code: attachResult.code, error: attachResult.error });
      if (!attachResult.ok) {
        const detail = String(attachResult.stderr || attachResult.stdout || attachResult.error || "").trim().slice(0, 1000);
        throw createDependencyError(`Failed to mount LibreOffice DMG.${detail ? ` ${detail}` : ""}`, { failureKind: "package" });
      }
      mountPoint = parseHdiutilMountPoint(`${attachResult.stdout || ""}\n${attachResult.stderr || ""}`);
      writeDependencyLog("dmg:mount-point", { path: mountPoint });
      if (!mountPoint) throw createDependencyError("Failed to locate LibreOffice DMG mount point.", { failureKind: "package" });

      const sourceApp = findLibreOfficeAppInVolume(mountPoint);
      writeDependencyLog("dmg:app-source", { path: sourceApp });
      if (!sourceApp) throw createDependencyError("Mounted LibreOffice DMG did not contain LibreOffice.app.", { failureKind: "package" });

      const targetApp = "/Applications/LibreOffice.app";
      sendStatus({ phase: "dependency", message: `Copying ${spec.label} to /Applications...` });
      writeDependencyLog("dmg:copy:start", { source: sourceApp, target: targetApp, timeoutMs: desktopDependencyTimeouts.appCopyMs });
      const copyResult = await runProcess("ditto", [sourceApp, targetApp], { timeoutMs: desktopDependencyTimeouts.appCopyMs });
      writeDependencyLog("dmg:copy:finish", { ok: copyResult.ok, code: copyResult.code, error: copyResult.error });
      if (!copyResult.ok) {
        const detail = String(copyResult.stderr || copyResult.stdout || copyResult.error || "").trim().slice(0, 1000);
        throw createDependencyError(`Failed to copy LibreOffice to /Applications. macOS may require permission to write to /Applications.${detail ? ` ${detail}` : ""}`, { failureKind: "permission" });
      }
      return { ok: true, method: "dmg" };
    } finally {
      if (mountPoint) {
        sendStatus({ phase: "dependency", message: `Unmounting ${spec.label} installer...` });
        writeDependencyLog("dmg:detach:start", { mount: mountPoint, timeoutMs: desktopDependencyTimeouts.dmgDetachMs });
        const detachResult = await runProcess("hdiutil", ["detach", mountPoint], { timeoutMs: desktopDependencyTimeouts.dmgDetachMs });
        writeDependencyLog("dmg:detach:finish", { ok: detachResult.ok, code: detachResult.code, error: detachResult.error });
      }
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function getMacNodeArch() {
    return process.arch === "arm64" ? "arm64" : "x64";
  }

  function getMacNodeTarUrlForVersion(version) {
    const normalized = String(version || "").trim().replace(/^v?/, "v");
    return `https://nodejs.org/dist/${normalized}/node-${normalized}-darwin-${getMacNodeArch()}.tar.xz`;
  }

  function getMacManagedCommandPath(key, command) {
    if (process.platform !== "darwin") return "";
    return path.join(getManagedDependencyDir(key), "bin", command);
  }

  async function runManagedCommand(key, command, args = []) {
    const commandPath = getMacManagedCommandPath(key, command);
    if (!commandPath || !hasExistingFile(commandPath)) return { ok: false, error: "managed command missing" };
    return runProcess(commandPath, args, { timeoutMs: desktopDependencyTimeouts.commandProbeMs });
  }

  function getFileMode(filePath) {
    try {
      return fs.statSync(filePath).mode.toString(8);
    } catch {
      return "";
    }
  }

  async function findExecutableFileByName(rootDir, fileName) {
    const stack = [rootDir];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name === fileName) return fullPath;
      }
    }
    return "";
  }

  async function verifyManagedCommand(key, command, args = ["--version"]) {
    const commandPath = getMacManagedCommandPath(key, command);
    const exists = hasExistingFile(commandPath);
    const mode = exists ? getFileMode(commandPath) : "";
    const result = exists
      ? await runProcess(commandPath, args, { timeoutMs: desktopDependencyTimeouts.commandProbeMs })
      : { ok: false, code: -1, stdout: "", stderr: "", error: "managed command missing" };
    writeDependencyLog("managed:verify", {
      key,
      command,
      path: commandPath,
      exists,
      mode,
      ok: result.ok,
      code: result.code,
      error: result.error,
      stderr: String(result.stderr || "").slice(0, 500),
      pathEnv: String(process.env.PATH || "").slice(0, 1000),
    });
    return { ...result, path: commandPath, exists, mode };
  }

  async function downloadFirstAvailableFile({ key, label, candidates, destinationPath, eventPrefix, manualUrl, envHint }) {
    const failures = [];
    writeDependencyLog(`${eventPrefix}:candidates`, { key, count: candidates.length, urls: candidates.join(" | ") });
    for (const url of candidates) {
      try {
        await fs.promises.rm(destinationPath, { force: true });
        await downloadFileWithCurl(url, destinationPath, { timeoutMs: desktopDependencyTimeouts.downloadMs, label, eventPrefix });
        return url;
      } catch (error) {
        const message = error?.message || String(error);
        failures.push(`${url} => ${message.slice(0, 500)}`);
        writeDependencyLog(`${eventPrefix}:candidate-failed`, { key, url, error: message.slice(0, 1000) });
        await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
      }
    }
    throw createDependencyError(`Failed to download ${label}. Tried: ${failures.join(" ; ")}.${envHint ? ` You can set ${envHint}.` : ""}${manualUrl ? ` Manual download: ${manualUrl}` : ""}`, { failureKind: "download", retryable: true });
  }

  function getMacFfmpegArch() {
    return process.arch === "arm64" ? "arm64" : "x64";
  }

  function getMacFfmpegUrlCandidates(spec) {
    const configuredUrl = String(spec.darwinManaged?.url || "").trim();
    return Array.from(new Set([
      configuredUrl,
      `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-${getMacFfmpegArch()}.gz`,
      "https://evermeet.cx/ffmpeg/getrelease/zip",
      "https://evermeet.cx/ffmpeg/ffmpeg.zip",
    ].filter(Boolean)));
  }

  function isGzipArchiveUrl(url) {
    return String(url || "").split(/[?#]/, 1)[0].toLowerCase().endsWith(".gz");
  }

  async function extractFfmpegArchive({ archivePath, extractDir, selectedUrl }) {
    if (isGzipArchiveUrl(selectedUrl)) {
      await fs.promises.mkdir(extractDir, { recursive: true });
      const outputPath = path.join(extractDir, "ffmpeg");
      writeDependencyLog("managed:ffmpeg:extract:start", { archive: archivePath, destination: outputPath, format: "gzip", timeoutMs: desktopDependencyTimeouts.installMs });
      await pipeline(
        fs.createReadStream(archivePath),
        zlib.createGunzip(),
        fs.createWriteStream(outputPath, { mode: 0o755 }),
      );
      await fs.promises.chmod(outputPath, 0o755);
      writeDependencyLog("managed:ffmpeg:extract:finish", { ok: true, format: "gzip", destination: outputPath });
      return;
    }

    writeDependencyLog("managed:ffmpeg:extract:start", { archive: archivePath, destination: extractDir, format: "zip", timeoutMs: desktopDependencyTimeouts.installMs });
    const unzipResult = await runProcess("ditto", ["-x", "-k", archivePath, extractDir], { timeoutMs: desktopDependencyTimeouts.installMs });
    writeDependencyLog("managed:ffmpeg:extract:finish", { ok: unzipResult.ok, code: unzipResult.code, error: unzipResult.error, stderr: String(unzipResult.stderr || "").slice(0, 500), format: "zip" });
    if (!unzipResult.ok) throw createDependencyError(`Failed to extract FFmpeg.${String(unzipResult.stderr || unzipResult.error || "").slice(0, 1000)}`, { failureKind: "package" });
  }

  async function installFfmpegManagedMac(spec) {
    if (process.platform !== "darwin") return null;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-ffmpeg-"));
    const archivePath = path.join(tempDir, "ffmpeg.archive");
    const extractDir = path.join(tempDir, "extract");
    const targetBinDir = path.join(getManagedDependencyDir("ffmpeg"), "bin");
    const targetPath = path.join(targetBinDir, "ffmpeg");
    const targetFfprobePath = path.join(targetBinDir, "ffprobe");
    try {
      sendStatus({ phase: "dependency", message: `Downloading ${spec.label} binary...` });
      const selectedUrl = await downloadFirstAvailableFile({
        key: "ffmpeg",
        label: "FFmpeg",
        candidates: getMacFfmpegUrlCandidates(spec),
        destinationPath: archivePath,
        eventPrefix: "managed:ffmpeg:download",
        manualUrl: spec.darwinManaged?.manualUrl,
        envHint: "NOOBOT_FFMPEG_MAC_URL",
      });
      writeDependencyLog("managed:ffmpeg:download:selected", { url: selectedUrl });
      await fs.promises.mkdir(extractDir, { recursive: true });
      sendStatus({ phase: "dependency", message: `Extracting ${spec.label}...` });
      await extractFfmpegArchive({ archivePath, extractDir, selectedUrl });
      sendStatus({ phase: "dependency", message: `Locating ${spec.label} binary...` });
      const sourcePath = await findExecutableFileByName(extractDir, "ffmpeg");
      const sourceFfprobePath = await findExecutableFileByName(extractDir, "ffprobe");
      writeDependencyLog("managed:ffmpeg:binary", {
        source: sourcePath,
        sourceFfprobe: sourceFfprobePath,
        target: targetPath,
        targetFfprobe: targetFfprobePath,
      });
      if (!sourcePath) throw createDependencyError("FFmpeg archive did not contain ffmpeg binary.", { failureKind: "package" });
      sendStatus({ phase: "dependency", message: `Installing ${spec.label} to managed dependencies...` });
      writeDependencyLog("managed:ffmpeg:copy:start", { source: sourcePath, target: targetPath });
      await fs.promises.rm(path.dirname(targetBinDir), { recursive: true, force: true });
      await fs.promises.mkdir(targetBinDir, { recursive: true });
      await fs.promises.copyFile(sourcePath, targetPath);
      await fs.promises.chmod(targetPath, 0o755);
      if (sourceFfprobePath) {
        await fs.promises.copyFile(sourceFfprobePath, targetFfprobePath);
        await fs.promises.chmod(targetFfprobePath, 0o755);
      }
      writeDependencyLog("managed:ffmpeg:copy:finish", { target: targetPath, mode: getFileMode(targetPath) });
      prependManagedDependencyPath();
      sendStatus({ phase: "dependency", message: `Verifying ${spec.label}...` });
      const verify = await verifyManagedCommand("ffmpeg", "ffmpeg", ["-version"]);
      if (!verify.ok) throw createDependencyError(`Managed FFmpeg verification failed at ${verify.path || targetPath}. exists=${verify.exists}; mode=${verify.mode}; ${String(verify.stderr || verify.error || "").slice(0, 1000)}`, { failureKind: "verification" });
      return { ok: true, method: "managed", path: verify.path };
    } finally {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function getMacNodeUrlCandidates(spec) {
    const configuredUrl = String(spec.darwinManaged?.url || "").trim();
    const configuredVersion = String(spec.darwinManaged?.version || "").trim();
    const versions = [configuredVersion, "v22.21.1", "v20.19.5", "v24.11.1"].filter(Boolean);
    return Array.from(new Set([configuredUrl, ...versions.map(getMacNodeTarUrlForVersion)].filter(Boolean)));
  }

  async function installNodeManagedMac(spec) {
    if (process.platform !== "darwin") return null;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-nodejs-"));
    const archivePath = path.join(tempDir, "node.tar.xz");
    const extractDir = path.join(tempDir, "extract");
    const targetDir = getManagedDependencyDir("nodejs");
    try {
      sendStatus({ phase: "dependency", message: `Downloading ${spec.label} from nodejs.org...` });
      const selectedUrl = await downloadFirstAvailableFile({
        key: "nodejs",
        label: "Node.js",
        candidates: getMacNodeUrlCandidates(spec),
        destinationPath: archivePath,
        eventPrefix: "managed:nodejs:download",
        manualUrl: spec.darwinManaged?.manualUrl,
        envHint: "NOOBOT_NODEJS_MAC_URL or NOOBOT_NODEJS_MAC_VERSION",
      });
      writeDependencyLog("managed:nodejs:download:selected", { url: selectedUrl });
      await fs.promises.mkdir(extractDir, { recursive: true });
      sendStatus({ phase: "dependency", message: `Extracting ${spec.label}...` });
      const tarResult = await runProcess("tar", ["-xJf", archivePath, "-C", extractDir, "--strip-components", "1"], { timeoutMs: desktopDependencyTimeouts.installMs });
      if (!tarResult.ok) throw createDependencyError(`Failed to extract Node.js.${String(tarResult.stderr || tarResult.error || "").slice(0, 1000)}`, { failureKind: "package" });
      await fs.promises.rm(targetDir, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.promises.rename(extractDir, targetDir);
      await fs.promises.chmod(path.join(targetDir, "bin", "node"), 0o755).catch(() => {});
      await fs.promises.chmod(path.join(targetDir, "bin", "npm"), 0o755).catch(() => {});
      prependManagedDependencyPath();
      const nodeVerify = await verifyManagedCommand("nodejs", "node", ["--version"]);
      if (!nodeVerify.ok) throw createDependencyError(`Managed Node.js verification failed.${String(nodeVerify.stderr || nodeVerify.error || "").slice(0, 1000)}`, { failureKind: "verification" });
      const npmVerify = await runManagedCommand("nodejs", "npm", ["--version"]);
      writeDependencyLog("managed:nodejs:npm:verify", { ok: npmVerify.ok, error: npmVerify.error });
      return { ok: true, method: "managed" };
    } finally {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function installManagedDependencyMac(key, spec) {
    if (process.platform !== "darwin") return null;
    if (key === "ffmpeg") return installFfmpegManagedMac(spec);
    if (key === "nodejs") return installNodeManagedMac(spec);
    return null;
  }


  return {
    getDarwinManagedKeyForSpec,
    getMacManagedCommandPath,
    getMacFfmpegUrlCandidates,
    installLibreOfficeFromDmg,
    installManagedDependencyMac,
    prependManagedDependencyPath,
  };
}
