/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseSshCommandOutput } from "../src/terminal/ssh-connector-channel.js";

const TOKEN = "11111111-2222-3333-4444-555555555555";

const echoedEnvelope = [
  "\x1b[?2004hroot@host:~# printf '%s%s\\n' '__NOOBOT_BEGIN_' '" + TOKEN + "__'\r",
  "\x1b[?2004hroot@host:~# printf '\\n%s%s%s\\n' '__NOOBOT_DONE_' '" + TOKEN + '__\' "$?"\r',
].join("\n");

test("ssh output parser ignores echoed envelope until real done marker arrives", () => {
  assert.equal(parseSshCommandOutput(`Last login: x\r\n${echoedEnvelope}\r\n`, TOKEN), null);
});

test("ssh output parser extracts body and real exit code with PTY noise", () => {
  const raw =
    `Linux host MOTD\r\n${echoedEnvelope}\r\n` +
    `__NOOBOT_BEGIN_${TOKEN}__\r\n\x1b[?2004luid=0(root)\r\nhost\r\n` +
    `\r\n__NOOBOT_DONE_${TOKEN}__0\r\n`;
  assert.deepEqual(parseSshCommandOutput(raw, TOKEN), {
    ok: true,
    code: 0,
    stdout: "uid=0(root)\nhost",
  });
});

test("ssh output parser reports non-zero exit code", () => {
  const raw = `__NOOBOT_BEGIN_${TOKEN}__\r\n\r\n__NOOBOT_DONE_${TOKEN}__127\r\n`;
  assert.deepEqual(parseSshCommandOutput(raw, TOKEN), { ok: false, code: 127, stdout: "" });
});

test("ssh output parser waits for exit code line ending", () => {
  assert.equal(parseSshCommandOutput(`__NOOBOT_DONE_${TOKEN}__0`, TOKEN), null);
});
