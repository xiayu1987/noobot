/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizePlatform, PLATFORM } from "./platform.js";

const execute = promisify(execFile);
const windowsPrivateDirectory = `
$ErrorActionPreference = 'Stop'
$directory = $env:NOOBOT_PRIVATE_STORAGE_DIRECTORY
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetOwner($identity)
$security.SetAccessRuleProtection($true, $false)
$allowed = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
foreach ($sid in $allowed) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid),
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($rule)
}
$info = [IO.DirectoryInfo]::new($directory)
if ($info.Exists) {
  if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Private storage directory must not be a reparse point'
  }
  $actual = $info.GetAccessControl()
  $rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  $unexpected = @($rules | Where-Object {
    $_.IdentityReference.Value -notin $allowed -or
    $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
    $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
    $_.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or
    $_.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or $_.IsInherited
  })
  $principals = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  if ($actual.AreAccessRulesProtected -and
      $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $identity.Value -and
      $rules.Count -eq $allowed.Count -and $principals.Count -eq $allowed.Count -and
      $unexpected.Count -eq 0) { $security = $null }
  if ($null -ne $security) { $info.SetAccessControl($security) }
} else {
  [void][IO.Directory]::CreateDirectory($directory, $security)
}
$names = ConvertFrom-Json -InputObject $env:NOOBOT_PRIVATE_STORAGE_FILES
if ($names.Count -gt 0) {
  foreach ($entry in $info.GetFileSystemInfos()) {
    if ($entry.Name -notin $names) { continue }
    if (($entry.Attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0) {
      throw 'Private storage file must be a regular file'
    }
    $actual = $entry.GetAccessControl()
    $rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $unexpected = @($rules | Where-Object {
      $_.IdentityReference.Value -notin $allowed -or
      $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl
    })
    $principals = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if ($actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.Value -or
        $rules.Count -ne $allowed.Count -or $principals.Count -ne $allowed.Count -or
        $unexpected.Count -ne 0) {
      $fileSecurity = [Security.AccessControl.FileSecurity]::new()
      $fileSecurity.SetOwner($identity)
      $fileSecurity.SetAccessRuleProtection($true, $false)
      foreach ($sid in $allowed) {
        $fileSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
          [Security.Principal.SecurityIdentifier]::new($sid),
          [Security.AccessControl.FileSystemRights]::FullControl,
          [Security.AccessControl.AccessControlType]::Allow))
      }
      $entry.SetAccessControl($fileSecurity)
    }
  }
}
`;

async function restrictExistingPosixFile(file) {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile()) throw new Error("Private storage file must be a regular file");
  if ((info.mode & 0o777) !== 0o600) await chmod(file, 0o600);
}

export async function ensurePrivateStorageDirectory(directory, files = []) {
  if (
    !Array.isArray(files) ||
    files.some(
      (name) =>
        typeof name !== "string" || !name || name === "." || name === ".." || /[\\/]/.test(name),
    )
  )
    throw new TypeError("Private storage files must be direct entry names");
  const target = path.resolve(directory);
  if (normalizePlatform(process.platform) !== PLATFORM.WINDOWS) {
    await mkdir(target, { recursive: true, mode: 0o700 });
    if ((await lstat(target)).isSymbolicLink())
      throw new Error("Private storage directory must not be a symbolic link");
    await chmod(target, 0o700);
    for (const name of files) await restrictExistingPosixFile(path.join(target, name));
    return;
  }
  if (!process.env.SystemRoot) throw new Error("Private storage requires Windows SystemRoot");
  await execute(
    path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(windowsPrivateDirectory, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        NOOBOT_PRIVATE_STORAGE_DIRECTORY: target,
        NOOBOT_PRIVATE_STORAGE_FILES: JSON.stringify(files),
      },
    },
  );
}
