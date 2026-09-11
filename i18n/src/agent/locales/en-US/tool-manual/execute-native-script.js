/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTE_NATIVE_SCRIPT_MANUAL = {
  execute_native_script: {
    summary:
      "Run a Node.js async function body in a restricted sandbox, driving browser, document, media, and file work through injected capabilities.",
    usage: ["execute_native_script({ script_body, inputs, arguments, riskLevel })"],
    params: {
      script_body:
        "Async function body source. Capabilities arrive as bindings; import and require are neither needed nor allowed.",
      inputs: "Read-only input array, each item { source: logical path or attachmentRef }.",
      arguments: "Structured non-sensitive parameter object, read inside the script through args.",
      riskLevel:
        "Script risk level: low, medium, high, or critical. Destructive scripts must be marked critical.",
    },
    bindings: {
      browser: "Browser capability, see the browser section.",
      libreoffice:
        "Document conversion: await libreoffice.convert({ input, outputDirectory, outputFormat }).",
      ffmpeg: "Media processing: await ffmpeg.run({ args: [...] }).",
      ffprobe: "Media probing: await ffprobe.run({ args: [...] }).",
      files: "File access: files.input(index), readText, readJson, writeText, writeJson.",
      output: "Artifacts: output.file(path), output.tempFile(path), output.tempDirectory(path).",
      ui: "User interaction channel, see the ui section.",
      args: "The arguments object passed to this call.",
      log: "log(message) writes to the execution log.",
    },
    browser: {
      newPage:
        "await browser.newPage({ headed, profile, viewport }) returns a restricted page supporting goto, setContent, title, url, content, DOM operations, screenshot, and close, but not evaluate.",
      headed:
        "With headed true a visible window starts. The browser is owned by the main process, so the window survives after the script ends, which suits manual login or manual confirmation.",
      profile:
        "profile names a persistent profile, default when omitted. The same profile reuses one login state across scripts and turns.",
      closeProfile:
        "await browser.closeProfile({ profile }) explicitly closes that profile's window and session, returning whether it actually closed.",
    },
    ui: {
      waitForUser:
        "await ui.waitForUser({ content, fields }) suspends the script and asks the user, returning what they filled in; the timeout clock pauses while waiting.",
    },
    notes: [
      "Headed mode performs no request interception and pages may reach external resources freely; headless mode still validates against the protocol.",
      "A persistent profile keeps cookies and login state, stored per user, so later scripts for the same user read the earlier login directly.",
      "Typical manual login flow: open the page headed, await ui.waitForUser until the user finishes logging in, continue scraping, then closeProfile if needed.",
      "Only output:// files come back as real attachments; a script return value is not file output.",
      "task-local output:// and temp:// live only for this call; pass attachmentRef across tools.",
      "LibreOffice input may be an input://, output://, or temp:// file from this turn; outputDirectory accepts output.directory or an awaited temp:// directory token.",
    ],
    pitfalls: [
      "Headless pages are reclaimed when the script ends, headed pages are not, so do not rely on script exit to close a headed window.",
      "Profile names accept a restricted character set only, with no path separators or .. ; the user identity is injected by the runtime and cannot be chosen by the script.",
      "Long manual steps belong inside ui.waitForUser rather than polling or long sleeps that hold the script.",
    ],
  },
};
