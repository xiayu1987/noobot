/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import {
  TASK_PATH_KINDS,
  createTaskPath,
  filePath as path,
  isTaskPath,
  normalizeTaskPathRelative,
  parseTaskPath,
  projectTaskPathText,
  resolveTaskPath,
} from "@noobot/path-resolver";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  buildRestrictedProcessEnv,
  resolveBrowserExecutable,
} from "@noobot/platform-compatibility/process";

const LIBREOFFICE_OUTPUT_FORMATS = Object.freeze({
  docx: Object.freeze({ extension: "docx", convertTo: "docx:Office Open XML Text" }),
  xlsx: Object.freeze({ extension: "xlsx", convertTo: "xlsx:Calc MS Excel 2007 XML" }),
  pptx: Object.freeze({ extension: "pptx", convertTo: "pptx:Impress MS PowerPoint 2007 XML" }),
  pdf: Object.freeze({ extension: "pdf", convertTo: "pdf" }),
});

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function resolveChild(root, relative, label, { createParent = false } = {}) {
  const value = normalizeTaskPathRelative(relative, { label });
  const candidate = path.resolve(root, value);
  if (candidate === path.resolve(root)) return candidate;
  if (createParent) await mkdir(path.dirname(candidate), { recursive: true });
  const parent = await realpath(path.dirname(candidate));
  if (!inside(root, parent) || !inside(root, candidate))
    throw new Error(`${label} is outside the task directory`);
  return candidate;
}

function runFixed(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        shell: false,
        timeout: Number(timeoutMs || 0) || undefined,
        windowsHide: true,
        env: buildRestrictedProcessEnv({
          home: cwd,
          temp: path.join(cwd, "tmp"),
          runElectronAsNode: false,
        }),
        maxBuffer: LENGTH_THRESHOLDS.nativeScript.processOutputBytes,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.unref?.();
  });
}

function capabilityPathReplacements({ inputRoot, outputRoot, tempRoot }) {
  return [
    { hostRoot: inputRoot, taskRoot: "input://" },
    { hostRoot: outputRoot, taskRoot: "output://" },
    { hostRoot: tempRoot, taskRoot: "temp://" },
  ];
}

function redactCapabilityText(value, roots) {
  return projectTaskPathText(value, capabilityPathReplacements(roots));
}

function redactCapabilityValue(value, roots, seen = new WeakSet()) {
  if (typeof value === "string") return redactCapabilityText(value, roots);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) return redactCapabilityText(value.message, roots);
  if (Array.isArray(value)) return value.map((item) => redactCapabilityValue(item, roots, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactCapabilityValue(item, roots, seen)]),
  );
}

function redactProcessResult(result, roots) {
  return {
    stdout: redactCapabilityText(result?.stdout, roots),
    stderr: redactCapabilityText(result?.stderr, roots),
  };
}

function opaqueCallable(implementation) {
  return implementation.bind(undefined);
}

function opaqueFacade(values) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === "function" ? opaqueCallable(value) : value,
      ]),
    ),
  );
}

async function runCapability(command, commandArgs, cwd, timeoutMs, label, roots) {
  try {
    return redactProcessResult(await runFixed(command, commandArgs, cwd, timeoutMs), roots);
  } catch (error) {
    if (error?.killed || error?.code === "ETIMEDOUT") {
      throw new Error(`${label} timed out after ${Number(timeoutMs || 0)} ms`);
    }
    const detail = redactCapabilityText(error?.stderr || error?.message || "", roots).trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
}

export function buildLibreOfficeUserInstallationUrl(tempRoot) {
  return pathToFileURL(path.join(tempRoot, "libreoffice-profile")).href;
}

export function resolveLibreOfficeOutputFormat(outputFormat) {
  const format = String(outputFormat || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/i.test(format)) {
    throw new Error("LibreOffice output format is invalid");
  }
  return LIBREOFFICE_OUTPUT_FORMATS[format] || { extension: format, convertTo: format };
}

function assertHttpUrl(value) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("browser navigation requires an HTTP(S) URL");
  }
  return url.toString();
}

function isAllowedBrowserResource(value) {
  try {
    const url = new URL(String(value || ""));
    if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function resolveBrowserProxyFromEnv(env = process.env) {
  const value = String(
    env.HTTPS_PROXY ||
      env.https_proxy ||
      env.HTTP_PROXY ||
      env.http_proxy ||
      env.ALL_PROXY ||
      env.all_proxy ||
      "",
  ).trim();
  if (!value) return undefined;
  try {
    const proxy = new URL(value);
    if (!proxy.hostname || !proxy.port) return undefined;
    const options = {
      server: `${proxy.protocol}//${proxy.hostname}:${proxy.port}`,
    };
    if (proxy.username) options.username = decodeURIComponent(proxy.username);
    if (proxy.password) options.password = decodeURIComponent(proxy.password);
    const bypass = String(env.NO_PROXY || env.no_proxy || "").trim();
    if (bypass) options.bypass = bypass;
    return options;
  } catch {
    return undefined;
  }
}

function createLocatorFacade(locator, { resolveInput, resolveOutput }) {
  return opaqueFacade({
    click: (options) => locator.click(options),
    dblclick: (options) => locator.dblclick(options),
    fill: (value, options) => locator.fill(String(value ?? ""), options),
    press: (key, options) => locator.press(String(key || ""), options),
    check: (options) => locator.check(options),
    uncheck: (options) => locator.uncheck(options),
    selectOption: (values, options) => locator.selectOption(values, options),
    hover: (options) => locator.hover(options),
    focus: () => locator.focus(),
    count: () => locator.count(),
    isVisible: (options) => locator.isVisible(options),
    textContent: (options) => locator.textContent(options),
    innerText: (options) => locator.innerText(options),
    getAttribute: (name, options) => locator.getAttribute(String(name || ""), options),
    waitFor: (options) => locator.waitFor(options),
    setInputFiles: async (references, options) => {
      const values = Array.isArray(references) ? references : [references];
      const paths = await Promise.all(values.map(resolveInput));
      return locator.setInputFiles(paths, options);
    },
    screenshot: async (options = {}) =>
      locator.screenshot({
        ...options,
        path: await resolveOutput(options.path),
      }),
  });
}

function createPageFacade(page, paths) {
  return opaqueFacade({
    goto: async (url, options) => {
      const response = await page.goto(assertHttpUrl(url), options);
      return response
        ? {
            ok: response.ok(),
            status: response.status(),
            statusText: response.statusText(),
            url: response.url(),
          }
        : { ok: true, status: 0, statusText: "", url: page.url() };
    },
    reload: (options) => page.reload(options),
    goBack: (options) => page.goBack(options),
    goForward: (options) => page.goForward(options),
    title: () => page.title(),
    url: () => page.url(),
    content: () => page.content(),
    setContent: (html, options) => page.setContent(String(html || ""), options),
    textContent: (selector, options) => page.textContent(String(selector || ""), options),
    click: (selector, options) => page.click(String(selector || ""), options),
    fill: (selector, value, options) =>
      page.fill(String(selector || ""), String(value ?? ""), options),
    press: (selector, key, options) =>
      page.press(String(selector || ""), String(key || ""), options),
    waitForSelector: (selector, options) =>
      page.waitForSelector(String(selector || ""), options).then(() => undefined),
    waitForLoadState: (state, options) => page.waitForLoadState(state, options),
    waitForTimeout: (timeout) =>
      page.waitForTimeout(Math.min(30000, Math.max(0, Number(timeout || 0)))),
    locator: (selector) => createLocatorFacade(page.locator(String(selector || "")), paths),
    screenshot: async (options = {}) =>
      page.screenshot({
        ...options,
        path: await paths.resolveOutput(options.path),
      }),
    close: (options) => page.close(options),
  });
}

function requireOptionsObject(value, signature) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${signature} requires one options object`);
  }
  return value;
}

function assertFixedArgs(args, label) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new TypeError(`${label}.args must be an array of strings`);
  }
  const forbiddenOptions = new Set([
    "-filter_script",
    "-filter_complex_script",
    "-attach",
    "-dump_attachment",
    "-protocol_whitelist",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const isPathToken = /^(input|output|temp):\/\//.test(value);
    if (
      forbiddenOptions.has(value) ||
      (!isPathToken && /^[a-z][a-z0-9+.-]*:/i.test(value)) ||
      value.split(/[\\/]+/).includes("..")
    ) {
      throw new Error(`${label}.args contains a disallowed path, protocol, or option`);
    }
    if (
      (value === "-f" && String(args[index + 1] || "").toLowerCase() === "concat") ||
      String(value).toLowerCase() === "concat"
    ) {
      throw new Error(`${label}.args cannot use the concat demuxer`);
    }
    if (/(?:^|[=:])\/(?:etc|proc|sys|dev|bin|sbin|root|home)(?:\/|$)/i.test(value)) {
      throw new Error(`${label}.args contains an embedded host path`);
    }
    if (path.isAbsolute(value)) {
      throw new Error(`${label}.args contains an embedded host path`);
    }
  }
}

export async function createNativeScriptRuntime({
  inputRoot,
  outputRoot,
  tempRoot,
  inputMap = {},
  args,
  timeoutMs,
  libreOfficeExecutable,
}) {
  const pathRoots = { inputRoot, outputRoot, tempRoot };
  const taskRoots = { input: inputRoot, output: outputRoot, temp: tempRoot };
  const declaredDirectoryTokens = new Set([
    createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, allowRoot: true }),
  ]);
  const capabilityTimeoutMs = Math.max(1, Number(timeoutMs || 0) - 5000);
  await Promise.all([mkdir(outputRoot, { recursive: true }), mkdir(tempRoot, { recursive: true })]);
  const inputRelative = (reference) => {
    const key = String(reference ?? "").trim();
    if (isTaskPath(key, { kind: TASK_PATH_KINDS.INPUT })) {
      const { relative: index } = parseTaskPath(key, { kind: TASK_PATH_KINDS.INPUT });
      if (!Object.hasOwn(inputMap, index)) throw new Error(`input is not declared: ${index}`);
      return index;
    }
    const mapped = inputMap[key];
    if (!mapped) throw new Error(`input is not declared: ${key}`);
    return /^\d+$/.test(String(mapped)) ? String(mapped) : key;
  };
  const resolveInput = async (reference) => {
    const index = inputRelative(reference);
    const mapped = inputMap[index] || inputMap[String(reference ?? "").trim()];
    const candidate = await resolveChild(inputRoot, mapped, "input path");
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("input path must be a file");
    return candidate;
  };
  const input = async (reference) =>
    createTaskPath({ kind: TASK_PATH_KINDS.INPUT, relative: inputRelative(reference) });
  const resolveOutput = async (value) => {
    const relative = isTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT })
      ? parseTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT, allowRoot: true }).relative
      : value;
    if (!String(relative || "")) return outputRoot;
    return resolveChild(outputRoot, relative, "output path", { createParent: true });
  };
  const outputFile = async (relative) => {
    if (isTaskPath(relative, { kind: TASK_PATH_KINDS.OUTPUT, allowRoot: false })) {
      return parseTaskPath(relative, { kind: TASK_PATH_KINDS.OUTPUT }).token;
    }
    await resolveChild(outputRoot, relative, "output path", { createParent: true });
    return createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative });
  };
  const tempFile = async (parentOrRelative, name = "") => {
    const parent = String(parentOrRelative || "").trim();
    const child = String(name || "").trim();
    if (child && isTaskPath(child, { allowRoot: true })) {
      throw new Error("output.tempFile requires tempDirectoryToken before fileName");
    }
    const parentToken = isTaskPath(parent, { kind: TASK_PATH_KINDS.TEMP, allowRoot: true });
    if (parentToken && !child) {
      throw new Error("output.tempFile requires a file name after a temp directory token");
    }
    if (!parentToken && child) {
      throw new Error(
        "output.tempFile first argument must be a tempDirectory token when a fileName is provided",
      );
    }
    const directory = parentToken
      ? parseTaskPath(parent, {
          kind: TASK_PATH_KINDS.TEMP,
          allowRoot: true,
        }).relative
      : "";
    const relative = parentToken ? (directory ? `${directory}/${child}` : child) : parent;
    await resolveChild(tempRoot, relative, "temporary path", { createParent: true });
    return createTaskPath({ kind: TASK_PATH_KINDS.TEMP, relative });
  };
  const tempDirectory = async (relative) => {
    const token = createTaskPath({ kind: TASK_PATH_KINDS.TEMP, relative });
    const target = resolveTaskPath({ token, roots: taskRoots, kind: TASK_PATH_KINDS.TEMP }).path;
    await mkdir(target, { recursive: true });
    declaredDirectoryTokens.add(token);
    return token;
  };
  const resolveWritableTaskPath = async (reference, { allowRoot = false, label }) => {
    const value = String(reference || "").trim();
    const kind = isTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT, allowRoot })
      ? TASK_PATH_KINDS.OUTPUT
      : isTaskPath(value, { kind: TASK_PATH_KINDS.TEMP, allowRoot })
        ? TASK_PATH_KINDS.TEMP
        : null;
    if (!kind) {
      throw new Error(`${label} requires an output:// or temp:// task path`);
    }
    const parsed = parseTaskPath(value, { kind, allowRoot });
    const target = resolveTaskPath({
      token: parsed.token,
      roots: taskRoots,
      kind,
      allowRoot,
    }).path;
    await mkdir(path.dirname(target), { recursive: true });
    return { kind, target, token: parsed.token };
  };
  const resolveReadableFile = async (reference, label) => {
    const value = String(reference || "").trim();
    let target;
    if (isTaskPath(value, { kind: TASK_PATH_KINDS.INPUT })) {
      target = await resolveInput(parseTaskPath(value, { kind: TASK_PATH_KINDS.INPUT }).relative);
    } else if (isTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT })) {
      target = resolveTaskPath({
        token: value,
        roots: taskRoots,
        kind: TASK_PATH_KINDS.OUTPUT,
      }).path;
    } else if (isTaskPath(value, { kind: TASK_PATH_KINDS.TEMP })) {
      target = resolveTaskPath({ token: value, roots: taskRoots, kind: TASK_PATH_KINDS.TEMP }).path;
    } else {
      throw new Error(`${label} requires an input://, output://, or temp:// task path`);
    }
    const linkInfo = await lstat(target);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile())
      throw new Error(`${label} requires a regular non-symbolic file`);
    return { target, linkInfo };
  };
  const resolveReadable = async (reference) => {
    const { target, linkInfo } = await resolveReadableFile(reference, "files.readText");
    if (linkInfo.size > LENGTH_THRESHOLDS.nativeScript.textReadBytes)
      throw new Error("files.readText file exceeds 8 MB");
    return target;
  };
  const readText = async (reference) => readFile(await resolveReadable(reference), "utf8");
  const readJson = async (reference) => JSON.parse(await readText(reference));
  const writeText = async (reference, content) => {
    const { target, token } = await resolveWritableTaskPath(reference, {
      label: "files.writeText",
    });
    await writeFile(target, redactCapabilityText(content, pathRoots), "utf8");
    return token;
  };
  const writeJson = (reference, value) =>
    writeText(reference, `${JSON.stringify(redactCapabilityValue(value, pathRoots), null, 2)}\n`);
  const libreoffice = opaqueFacade({
    convert: async (options) => {
      const {
        input: inputPath,
        outputDirectory = ".",
        outputFormat = "pdf",
      } = requireOptionsObject(
        options,
        "libreoffice.convert({ input, outputDirectory, outputFormat })",
      );
      if (inputPath === undefined || inputPath === null || String(inputPath).trim() === "") {
        throw new TypeError(
          "libreoffice.convert({ input, outputDirectory, outputFormat }) requires input",
        );
      }
      const { target: source } = await resolveReadableFile(inputPath, "libreoffice.convert input");
      const outputDirectoryValue = String(outputDirectory || "").trim();
      if (
        !["", "."].includes(outputDirectoryValue) &&
        !declaredDirectoryTokens.has(outputDirectoryValue)
      ) {
        throw new Error(
          "libreoffice.convert outputDirectory requires output.directory or output.tempDirectory(...) token",
        );
      }
      const targetDirectory = ["", "."].includes(outputDirectoryValue)
        ? {
            kind: TASK_PATH_KINDS.OUTPUT,
            target: outputRoot,
          }
        : await resolveWritableTaskPath(outputDirectoryValue, {
            allowRoot: true,
            label: "libreoffice.convert outputDirectory",
          });
      const targetDir = targetDirectory.target;
      await mkdir(targetDir, { recursive: true });
      const format = resolveLibreOfficeOutputFormat(outputFormat);
      const executable = String(libreOfficeExecutable || "").trim();
      if (!executable) {
        throw new Error("LibreOffice executable was not resolved by native process policy");
      }
      const result = await runCapability(
        executable,
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--norestore",
          "--invisible",
          `-env:UserInstallation=${buildLibreOfficeUserInstallationUrl(tempRoot)}`,
          "--convert-to",
          format.convertTo,
          "--outdir",
          targetDir,
          source,
        ],
        tempRoot,
        capabilityTimeoutMs,
        "LibreOffice",
        pathRoots,
      );
      if (/error|no export filter|failed/i.test(String(result.stderr || "")))
        throw new Error("LibreOffice conversion reported an error");
      const sourceBase = path.basename(source, path.extname(source));
      const expected = path.join(targetDir, `${sourceBase}.${format.extension}`);
      const outputStat = await stat(expected).catch(() => null);
      if (!outputStat?.isFile() || outputStat.size <= 0)
        throw new Error("LibreOffice conversion produced no non-empty output");
      return {
        ...redactProcessResult(result, pathRoots),
        output: createTaskPath({
          kind: targetDirectory.kind,
          relative: path.relative(taskRoots[targetDirectory.kind], expected),
        }),
        outputBytes: outputStat.size,
      };
    },
  });
  const ffmpeg = opaqueFacade({
    run: async (options) => {
      const { args: commandArgs } = requireOptionsObject(options, "ffmpeg.run({ args })");
      if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
        throw new TypeError("ffmpeg.run({ args }) requires a non-empty args array");
      }
      assertFixedArgs(commandArgs, "ffmpeg");
      const resolvedArgs = await Promise.all(
        commandArgs.map(async (value) => {
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.INPUT }))
            return resolveInput(parseTaskPath(value, { kind: TASK_PATH_KINDS.INPUT }).relative);
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT })) return resolveOutput(value);
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.TEMP }))
            return resolveTaskPath({ token: value, roots: taskRoots, kind: TASK_PATH_KINDS.TEMP })
              .path;
          return value;
        }),
      );
      return runCapability(
        "ffmpeg",
        ["-nostdin", "-y", ...resolvedArgs],
        tempRoot,
        capabilityTimeoutMs,
        "FFmpeg",
        pathRoots,
      );
    },
  });
  const ffprobe = opaqueFacade({
    run: async (options) => {
      const { args: commandArgs } = requireOptionsObject(options, "ffprobe.run({ args })");
      if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
        throw new TypeError("ffprobe.run({ args }) requires a non-empty args array");
      }
      assertFixedArgs(commandArgs, "ffprobe");
      const resolvedArgs = await Promise.all(
        commandArgs.map(async (value) => {
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.INPUT }))
            return resolveInput(parseTaskPath(value, { kind: TASK_PATH_KINDS.INPUT }).relative);
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.OUTPUT })) return resolveOutput(value);
          if (isTaskPath(value, { kind: TASK_PATH_KINDS.TEMP }))
            return resolveTaskPath({ token: value, roots: taskRoots, kind: TASK_PATH_KINDS.TEMP })
              .path;
          return value;
        }),
      );
      return runCapability(
        "ffprobe",
        resolvedArgs,
        tempRoot,
        capabilityTimeoutMs,
        "FFprobe",
        pathRoots,
      );
    },
  });
  let browser = null;
  const browserContexts = [];
  const getBrowser = async () => {
    if (browser) return browser;
    const playwright = await import("playwright");
    const browserExecutablePath = resolveBrowserExecutable({
      playwrightExecutable: playwright.chromium.executablePath(),
    });
    const browserExecutableStat = await stat(browserExecutablePath);
    if (!browserExecutableStat.isFile()) {
      throw new Error("configured Playwright Chromium executable is not a file");
    }
    const instance = await playwright.chromium.launch({
      headless: true,
      executablePath: browserExecutablePath,
      proxy: resolveBrowserProxyFromEnv(),
    });
    browser = instance;
    return instance;
  };
  const capabilities = Object.freeze({
    args: Object.freeze(
      redactCapabilityValue(args && typeof args === "object" ? args : {}, pathRoots),
    ),
    files: opaqueFacade({ input, readText, readJson, writeText, writeJson }),
    output: opaqueFacade({
      file: outputFile,
      tempFile,
      tempDirectory,
      directory: createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, allowRoot: true }),
    }),
    libreoffice,
    ffmpeg,
    ffprobe,
    browser: opaqueFacade({
      newPage: async (contextOptions = {}) => {
        const source = contextOptions && typeof contextOptions === "object" ? contextOptions : {};
        const allowed = [
          "viewport",
          "locale",
          "colorScheme",
          "timezoneId",
          "userAgent",
          "ignoreHTTPSErrors",
        ];
        const safeOptions = Object.fromEntries(
          allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
        );
        const context = await (await getBrowser()).newContext(safeOptions);
        await context.route("**/*", async (route) => {
          if (isAllowedBrowserResource(route.request().url())) await route.continue();
          else await route.abort("blockedbyclient");
        });
        browserContexts.push(context);
        return createPageFacade(await context.newPage(), { resolveInput, resolveOutput });
      },
    }),
    log: opaqueCallable((...values) =>
      console.log(
        "[native-script]",
        ...values.map((value) => redactCapabilityValue(value, pathRoots)),
      ),
    ),
  });
  return Object.freeze({
    capabilities,
    close: async () => {
      await Promise.allSettled(browserContexts.map((context) => context.close()));
      if (browser) await browser.close().catch(() => undefined);
    },
  });
}

export async function executeNativeScriptBody({ body, capabilities, timeoutMs }) {
  const context = vm.createContext(Object.create(null), {
    name: "noobot-native-script",
    codeGeneration: { strings: false, wasm: false },
  });
  Object.defineProperty(context, "capabilities", {
    value: capabilities,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  const script = new vm.Script(
    `(async ({ browser, libreoffice, ffmpeg, ffprobe, files, output, args, log }) => {\n${String(body || "")}\n})(capabilities)`,
    { filename: "native-script-body.js" },
  );
  return script.runInContext(context, { timeout: Number(timeoutMs || 0) || undefined });
}
