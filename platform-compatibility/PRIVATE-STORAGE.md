# Private storage directory contract

`@noobot/platform-compatibility/private-storage` owns the host filesystem access policy used by connector registry publication and connector key publication. Application user ownership remains defined by the connector protocol; this module restricts access by host operating-system accounts.

`ensurePrivateStorageDirectory(directory, files = [])` completes before callers access confidential storage. `files` declares direct entry names owned by the caller, including any recoverable publication stage. Existing declared files are brought to the same host access policy; absent entries remain absent. Paths outside the directory, directory links and declared entries that are not regular files are rejected. Creation, inspection and permission errors propagate. Callers must not read or publish after it fails, and must serialize the check with their storage operation.

- POSIX: the directory is created with mode `0700`; existing directory permissions become `0700`, and declared existing files become `0600`. Callers create confidential files with mode `0600`.
- Windows: the directory has a protected DACL. Only the running account, SYSTEM and the local Administrators group receive full control, inherited by child directories and files. Node's synthetic `stat.mode` is not evidence of Windows access rights.

Existing directories are brought to this policy. Existing files with inherited Windows rules follow the updated directory ACL. Declared files with independently protected or explicit child ACLs are also restricted to the allowed accounts. Undeclared files remain owned by their respective callers. File contents are never rewritten to repair permissions. The operation does not change workspace ancestors or system security settings. A conforming Windows ACL is checked without rewriting it; permission state is not cached across operations.

Windows uses the system Windows PowerShell executable and .NET filesystem security APIs. There is no fallback to an unprotected directory when the executable or ACL operation is unavailable. The platform layer owns this mechanism; callers do not implement platform-specific permission rules.
