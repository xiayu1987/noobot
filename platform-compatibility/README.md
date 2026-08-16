# Platform Compatibility

`@noobot/platform-compatibility` is the authoritative boundary for operating-system facts and host primitives shared by Noobot.

It owns platform identity, host shell selection, transient file-system error classification, restricted child-process environments, process-group behavior, executable lookup, localized command output decoding, host dependency executable resolution, and process-tree termination.

Domain packages retain their own semantics:

- `path-resolver` owns path views, normalization, containment, and authorization.
- `execution-isolation-protocol` owns execution classes and execution views.
- Native Script owns capability and task-local resource protocols.
- Desktop dependency management owns installation and discovery; it publishes resolved executable paths through the declared environment contract.

Callers must pass explicit platform context in tests. They must not reproduce platform aliases, error-code tables, executable defaults, or process termination branches.
