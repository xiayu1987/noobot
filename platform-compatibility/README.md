# Platform Compatibility

`@noobot/platform-compatibility` is the authoritative boundary for operating-system facts and host primitives shared by Noobot.

It owns platform identity, host shell selection, transient file-system error classification, restricted child-process environments, process-group behavior, executable lookup, localized command output decoding, host dependency executable resolution, and process-tree termination.

Domain packages retain their own semantics:

- `path-resolver` owns path views, normalization, containment, and authorization.
- `execution-isolation-protocol` owns execution classes and execution views.
- Native Script owns capability and task-local resource protocols.
- Desktop dependency management owns installation and discovery; it publishes resolved executable paths through the declared environment contract.

Callers must pass explicit platform context in tests. They must not reproduce platform aliases, error-code tables, executable defaults, or process termination branches.

`terminateProcessTree(pid, { graceMs, settleMs })` owns termination and exit confirmation. POSIX callers launch detached process groups; completion requires the entire group to disappear, including descendants whose leader has exited. Windows enumerates `Win32_Process` ancestry, validates PID and creation time before terminating each member, and confirms removal with a fresh snapshot. Initial discovery and forced termination each have a `settleMs` command budget; the exit-confirmation deadline starts after the first termination command completes and is never renewed by subsequent commands. A failed termination is successful only if a fresh identity query proves that the target exited or its PID was reused. Failed Windows cleanup retains discovered identities for retry. Snapshot and termination errors propagate while the owned process survives. `createProcessTreeTerminator` shares concurrent calls, retains the latest operation for `wait()`, and permits an explicit retry after failure. A failed spawn without a PID has no process tree to terminate.

`syncDirectory({ directory, open, platform })` owns directory durability barriers and handle cleanup. Callers use the same operation on every platform and inject their file-open primitive. It returns `true` after synchronizing and closing a directory, or `false` on Windows where Node.js directory fsync is unavailable. Open, sync, and close failures propagate; simultaneous sync and close failures are aggregated. File contents must still be flushed by callers on every platform. Linux and macOS retain directory synchronization; Windows does not provide the same directory-entry durability guarantee across power loss.
