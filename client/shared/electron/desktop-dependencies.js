/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createDesktopDependencyManager({
  app,
  appendEarlyLog = () => {},
  writeDependencyLog = () => {},
  sendStatus = () => {},
} = {}) {
  const desktopDependencyTimeouts = Object.freeze({
    commandProbeMs: 15000,
    checkMs: 45000,
    packageQueryMs: 30000,
    installCommandMs: 15000,
    downloadMs: 15 * 60 * 1000,
    dmgAttachMs: 2 * 60 * 1000,
    appCopyMs: 10 * 60 * 1000,
    dmgDetachMs: 60 * 1000,
    installMs: 20 * 60 * 1000,
  });

  const dependencySpecs = {
    libreoffice: {
      label: "LibreOffice",
      checkCommands: ["libreoffice", "soffice"],
      win32ExecutableCandidates: [
        "LibreOffice\\program\\soffice.exe",
        "LibreOffice\\program\\libreoffice.exe",
        "The Document Foundation\\LibreOffice\\program\\soffice.exe",
        "The Document Foundation\\LibreOffice\\program\\libreoffice.exe",
      ],
      win32RegistryKeys: [
        "HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
        "HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath",
        "HKCU\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
      ],
      win32WingetPackages: ["TheDocumentFoundation.LibreOffice"],
      packages: {
        win32: { winget: "TheDocumentFoundation.LibreOffice", choco: "libreoffice-fresh" },
        darwin: { brew: "libreoffice" },
        linux: { apt: "libreoffice", dnf: "libreoffice", yum: "libreoffice", pacman: "libreoffice-fresh" },
      },
      darwinAppBundle: "LibreOffice.app",
      darwinDmg: {
        version: process.env.NOOBOT_LIBREOFFICE_MAC_VERSION || "",
        url: process.env.NOOBOT_LIBREOFFICE_MAC_DMG_URL || "",
      },
    },
    ffmpeg: {
      label: "FFmpeg",
      checkCommands: ["ffmpeg"],
      managedCommand: "ffmpeg",
      win32ExecutableCandidates: [
        "ffmpeg\\bin\\ffmpeg.exe",
        "Gyan\\FFmpeg\\bin\\ffmpeg.exe",
        "Gyan\\ffmpeg\\bin\\ffmpeg.exe",
        "chocolatey\\bin\\ffmpeg.exe",
      ],
      win32WingetPackages: ["Gyan.FFmpeg"],
      packages: {
        win32: { winget: "Gyan.FFmpeg", choco: "ffmpeg" },
        darwin: { brew: "ffmpeg" },
        linux: { apt: "ffmpeg", dnf: "ffmpeg", yum: "ffmpeg", pacman: "ffmpeg" },
      },
      darwinManaged: {
        url: process.env.NOOBOT_FFMPEG_MAC_URL || "",
        manualUrl: "https://evermeet.cx/ffmpeg/",
      },
    },
    nodejs: {
      label: "Node.js",
      checkCommands: ["node"],
      managedCommand: "node",
      win32ExecutableCandidates: [
        "nodejs\\node.exe",
        "node\\node.exe",
        "node.exe",
        "chocolatey\\bin\\node.exe",
      ],
      win32RegistryKeys: [
        "HKLM\\SOFTWARE\\Node.js",
        "HKLM\\SOFTWARE\\WOW6432Node\\Node.js",
        "HKCU\\SOFTWARE\\Node.js",
      ],
      win32WingetPackages: ["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"],
      packages: {
        win32: { winget: "OpenJS.NodeJS.LTS", choco: "nodejs-lts" },
        darwin: { brew: "node" },
        linux: { apt: "nodejs", dnf: "nodejs", yum: "nodejs", pacman: "nodejs" },
      },
      darwinManaged: {
        version: process.env.NOOBOT_NODEJS_MAC_VERSION || "",
        url: process.env.NOOBOT_NODEJS_MAC_URL || "",
        manualUrl: "https://nodejs.org/en/download",
      },
    },
  };

  function runProcess(command, args = [], { timeoutMs = 120000 } = {}) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const commandLine = [command, ...args].join(" ");
      appendEarlyLog(`[process:start] ${commandLine}; timeoutMs=${timeoutMs}`);
      let settled = false;
      let child = null;
      let timer = null;
      let stdout = "";
      let stderr = "";
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        appendEarlyLog(`[process:finish] ${commandLine}; ok=${payload.ok}; code=${payload.code ?? ""}; elapsedMs=${Date.now() - startedAt}; error=${payload.error || ""}`);
        resolve(payload);
      };
      timer = setTimeout(() => {
        appendEarlyLog(`[process:timeout] ${commandLine}; killing child`);
        try { child?.kill(); } catch {}
        finish({ ok: false, code: -1, stdout, stderr, error: `Timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      try {
        child = spawn(command, args, { windowsHide: true, shell: false });
      } catch (error) {
        finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
        return;
      }
      child.stdout?.on("data", (chunk) => { stdout += String(chunk || ""); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk || ""); });
      child.on("error", (error) => {
        finish({ ok: false, code: -1, stdout, stderr, error: error?.message || String(error) });
      });
      child.on("close", (code) => {
        finish({ ok: code === 0, code, stdout, stderr });
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        appendEarlyLog(`[timeout] label=${label}; timeoutMs=${timeoutMs}`);
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    });
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
    const result = await runProcess("curl", ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "30", indexUrl], {
      timeoutMs: desktopDependencyTimeouts.packageQueryMs,
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
    const result = await runProcess("curl", ["-L", "--fail", "--show-error", "--connect-timeout", "30", "-o", destinationPath, url], { timeoutMs });
    writeDependencyLog(`${eventPrefix}:finish`, { ok: result.ok, code: result.code, error: result.error });
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
      const error = new Error(`Failed to download ${label}.${detail ? ` ${detail}` : ""}`);
      error.failureKind = "download";
      error.retryable = true;
      throw error;
    }
  }

  function createDependencyError(message, { failureKind = "local", retryable = false, cause } = {}) {
    const error = new Error(message);
    error.failureKind = failureKind;
    error.retryable = retryable === true;
    if (cause) error.cause = cause;
    return error;
  }

  function getDependencyErrorMeta(error, defaults = {}) {
    return {
      failureKind: error?.failureKind || defaults.failureKind || "local",
      retryable: error?.retryable === true || defaults.retryable === true,
    };
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

  function getMacFfmpegUrlCandidates(spec) {
    const configuredUrl = String(spec.darwinManaged?.url || "").trim();
    return Array.from(new Set([
      configuredUrl,
      "https://evermeet.cx/ffmpeg/getrelease/zip",
      "https://evermeet.cx/ffmpeg/ffmpeg.zip",
    ].filter(Boolean)));
  }

  async function installFfmpegManagedMac(spec) {
    if (process.platform !== "darwin") return null;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noobot-ffmpeg-"));
    const archivePath = path.join(tempDir, "ffmpeg.zip");
    const extractDir = path.join(tempDir, "extract");
    const targetBinDir = path.join(getManagedDependencyDir("ffmpeg"), "bin");
    const targetPath = path.join(targetBinDir, "ffmpeg");
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
      const unzipResult = await runProcess("ditto", ["-x", "-k", archivePath, extractDir], { timeoutMs: desktopDependencyTimeouts.installMs });
      if (!unzipResult.ok) throw createDependencyError(`Failed to extract FFmpeg.${String(unzipResult.stderr || unzipResult.error || "").slice(0, 1000)}`, { failureKind: "package" });
      const sourcePath = await findExecutableFileByName(extractDir, "ffmpeg");
      writeDependencyLog("managed:ffmpeg:binary", { source: sourcePath, target: targetPath });
      if (!sourcePath) throw createDependencyError("FFmpeg archive did not contain ffmpeg binary.", { failureKind: "package" });
      await fs.promises.rm(path.dirname(targetBinDir), { recursive: true, force: true });
      await fs.promises.mkdir(targetBinDir, { recursive: true });
      await fs.promises.copyFile(sourcePath, targetPath);
      await fs.promises.chmod(targetPath, 0o755);
      prependManagedDependencyPath();
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

  async function hasCommand(command) {
    if (process.platform === "darwin") prependManagedDependencyPath();
    appendEarlyLog(`[dependency:probe:start] command=${command}`);
    const result = await runProcess(command, ["--version"], {
      timeoutMs: desktopDependencyTimeouts.commandProbeMs,
    });
    appendEarlyLog(`[dependency:probe:finish] command=${command}; ok=${result.ok}; error=${result.error || ""}`);
    return result.ok;
  }

  function hasExistingFile(filePath) {
    try {
      return Boolean(filePath) && fs.existsSync(filePath);
    } catch (error) {
      appendEarlyLog(`[fs:exists:error] path=${filePath || ""}; error=${error?.message || String(error)}`);
      return false;
    }
  }

  function hasMacAppBundle(appName) {
    if (process.platform !== "darwin") return false;
    const candidates = [
      path.join("/Applications", appName),
      path.join(process.env.HOME || "", "Applications", appName),
    ].filter(Boolean);
    appendEarlyLog(`[dependency:installed:mac-app:start] app=${appName}; candidates=${candidates.join(" | ")}`);
    for (const candidate of candidates) {
      appendEarlyLog(`[dependency:installed:mac-app:path] app=${appName}; path=${candidate}`);
      const exists = hasExistingFile(candidate);
      appendEarlyLog(`[dependency:installed:mac-app:path-result] app=${appName}; path=${candidate}; exists=${exists}`);
      if (exists) {
        appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=true; path=${candidate}`);
        return true;
      }
    }
    appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=false`);
    return false;
  }

  function parseWindowsRegistryDefaultValue(output) {
    const lines = String(output || "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*\(Default\)\s+REG_\w+\s+(.+)\s*$/i)
        || line.match(/^\s*默认\s+REG_\w+\s+(.+)\s*$/i);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  async function hasWindowsRegistryInstallPath(spec) {
    for (const registryKey of spec.win32RegistryKeys || []) {
      const result = await runProcess("reg", ["query", registryKey], {
        timeoutMs: desktopDependencyTimeouts.commandProbeMs,
      });
      if (!result.ok) continue;
      const installPath = parseWindowsRegistryDefaultValue(result.stdout);
      if (!installPath) continue;
      const candidates = [
        path.join(installPath, "soffice.exe"),
        path.join(installPath, "libreoffice.exe"),
        path.join(installPath, "program", "soffice.exe"),
        path.join(installPath, "program", "libreoffice.exe"),
      ];
      if (candidates.some(hasExistingFile)) return true;
    }
    return false;
  }

  async function hasWindowsWingetPackage(spec) {
    if (!spec.win32WingetPackages?.length || !(await findAvailableCommand(["winget"]))) return false;
    for (const packageId of spec.win32WingetPackages) {
      const result = await runProcess("winget", ["list", "--id", packageId, "--exact", "--accept-source-agreements"], {
        timeoutMs: desktopDependencyTimeouts.packageQueryMs,
      });
      if (result.ok && String(result.stdout || "").toLowerCase().includes(packageId.toLowerCase())) return true;
    }
    return false;
  }

  async function isDependencyInstalled(spec) {
    appendEarlyLog(`[dependency:installed:start] label=${spec.label}; platform=${process.platform}`);
    if (process.platform === "darwin" && spec.managedCommand) {
      const managedKey = getDarwinManagedKeyForSpec(spec);
      const managedPath = managedKey ? getMacManagedCommandPath(managedKey, spec.managedCommand) : "";
      if (hasExistingFile(managedPath)) {
        const result = await runProcess(managedPath, ["--version"], { timeoutMs: desktopDependencyTimeouts.commandProbeMs });
        if (result.ok) {
          prependManagedDependencyPath();
          appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=managed; path=${managedPath}`);
          return true;
        }
      }
    }
    if (process.platform === "darwin" && spec.darwinAppBundle) {
      appendEarlyLog(`[dependency:installed:mac-app] label=${spec.label}; app=${spec.darwinAppBundle}`);
      if (hasMacAppBundle(spec.darwinAppBundle)) {
        appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=mac-app`);
        return true;
      }
    }
    for (const command of spec.checkCommands || []) {
      appendEarlyLog(`[dependency:installed:command] label=${spec.label}; command=${command}`);
      const installed = await hasCommand(command);
      appendEarlyLog(`[dependency:installed:command-result] label=${spec.label}; command=${command}; installed=${installed}`);
      if (installed) {
        appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=command; command=${command}`);
        return true;
      }
    }
    if (process.platform === "win32") {
      if (await hasWindowsRegistryInstallPath(spec)) return true;
      const roots = [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.ProgramData,
        process.env.LOCALAPPDATA,
        process.env.APPDATA,
        "C:\\",
      ]
        .filter(Boolean);
      for (const root of roots) {
        for (const relative of spec.win32ExecutableCandidates || []) {
          if (hasExistingFile(path.join(root, relative))) return true;
        }
      }
      if (await hasWindowsWingetPackage(spec)) return true;
    }
    appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=false`);
    return false;
  }

  async function waitForDependencyInstalled(spec, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await isDependencyInstalled(spec)) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  async function findAvailableCommand(commands = []) {
    writeDependencyLog("find-command:start", { commands: commands.join(",") }, { debug: true });
    for (const command of commands) {
      writeDependencyLog("find-command:probe", { command }, { debug: true });
      if (await hasCommand(command)) {
        writeDependencyLog("find-command:found", { command });
        return command;
      }
    }
    writeDependencyLog("find-command:missing", { commands: commands.join(",") });
    return "";
  }

  async function buildDependencyInstallCommand(spec) {
    writeDependencyLog("install-command:build:start", { label: spec.label, platform: process.platform }, { debug: true });
    const packages = spec.packages?.[process.platform] || {};
    if (process.platform === "win32") {
      if (packages.winget && await findAvailableCommand(["winget"])) return { command: "winget", args: ["install", "--id", packages.winget, "--exact", "--accept-package-agreements", "--accept-source-agreements"] };
      if (packages.choco && await findAvailableCommand(["choco"])) return { command: "choco", args: ["install", packages.choco, "-y"] };
    }
    if (process.platform === "darwin") {
      if (packages.brew && await findAvailableCommand(["brew"])) return { command: "brew", args: ["install", "--cask", packages.brew] };
    }
    if (process.platform === "linux") {
      if (packages.apt && await findAvailableCommand(["apt-get"])) {
        const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
        return isRoot ? { command: "apt-get", args: ["install", "-y", packages.apt] } : { command: "sudo", args: ["-n", "apt-get", "install", "-y", packages.apt] };
      }
      const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
      if (packages.dnf && await findAvailableCommand(["dnf"])) return isRoot ? { command: "dnf", args: ["install", "-y", packages.dnf] } : { command: "sudo", args: ["-n", "dnf", "install", "-y", packages.dnf] };
      if (packages.yum && await findAvailableCommand(["yum"])) return isRoot ? { command: "yum", args: ["install", "-y", packages.yum] } : { command: "sudo", args: ["-n", "yum", "install", "-y", packages.yum] };
      if (packages.pacman && await findAvailableCommand(["pacman"])) return isRoot ? { command: "pacman", args: ["-S", "--noconfirm", packages.pacman] } : { command: "sudo", args: ["-n", "pacman", "-S", "--noconfirm", packages.pacman] };
    }
    writeDependencyLog("install-command:build:missing", { label: spec.label, platform: process.platform });
    return null;
  }

  async function ensureSelectedDependencies(dependencies = {}) {
    const selected = Object.entries(dependencySpecs).filter(([key]) => dependencies?.[key] === true);
    const results = [];
    for (const [key, spec] of selected) {
      writeDependencyLog("ensure:start", { key, label: spec.label });
      sendStatus({ phase: "dependency", message: `Checking ${spec.label}...` });
      let installed = false;
      try {
        writeDependencyLog("check:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.checkMs });
        installed = await withTimeout(
          isDependencyInstalled(spec),
          desktopDependencyTimeouts.checkMs,
          `dependency check ${spec.label}`,
        );
        writeDependencyLog("check:finish", { key, label: spec.label, installed });
      } catch (error) {
        writeDependencyLog("check:error", { key, label: spec.label, error });
        sendStatus({ phase: "dependency", message: `${spec.label} check timed out or failed. Continuing with installer lookup...` });
      }
      if (installed) {
        writeDependencyLog("ensure:installed", { key, label: spec.label });
        sendStatus({ phase: "dependency", message: `${spec.label} is already installed. Skipping.` });
        results.push({ key, ok: true, skipped: true });
        continue;
      }
      writeDependencyLog("missing:start", { key, label: spec.label, platform: process.platform });
      sendStatus({ phase: "dependency", message: `${spec.label} is not installed. Looking for an installer...` });
      writeDependencyLog("install-command:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.installCommandMs });
      const installCommand = await withTimeout(
        buildDependencyInstallCommand(spec),
        desktopDependencyTimeouts.installCommandMs,
        `dependency installer lookup ${spec.label}`,
      );
      writeDependencyLog("install-command:finish", { key, label: spec.label, command: installCommand ? [installCommand.command, ...(installCommand.args || [])].join(" ") : "" });
      if (!installCommand) {
        if (process.platform === "darwin" && key === "libreoffice") {
          writeDependencyLog("dmg:install:start", { key, label: spec.label });
          try {
            await installLibreOfficeFromDmg(spec);
            writeDependencyLog("dmg:install:finish", { key, label: spec.label });
            sendStatus({ phase: "dependency", message: `${spec.label} DMG installer finished. Verifying availability...` });
            writeDependencyLog("verify:start", { key, label: spec.label, method: "dmg" });
            if (!(await waitForDependencyInstalled(spec))) {
              writeDependencyLog("verify:failed", { key, label: spec.label, method: "dmg" });
              throw createDependencyError(`${spec.label} DMG installation finished, but it is not available yet. Please restart Noobot or install it manually if /Applications/LibreOffice.app is still missing.`, { failureKind: "verification" });
            }
            writeDependencyLog("verify:finish", { key, label: spec.label, method: "dmg" });
            sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
            results.push({ key, ok: true, installed: true, method: "dmg" });
            continue;
          } catch (error) {
            const meta = getDependencyErrorMeta(error);
            const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)}`;
            writeDependencyLog("dmg:install:error", { key, label: spec.label, error });
            sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
            throw createDependencyError(message, meta);
          }
        }
        if (process.platform === "darwin" && (key === "ffmpeg" || key === "nodejs")) {
          writeDependencyLog("managed:install:start", { key, label: spec.label });
          try {
            await installManagedDependencyMac(key, spec);
            writeDependencyLog("managed:install:finish", { key, label: spec.label });
            sendStatus({ phase: "dependency", message: `${spec.label} managed installer finished. Verifying availability...` });
            writeDependencyLog("verify:start", { key, label: spec.label, method: "managed" });
            if (!(await waitForDependencyInstalled(spec))) {
              writeDependencyLog("verify:failed", { key, label: spec.label, method: "managed" });
              throw createDependencyError(`${spec.label} managed installation finished, but it is not available yet. Please restart Noobot or install it manually.`, { failureKind: "verification" });
            }
            writeDependencyLog("verify:finish", { key, label: spec.label, method: "managed" });
            sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
            results.push({ key, ok: true, installed: true, method: "managed" });
            continue;
          } catch (error) {
            const meta = getDependencyErrorMeta(error);
            const envHint = key === "ffmpeg" ? "NOOBOT_FFMPEG_MAC_URL" : "NOOBOT_NODEJS_MAC_URL / NOOBOT_NODEJS_MAC_VERSION";
            const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)} You can override the download with ${envHint}.`;
            writeDependencyLog("managed:install:error", { key, label: spec.label, error });
            sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
            throw createDependencyError(message, meta);
          }
        }
        const message = process.platform === "darwin"
          ? `Cannot auto-install ${spec.label}: Homebrew was not found. Please install ${spec.label} manually or install Homebrew and run: brew install --cask ${spec.packages?.darwin?.brew || spec.packages?.darwin?.brew || spec.label}`
          : `Cannot auto-install ${spec.label}: no supported package manager was found.`;
        writeDependencyLog("missing:no-installer", { key, label: spec.label, message });
        sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: false, failureKind: "installer-unavailable" });
        throw createDependencyError(message, { failureKind: "installer-unavailable" });
      }
      writeDependencyLog("install:start", { key, label: spec.label, command: [installCommand.command, ...(installCommand.args || [])].join(" "), timeoutMs: desktopDependencyTimeouts.installMs });
      sendStatus({ phase: "dependency", message: `Installing ${spec.label}...` });
      const result = await runProcess(installCommand.command, installCommand.args, {
        timeoutMs: desktopDependencyTimeouts.installMs,
      });
      writeDependencyLog("install:finish", { key, label: spec.label, ok: result.ok, code: result.code, error: result.error });
      if (!result.ok) {
        const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
        throw createDependencyError(`Failed to install ${spec.label}.${detail ? ` ${detail}` : ""}`, { failureKind: "installer" });
      }
      sendStatus({ phase: "dependency", message: `${spec.label} installer finished. Verifying availability...` });
      writeDependencyLog("verify:start", { key, label: spec.label });
      if (!(await waitForDependencyInstalled(spec))) {
        writeDependencyLog("verify:failed", { key, label: spec.label });
        throw createDependencyError(`${spec.label} installation finished, but it is not available yet. Please restart Noobot or install it manually if the command is still missing from PATH.`, { failureKind: "verification" });
      }
      writeDependencyLog("verify:finish", { key, label: spec.label });
      sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
      results.push({ key, ok: true, installed: true });
    }
    return results;
  }

  return { ensureSelectedDependencies };
}
