/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { once } from "node:events";

export async function holdSessionLock(lockPath) {
  const coordinator = new URL("../../src/session/session-mutation-coordinator.js", import.meta.url);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { SessionMutationCoordinator } from ${JSON.stringify(coordinator.href)};
     import { once } from "node:events";
     await new SessionMutationCoordinator({ readTiming: () => ({ timeoutMs: 5000, pollMs: 5 }) })
       .run(process.argv[1], async () => {
         const disconnected = once(process, "disconnect");
         process.send("held");
         await disconnected;
       });`,
      lockPath,
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  const exited = once(child, "exit");
  const stop = async (signal = "SIGKILL") => {
    child.kill(signal);
    return exited;
  };
  try {
    await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(10000) }),
      exited.then(([code, signal]) => {
        throw new Error(`Lock holder exited before acquiring the lock: ${code ?? signal}`);
      }),
    ]);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
