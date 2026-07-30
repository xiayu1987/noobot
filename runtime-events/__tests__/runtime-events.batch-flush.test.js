/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendJsonLine, flushJsonLineBatches } from '../src/transports/jsonl.js';

test('flushJsonLineBatches persists a pending batch before its timer fires', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noobot-jsonl-flush-'));
  const file = path.join(root, 'pending.jsonl');
  try {
    const pendingWrite = appendJsonLine(file, { sequence: 1 });
    await flushJsonLineBatches();
    await pendingWrite;
    const records = (await fs.readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(records, [{ sequence: 1 }]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

