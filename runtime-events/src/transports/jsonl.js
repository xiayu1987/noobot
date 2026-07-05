import fs from 'node:fs/promises';
import path from 'node:path';

export async function appendJsonLine(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return { ok: true, file };
}
