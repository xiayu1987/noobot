/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  NATIVE_SCRIPT_CAPABILITY_BINDINGS,
  NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS,
  NATIVE_SCRIPT_FORBIDDEN_PROPERTIES,
  NATIVE_SCRIPT_FORBIDDEN_SYNTAX,
  NATIVE_SCRIPT_RESULT_FIELD,
} from "@noobot/execution-isolation-protocol/native-script";

export const EXECUTE_NATIVE_SCRIPT_MANUAL = {
  execute_native_script: {
    summary:
      "Run a Node.js async function body in a restricted sandbox, driving browser, document, media, and file work through injected capabilities.",
    usage: ["execute_native_script({ script_body, inputs, arguments, riskLevel })"],
    params: {
      script_body:
        "Async function body source. The complete source is AST-validated before execution; capabilities arrive as bindings, and import or require is not allowed.",
      inputs: "Read-only input array, each item { source: logical path or attachmentRef }.",
      arguments: "Structured non-sensitive parameter object, read inside the script through args.",
      riskLevel:
        "Script risk level: low, medium, high, or critical. Destructive scripts must be marked critical.",
    },
    bindings: {
      files:
        "File access, every method is async and must be awaited: const token = await files.input(index) returns an input:// token; for text use await files.readText(token), readJson(token), writeText(token, text), writeJson(token, value); for binary use await files.readBase64(token), writeBase64(token, base64), and await files.copy(sourceToken, destinationToken), which returns { path, bytes } and is the channel that promotes a temp:// binary artifact into a formal output:// attachment. Reads and writes accept only input://, output://, or temp:// tokens, never logical or host paths.",
      output:
        "Artifacts, every method is async and must be awaited: await output.file(relativePath) returns an output:// token; await output.tempDirectory(relativePath) returns a temp:// directory token; await output.tempFile(relativePath) or await output.tempFile(tempDirectoryToken, fileName) returns a temp:// file token.",
      ui: "Shared user interaction channel, see the interaction section.",
      args: "The arguments object passed to this call.",
      log: "log(...values) writes diagnostic text to stdout; return structured results from the top-level function.",
    },
    result: {
      [NATIVE_SCRIPT_RESULT_FIELD]:
        "The JSON value returned by the top-level function. Omitted when there is no return or it returns undefined; functions, Symbols, BigInts, non-finite numbers, circular references, and nested undefined values cannot be returned.",
      stdout: "Text execution log produced by log(...values).",
      attachments: "Only files written under output:// are returned as formal attachments.",
    },
    validation: {
      timing:
        "The complete script_body is parsed and validated before any statement runs; one violation rejects the whole script with zero execution.",
      forbiddenIdentifiers: `Forbidden identifiers: ${NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS.join(", ")}. Identifiers are checked in the AST, so typeof process is rejected too.`,
      forbiddenSyntax: `Forbidden syntax nodes: ${NATIVE_SCRIPT_FORBIDDEN_SYNTAX.join(", ")}.`,
      propertyAccess: `Forbidden property names: ${NATIVE_SCRIPT_FORBIDDEN_PROPERTIES.join(", ")}; dynamic computed access such as values[key] is also forbidden, while literal computed properties are allowed.`,
    },
    interaction: {
      waitForUser:
        "await ui.waitForUser({ content, fields }) suspends the script and asks the user, returning what they filled in; the timeout clock pauses while waiting. fields accepts a field array or { fields: [...] }, every entry requires name and displayName, and an invalid shape throws instead of silently degrading to a confirmation dialog.",
    },
    capabilities: {
      browser: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.browser,
        summary:
          "Browser pages, locators, screenshots, persistent login state, and headed manual operation.",
        usage: [
          "await browser.newPage({ headed, profile, viewport })",
          "await browser.closeProfile({ profile })",
        ],
        api: {
          newPage:
            'Returns a restricted page supporting goto, setContent, title, url, content, DOM operations, screenshot, and close, but not evaluate. page.screenshot and locator.screenshot return { path, bytes }; omitting path returns { path: "", bytes, base64 }.',
          headed:
            "headed true starts a visible window owned by the main process, so it remains open after the script exits for manual login or confirmation.",
          profile:
            "profile names a persistent profile, default when omitted. The same profile reuses login state across scripts and turns.",
          closeProfile:
            "Explicitly closes the named profile window and session and reports whether it was open.",
        },
        notes: [
          "Headed mode does not intercept requests; headless mode still applies protocol validation.",
          "Persistent profiles retain cookies and login state in per-user storage.",
          "For manual login, open headed, await ui.waitForUser, then continue browser work.",
        ],
        pitfalls: [
          "Headless pages are reclaimed when the script exits; headed pages are not.",
          "Profile names use a restricted character set and cannot contain separators or '..'.",
        ],
      },
      document: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.document,
        summary:
          "Convert declared task files to PDF, DOCX, XLSX, PPTX, and other formats with LibreOffice.",
        usage: ["await libreoffice.convert({ input, outputDirectory, outputFormat })"],
        api: {
          convert:
            "input accepts an input://, output://, or temp:// file from this call; outputDirectory accepts output.directory or a token returned by await output.tempDirectory(...); returns { code, stdout, stderr, output, outputBytes }.",
        },
        notes: [
          "When outputDirectory is omitted, output is written under output:// and collected as a formal attachment.",
        ],
        pitfalls: [
          "A conversion that reports success but produces no non-empty target file fails instead of returning an empty artifact.",
        ],
      },
      media: {
        bindings: NATIVE_SCRIPT_CAPABILITY_BINDINGS.media,
        summary: "Process audio and video with FFmpeg and inspect media with FFprobe.",
        usage: ["await ffmpeg.run({ args: [...] })", "await ffprobe.run({ args: [...] })"],
        api: {
          ffmpeg:
            "Runs a fixed FFmpeg argument array and returns { code, stdout, stderr }; code is always 0 because non-zero exits throw.",
          ffprobe:
            "Runs a fixed FFprobe argument array and returns { code, stdout, stderr }; code is always 0 because non-zero exits throw.",
        },
        notes: ["input://, output://, and temp:// argument tokens resolve inside the task."],
        pitfalls: [
          "Host paths, parent traversal, external protocols, and options that load extra scripts or attachments are forbidden.",
        ],
      },
    },
    notes: [
      `A top-level return value is exposed as ${NATIVE_SCRIPT_RESULT_FIELD}, but it is not a file attachment; formal attachments must be written under output://.`,
      "task-local output:// and temp:// live only for this call; pass attachmentRef across tools.",
    ],
    pitfalls: [
      "Long manual steps belong inside ui.waitForUser rather than polling or long sleeps that hold the script.",
      "Static validation covers the entire script_body; split independent checks or assertions into small batches so one violation does not prevent the whole batch from running.",
    ],
  },
};
